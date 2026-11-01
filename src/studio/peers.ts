// Live room: everyone's camera and mic reach everyone else over WebRTC, and the presenter's slide and timer
// travel on a data channel (and through the room, see RoomView), as does whether each person's camera is on. The handshake rides the room's signal queue (server/store.ts), polled.
//
// Every RTCPeerConnection has a random id. Signals carry the sender's connection id (`pc`) and the receiver
// connection they answer (`to`, null while the sender does not know one yet). That keeps a reloaded page, a
// retried connection or a late signal from mixing with the current one:
// - a signal whose `to` is not my current connection is for an older one of mine and is dropped;
// - an offer with `to: null` comes from a brand-new connection, so mine starts over too unless it is new as well;
// - when two new connections offer at once, the impolite one's offer wins (polite = the larger person id) and the
//   polite side answers it on a clean connection. Later offers on a paired connection use perfect negotiation.
// A new page skips the queue's backlog and offers to everyone already in the room; people who arrive later
// offer to it. Unanswered offers are retried with backoff, failed links after RETRY_MS.
import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./room";
import type { HeardLive, LiveState, Person } from "./types";

export type PeerStatus = "connecting" | "live" | "failed";

// The relay carries media when two networks block a direct link; a free public one, so it may be down.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];
const FAST_POLL_MS = 1000;
const SLOW_POLL_MS = 5000;
/** Once both descriptions are set, a link that is not up by then has failed. */
const CONNECT_MS = 12_000;
const DISCONNECTED_MS = 8000;
const RETRY_MS = 5000;
/** How long to wait for someone's page to offer before offering to it instead. */
const WAIT_MS = 8000;
/** Longer than a settled peer's poll, so a slow answer is not mistaken for a lost one. */
const UNANSWERED_MS = 10_000;
const UNANSWERED_MAX_MS = 30_000;
const CANDIDATE_BATCH_MS = 100;
const KINDS = ["audio", "video"] as const;

type Kind = "offer" | "answer" | "candidate" | "bye";
interface Wire { pc: string; to: string | null; description?: RTCSessionDescriptionInit; candidates?: RTCIceCandidateInit[] }
interface Signal { seq: number; from: string; kind: Kind; data: Wire }

interface Peer {
  id: string;
  polite: boolean;
  pc: RTCPeerConnection | null;
  pcId: string;
  remotePc: string | null;
  channel: RTCDataChannel | null;
  senders: Partial<Record<(typeof KINDS)[number], RTCRtpTransceiver>>;
  stream: MediaStream | null;
  /** They turned their camera off: the video track stays, with no frames, so only they can say so. */
  camOff: boolean;
  status: PeerStatus;
  makingOffer: boolean;
  /** A connection made to answer an offer stays quiet until that offer is applied. */
  quiet: boolean;
  unanswered: number;
  candidates: RTCIceCandidateInit[];
  timers: Partial<Record<"connect" | "disconnected" | "retry" | "unanswered" | "flush", number>>;
}

interface Snapshot { streams: Record<string, MediaStream>; status: Record<string, PeerStatus>; camOff: Record<string, boolean>; live: HeardLive | null }
interface Message { live?: LiveState | null; video?: boolean }

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const signalsUrl = (room: string, query = "") => `${API}/rooms/${encodeURIComponent(room)}/signals${query}`;

function isWire(data: unknown): data is Wire {
  return typeof data === "object" && data !== null && typeof (data as Wire).pc === "string";
}

class Mesh {
  private peers = new Map<string, Peer>();
  private listed = new Set<string>();
  /** The room list has shown me, so it is fresh enough to say who was here before this page. */
  private seated = false;
  private introduced = false;
  private local: MediaStream | null = null;
  /** Gives every outgoing track the same stream id, so each side sees one remote stream per person. */
  private msid = new MediaStream();
  private mine: LiveState | null = null;
  private live: HeardLive | null = null;
  private liveFrom: string | null = null;
  private cursor: number | null = null;
  private alive = true;
  private abort = new AbortController();
  private outbox: Promise<unknown> = Promise.resolve();
  private wake: (() => void) | null = null;

  constructor(private room: string, private me: string, private onChange: (s: Snapshot) => void) {
    window.addEventListener("pagehide", this.sayBye);
    void this.poll();
  }

  close() {
    this.alive = false;
    this.abort.abort();
    this.wake?.();
    window.removeEventListener("pagehide", this.sayBye);
    this.sayBye();
    for (const peer of this.peers.values()) this.drop(peer);
    this.peers.clear();
  }

  setPeople(ids: string[]) {
    const next = new Set(ids.filter((id) => id !== this.me));
    for (const id of this.listed) {
      const peer = this.peers.get(id);
      if (!next.has(id) && peer) {
        this.drop(peer);
        this.peers.delete(id);
        if (this.liveFrom === id) this.setLive(null, null);
      }
    }
    this.listed = next;
    this.seated ||= ids.includes(this.me);
    if (!this.introduced) return this.introduce();
    // Someone who arrived after this page offers to it; wait for that.
    for (const id of next) if (!this.peers.has(id)) this.addPeer(id, false);
    this.emit();
  }

  /** Once the cursor is known and the list is fresh, this page offers to everyone already here. */
  private introduce() {
    if (this.introduced || this.cursor === null || !this.seated) return;
    this.introduced = true;
    for (const id of this.listed) if (!this.peers.has(id)) this.addPeer(id, true);
    this.emit();
    this.wake?.();
  }

  setStream(stream: MediaStream | null) {
    this.local = stream;
    for (const peer of this.peers.values()) {
      for (const kind of KINDS) void peer.senders[kind]?.sender.replaceTrack(this.track(kind)).catch(() => undefined);
    }
    this.tell({ video: !!this.track("video") });
  }

  broadcast(state: LiveState | null) {
    this.mine = state;
    this.setLive(state && { ...state, seen: Date.now() }, state ? this.me : null);
    this.tell({ live: state });
  }

  private tell(message: Message) {
    const text = JSON.stringify(message);
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === "open") {
        try {
          peer.channel.send(text);
        } catch {
          /* the channel closed under us; the next open resends */
        }
      }
    }
  }

  // ---------------------------------------------------------------- signaling

  private async poll() {
    while (this.alive && this.cursor === null) {
      try {
        const res = await fetch(signalsUrl(this.room, `?to=${encodeURIComponent(this.me)}`), { signal: this.abort.signal });
        if (res.ok) this.cursor = ((await res.json()) as { last: number }).last;
      } catch {
        /* offline or closing; try again */
      }
      if (this.cursor === null) await this.sleep(2000);
    }
    if (!this.alive) return;
    this.introduce();
    while (this.alive) {
      try {
        const res = await fetch(signalsUrl(this.room, `?to=${encodeURIComponent(this.me)}&after=${this.cursor}`), {
          signal: this.abort.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { signals: Signal[]; last: number };
          for (const signal of body.signals) {
            if (!this.alive) return;
            await this.handle(signal);
          }
          this.cursor = body.last;
        }
      } catch {
        /* offline or closing; the timers recover lost signals */
      }
      // Poll fast while a link is down or a negotiation is open.
      const settled = [...this.peers.values()].every((p) => p.status === "live" && p.pc?.signalingState === "stable" && !p.quiet);
      await this.sleep(settled ? SLOW_POLL_MS : FAST_POLL_MS);
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = window.setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        window.clearTimeout(t);
        this.wake = null;
        resolve();
      };
    });
  }

  private send(to: string, kind: Kind, data: Wire, keepalive = false) {
    const post = () =>
      fetch(signalsUrl(this.room), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.me, to, kind, data }),
        keepalive,
      }).catch(() => undefined);
    // One at a time, so the server numbers a connection's signals in the order they were made.
    if (keepalive) void post();
    else this.outbox = this.outbox.then(post);
  }

  private sayBye = () => {
    for (const peer of this.peers.values()) {
      if (peer.pc && peer.remotePc) this.send(peer.id, "bye", { pc: peer.pcId, to: peer.remotePc }, true);
    }
  };

  private async handle(signal: Signal) {
    if (!isWire(signal.data) || signal.from === this.me) return;
    // Only an offer introduces someone the room list has not shown yet.
    const peer = this.peers.get(signal.from) ?? (signal.kind === "offer" ? this.addPeer(signal.from, false) : null);
    if (!peer) return;
    const w = signal.data;
    if (w.to && w.to !== peer.pcId) return; // meant for a connection of mine that is gone
    try {
      if (signal.kind === "offer") await this.onOffer(peer, w);
      else if (signal.kind === "answer") await this.onAnswer(peer, w);
      else if (signal.kind === "candidate") await this.onCandidates(peer, w);
      else if (signal.kind === "bye") this.onBye(peer, w);
    } catch {
      if (peer.pc) this.fail(peer);
    }
  }

  private async onOffer(peer: Peer, w: Wire) {
    if (!w.description) return;
    if (!w.to) {
      // A new connection on their side. If mine is new and offering too, the impolite offer wins; the polite side
      // answers it on a clean connection rather than rolling back, so nothing is left to renegotiate.
      const offering = peer.pc && !peer.pc.remoteDescription && !peer.quiet;
      if (offering && !peer.polite) return;
      if (!peer.pc || !peer.quiet) this.connect(peer, false);
      peer.remotePc = w.pc;
    } else if (w.pc !== peer.remotePc) return;
    const pc = peer.pc;
    if (!pc) return;
    const collision = peer.makingOffer || pc.signalingState !== "stable";
    if (collision && !peer.polite) return; // theirs rolls back and answers mine
    await pc.setRemoteDescription(w.description);
    if (peer.pc !== pc) return;
    this.useSenders(peer);
    await pc.setLocalDescription();
    if (peer.pc !== pc || !pc.localDescription) return;
    this.send(peer.id, "answer", { pc: peer.pcId, to: peer.remotePc, description: pc.localDescription.toJSON() });
    peer.quiet = false;
    this.clear(peer, "unanswered");
    this.armConnect(peer);
  }

  private async onAnswer(peer: Peer, w: Wire) {
    const pc = peer.pc;
    if (!pc || !w.description || w.to !== peer.pcId || pc.signalingState !== "have-local-offer") return;
    if (peer.remotePc && peer.remotePc !== w.pc) return;
    peer.remotePc = w.pc;
    await pc.setRemoteDescription(w.description);
    this.clear(peer, "unanswered");
    this.armConnect(peer);
  }

  private async onCandidates(peer: Peer, w: Wire) {
    const pc = peer.pc;
    if (!pc || w.pc !== peer.remotePc) return;
    for (const candidate of w.candidates ?? []) {
      // Candidates for an offer this side ignored fail here, which is expected.
      await pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  private onBye(peer: Peer, w: Wire) {
    if (w.pc !== peer.remotePc) return;
    // They left or reloaded. Wait for their next page to offer.
    this.drop(peer);
    peer.status = "connecting";
    this.connectIn(peer, WAIT_MS);
    if (this.liveFrom === peer.id) this.setLive(null, null);
    this.emit();
  }

  // ---------------------------------------------------------------- connections

  private addPeer(id: string, offer: boolean): Peer {
    const peer: Peer = {
      id,
      polite: this.me > id,
      pc: null,
      pcId: randomId(),
      remotePc: null,
      channel: null,
      senders: {},
      stream: null,
      camOff: false,
      status: "connecting",
      makingOffer: false,
      quiet: false,
      unanswered: 0,
      candidates: [],
      timers: {},
    };
    this.peers.set(id, peer);
    if (offer) this.connect(peer, true);
    else this.connectIn(peer, WAIT_MS);
    return peer;
  }

  /** A fresh connection to `peer`, replacing any old one. `offer` sends an offer now; otherwise it waits for one. */
  private connect(peer: Peer, offer: boolean) {
    this.drop(peer);
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    } catch {
      peer.status = "failed";
      this.emit();
      return;
    }
    peer.pc = pc;
    peer.pcId = randomId();
    peer.remotePc = null;
    peer.quiet = !offer;
    // A link that failed stays "failed" through its retries until one goes live.
    if (peer.status !== "failed") peer.status = "connecting";

    const channel = pc.createDataChannel("live", { negotiated: true, id: 0, ordered: true });
    peer.channel = channel;
    channel.onopen = () => {
      const hello: Message = { video: !!this.track("video") };
      if (this.mine) hello.live = this.mine;
      channel.send(JSON.stringify(hello));
    };
    channel.onmessage = (e) => {
      try {
        const message = JSON.parse(String(e.data)) as Message;
        if (typeof message.video === "boolean" && peer.camOff === message.video) {
          peer.camOff = !message.video;
          this.emit();
        }
        // The sender's clock is not mine: the timer counts from when it arrived.
        if (message.live !== undefined) this.setLive(message.live && { ...message.live, seen: Date.now() }, message.live ? peer.id : null);
      } catch {
        /* not ours */
      }
    };

    pc.onnegotiationneeded = async () => {
      if (peer.pc !== pc || peer.quiet) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (peer.pc !== pc || pc.localDescription?.type !== "offer") return;
        this.send(peer.id, "offer", { pc: peer.pcId, to: peer.remotePc, description: pc.localDescription.toJSON() });
        this.armUnanswered(peer);
      } catch {
        if (peer.pc === pc) this.fail(peer);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || peer.pc !== pc) return;
      peer.candidates.push(candidate.toJSON());
      peer.timers.flush ??= window.setTimeout(() => {
        peer.timers.flush = undefined;
        if (peer.pc !== pc || !peer.candidates.length) return;
        this.send(peer.id, "candidate", { pc: peer.pcId, to: peer.remotePc, candidates: peer.candidates.splice(0) });
      }, CANDIDATE_BATCH_MS);
    };
    pc.ontrack = (e) => {
      if (peer.pc !== pc) return;
      const stream = e.streams[0] ?? peer.stream ?? new MediaStream();
      if (!e.streams[0] && !stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      peer.stream = stream;
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      if (peer.pc !== pc) return;
      const state = pc.connectionState;
      if (state === "connected") {
        peer.status = "live";
        peer.unanswered = 0;
        this.clear(peer, "connect");
        this.clear(peer, "disconnected");
        this.emit();
      } else if (state === "failed") this.fail(peer);
      else if (state === "disconnected") {
        peer.timers.disconnected ??= window.setTimeout(() => {
          peer.timers.disconnected = undefined;
          if (peer.pc === pc && pc.connectionState !== "connected") this.fail(peer);
        }, DISCONNECTED_MS);
      }
    };

    if (offer) this.useSenders(peer);
    this.emit();
  }

  /** Send my camera and mic on one audio and one video transceiver, reusing the ones a remote offer created,
   *  so answering never needs an offer of its own. */
  private useSenders(peer: Peer) {
    const pc = peer.pc;
    if (!pc) return;
    for (const kind of KINDS) {
      if (peer.senders[kind]) continue;
      const taken = new Set(Object.values(peer.senders));
      let t = pc.getTransceivers().find((x) => !taken.has(x) && x.mid !== null && x.receiver.track.kind === kind && x.currentDirection !== "stopped");
      if (t) {
        t.direction = "sendrecv";
        t.sender.setStreams?.(this.msid);
      } else t = pc.addTransceiver(kind, { direction: "sendrecv", streams: [this.msid] });
      peer.senders[kind] = t;
      void t.sender.replaceTrack(this.track(kind)).catch(() => undefined);
    }
  }

  private track(kind: string): MediaStreamTrack | null {
    return this.local?.getTracks().find((t) => t.kind === kind && t.readyState === "live") ?? null;
  }

  private armConnect(peer: Peer) {
    if (peer.status === "live" || peer.timers.connect) return;
    const pc = peer.pc;
    peer.timers.connect = window.setTimeout(() => {
      peer.timers.connect = undefined;
      if (peer.pc === pc && peer.status !== "live") this.fail(peer);
    }, CONNECT_MS);
  }

  private armUnanswered(peer: Peer) {
    this.clear(peer, "unanswered");
    const pc = peer.pc;
    const wait = Math.min(UNANSWERED_MS * 2 ** peer.unanswered, UNANSWERED_MAX_MS);
    peer.timers.unanswered = window.setTimeout(() => {
      peer.timers.unanswered = undefined;
      // A working link keeps going; only an unconnected one starts over.
      if (peer.pc !== pc || pc?.signalingState !== "have-local-offer" || peer.status === "live") return;
      // Nobody answered: they are away, or never saw it. Offer again from a new connection.
      peer.unanswered += 1;
      this.connect(peer, true);
    }, wait);
  }

  /** Shows the link as failed and tries a new one after RETRY_MS, unless the other side offers first. */
  private fail(peer: Peer) {
    this.drop(peer);
    peer.status = "failed";
    this.connectIn(peer, RETRY_MS);
    this.emit();
  }

  /** Offer from a new connection after `ms`, unless a connection exists by then. */
  private connectIn(peer: Peer, ms: number) {
    this.clear(peer, "retry");
    peer.timers.retry = window.setTimeout(() => {
      peer.timers.retry = undefined;
      if (this.alive && this.peers.get(peer.id) === peer && !peer.pc) this.connect(peer, true);
    }, ms);
  }

  /** Close the connection and forget its media. Never touches the local tracks. */
  private drop(peer: Peer) {
    for (const key of Object.keys(peer.timers) as (keyof Peer["timers"])[]) this.clear(peer, key);
    if (peer.pc) {
      peer.pc.onnegotiationneeded = peer.pc.onicecandidate = peer.pc.ontrack = peer.pc.onconnectionstatechange = null;
      if (peer.channel) peer.channel.onopen = peer.channel.onmessage = null;
      peer.pc.close();
    }
    peer.pc = null;
    peer.channel = null;
    peer.remotePc = null;
    peer.senders = {};
    peer.stream = null;
    peer.camOff = false;
    peer.candidates = [];
    peer.makingOffer = false;
  }

  private clear(peer: Peer, key: keyof Peer["timers"]) {
    if (peer.timers[key] !== undefined) window.clearTimeout(peer.timers[key]);
    peer.timers[key] = undefined;
  }

  private setLive(state: HeardLive | null, from: string | null) {
    this.live = state;
    this.liveFrom = from;
    this.emit();
  }

  private emit() {
    if (!this.alive) return;
    const streams: Record<string, MediaStream> = {};
    const status: Record<string, PeerStatus> = {};
    const camOff: Record<string, boolean> = {};
    for (const peer of this.peers.values()) {
      status[peer.id] = peer.status;
      if (peer.stream) streams[peer.id] = peer.stream;
      if (peer.camOff) camOff[peer.id] = true;
    }
    this.onChange({ streams, status, camOff, live: this.live });
  }
}

/** Full mesh between everyone in the room. Remote streams carry camera + mic. */
export function usePeers(opts: { room: string; me: string | null; people: Person[]; stream: MediaStream | null }): {
  streams: Record<string, MediaStream>;
  status: Record<string, PeerStatus>;
  camOff: Record<string, boolean>;
  live: HeardLive | null;
  broadcast(state: LiveState | null): void;
} {
  const { room, me, people, stream } = opts;
  const [snapshot, setSnapshot] = useState<Snapshot>({ streams: {}, status: {}, camOff: {}, live: null });
  const mesh = useRef<Mesh | null>(null);
  const ids = people.map((p) => p.id).join(",");
  const latest = useRef({ ids, stream });
  latest.current = { ids, stream };

  useEffect(() => {
    setSnapshot({ streams: {}, status: {}, camOff: {}, live: null });
    if (!me || typeof RTCPeerConnection === "undefined") return;
    const m = new Mesh(room, me, setSnapshot);
    mesh.current = m;
    m.setStream(latest.current.stream);
    m.setPeople(latest.current.ids ? latest.current.ids.split(",") : []);
    return () => {
      m.close();
      if (mesh.current === m) mesh.current = null;
    };
  }, [room, me]);

  useEffect(() => mesh.current?.setPeople(ids ? ids.split(",") : []), [ids]);
  useEffect(() => mesh.current?.setStream(stream), [stream]);

  const broadcast = useCallback((state: LiveState | null) => mesh.current?.broadcast(state), []);
  return { ...snapshot, broadcast };
}

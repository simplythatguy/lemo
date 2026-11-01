// /r/CODE: the team records the presentation one slide group at a time. Join → room (record, review, keep) → render.
// The deck lives on the server with the room; /r/CODE/edit sets it up.
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { Camera } from "./parts";
import { Brand, CopyLink, editLink, initials, ProjectMark } from "./parts";
import { listDevices, liveVideo, openCamera, stopStream } from "./recorder";
import { lastSeat, loadSeat, rememberRoom, roomApi, RoomError, saveLastSeat, saveSeat, useRoom, type Seat } from "./room";
import { Room } from "./RoomView";
import type { Deck } from "./types";
import "./studio.css";

/** The room's deck, as the same object until its content changes: the poll hands over a fresh copy every 2 s. */
function useStableDeck(deck: Deck | null | undefined): Deck | null {
  const kept = useRef<{ json: string; deck: Deck | null }>({ json: "null", deck: null });
  const json = JSON.stringify(deck ?? null);
  if (json !== kept.current.json) kept.current = { json, deck: deck ?? null };
  return kept.current.deck;
}

let liveEl: HTMLVideoElement | null = null;

function useCamera(camId: string | undefined, micId: string | undefined): Camera {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [attempt, setAttempt] = useState(0);
  liveEl ??= liveVideo();
  const live = liveEl;

  useEffect(() => {
    let alive = true;
    let opened: MediaStream | null = null;
    openCamera(camId, micId).then(
      (s) => {
        if (!alive) return stopStream(s);
        opened = s;
        live.srcObject = s;
        void live.play().catch(() => undefined);
        setStream(s);
        setError(null);
        void listDevices().then((d) => alive && setDevices(d));
      },
      (e: unknown) => {
        if (!alive) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(name === "NotAllowedError" ? "Camera blocked" : name === "NotFoundError" ? "No camera found" : "Camera unavailable");
      },
    );
    return () => {
      alive = false;
      stopStream(opened);
    };
  }, [camId, micId, attempt, live]);

  return { stream, live, error, ...devices, retry: () => setAttempt((n) => n + 1) };
}

export function Studio({ code }: { code: string }) {
  const [seat, setSeat] = useState<Seat>(() => ({ ...lastSeat(), ...loadSeat(code) }));
  const { room, live, status, apply } = useRoom(code);
  const deck = useStableDeck(room?.deck);
  const camera = useCamera(seat.camId, seat.micId);

  const loaded = !!room;
  useEffect(() => {
    if (loaded) rememberRoom(code);
  }, [code, loaded]);

  const updateSeat = useCallback((patch: Partial<Seat>) => {
    setSeat((s) => {
      const next = { ...s, ...patch };
      saveSeat(code, next);
      saveLastSeat(next);
      return next;
    });
  }, [code]);

  // A teammate removed this person, or the room forgot them: back to the join screen.
  const me = room?.people.find((p) => p.id === seat.personId) ?? null;
  useEffect(() => {
    if (room && seat.personId && !me) updateSeat({ personId: undefined });
  }, [room, me, seat.personId, updateSeat]);

  if (!room) {
    if (status.kind === "missing") return <NoSlides code={code} />;
    return (
      <div className="st-page st-center" aria-busy={status.kind === "loading"}>
        {status.kind === "offline" && <p className="st-quiet" role="status">No connection</p>}
      </div>
    );
  }
  if (!deck || !deck.groups.length) return <NoSlides code={code} />;
  if (!me) {
    return (
      <Join
        code={code}
        deck={deck}
        taken={room.people.map((p) => p.name.toLowerCase())}
        name={seat.name ?? ""}
        camera={camera}
        onDevice={(camId, micId) => updateSeat({ camId, micId })}
        onJoin={async (name) => {
          const person = await roomApi.join(code, name);
          // The room on screen does not list this person yet; without this the seat would be dropped.
          apply(await roomApi.get(code));
          const kept: Seat = { ...seat, name, personId: person.id };
          saveSeat(code, kept);
          saveLastSeat(kept);
          setSeat(kept);
        }}
      />
    );
  }
  return <Room deck={deck} room={room} serverLive={live} me={me} camera={camera} apply={apply} onLeave={() => updateSeat({ personId: undefined })} />;
}

/** A room nobody has set up yet: one way forward. */
function NoSlides({ code }: { code: string }) {
  return (
    <div className="st-page st-center">
      <div className="st-empty">
        <Brand named />
        <div className="st-join-actions">
          <a className="cf-btn is-primary is-lg" href={editLink(code)}>
            <Icon name="slides" size={16} />Add slides
          </a>
          <CopyLink code={code} />
        </div>
      </div>
    </div>
  );
}

function Join({ code, deck, taken, name: initialName, camera, onDevice, onJoin }: {
  code: string;
  deck: Deck;
  /** Names already in the room, lower case: the team list only suggests the others. */
  taken: string[];
  name: string;
  camera: Camera;
  onDevice(camId: string | undefined, micId: string | undefined): void;
  onJoin(name: string): Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => setName((n) => n || initialName), [initialName]);
  useEffect(() => {
    if (preview.current) preview.current.srcObject = camera.stream;
  }, [camera.stream]);

  const camId = camera.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const micId = camera.stream?.getAudioTracks()[0]?.getSettings().deviceId;
  async function go() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onJoin(name.trim());
    } catch (e) {
      setError(e instanceof RoomError && e.status === 404 ? "Room not found" : e instanceof RoomError && e.status === 409 ? "Room is full" : "Could not join");
      setBusy(false);
    }
  }

  return (
    <div className="st-page st-center">
      <form className="st-join" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h1 className="st-join-title">
          <ProjectMark title={deck.title} logo={deck.logo} size={32} />
          <span>{deck.title}</span>
        </h1>
        <div className={`st-cam${camera.stream ? "" : " is-empty"}`}>
          <video ref={preview} autoPlay muted playsInline />
          {!camera.stream && !camera.error && name.trim() && <span className="st-tile-face" aria-hidden="true">{initials(name)}</span>}
          {camera.error && (
            <div className="st-cam-error">
              <span>{camera.error}</span>
              <button type="button" className="cf-btn is-sm" onClick={camera.retry}>Try again</button>
            </div>
          )}
          <MicLevel stream={camera.stream} />
        </div>
        <div className="st-devices">
          <DevicePicker icon="camera" label="Camera" devices={camera.cams} value={camId} onChange={(id) => onDevice(id, micId)} />
          <DevicePicker icon="mic" label="Microphone" devices={camera.mics} value={micId} onChange={(id) => onDevice(camId, id)} />
        </div>
        <label className="st-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" list="st-team" required />
        </label>
        <datalist id="st-team">
          {deck.team.filter((n) => n.trim() && !taken.includes(n.trim().toLowerCase())).map((n) => <option key={n} value={n} />)}
        </datalist>
        {error && <p className="st-error" role="alert">{error}</p>}
        <div className="st-join-actions">
          <button type="submit" className="cf-btn is-primary is-lg" disabled={!name.trim() || busy || !camera.stream}>
            Join
          </button>
          <CopyLink code={code} />
        </div>
      </form>
    </div>
  );
}

function DevicePicker({ icon, label, devices, value, onChange }: {
  icon: "camera" | "mic";
  label: string;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  onChange(id: string): void;
}) {
  return (
    <label className="st-device" title={label}>
      <Icon name={icon} size={15} />
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={!devices.length}>
        {!devices.length && <option value="">{label}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>
        ))}
      </select>
    </label>
  );
}

/** A thin bar along the camera tile's bottom edge that moves with the microphone. */
function MicLevel({ stream }: { stream: MediaStream | null }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stream?.getAudioTracks().length) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, (peak / 128) * 2.5)})`;
      raf = requestAnimationFrame(tick);
    };
    void ctx.resume().catch(() => undefined);
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);
  return <div className="st-level" aria-hidden="true"><div ref={bar} /></div>;
}

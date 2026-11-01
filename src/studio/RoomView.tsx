// The room: cameras along the top, the timer on the left, the slide in the centre, the transcript on the right, every slide along the bottom.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { startRecording, type Recording } from "./recorder";
import { Render, takeMedia } from "./Render";
import { roomApi } from "./room";
import { SavedVideos } from "./SavedVideos";
import { createStage, exportVideo, preload, type Stage } from "./stage";
import { Cams } from "./Cams";
import { Filmstrip, groupColor } from "./Filmstrip";
import { Brand, CopyLink, firstName, initials, type Camera } from "./parts";
import { usePeers } from "./peers";
import { clock, deckMs, targetMs } from "./timing";
import { liveLeft, newerLive, VIDEO_LIMIT_MS, type Cue, type Deck, type Group, type HeardLive, type LiveState, type Person, type RoomState, type TakeInfo, type TakeMedia } from "./types";
import { uploads, useUploads } from "./uploads";

type Phase =
  | { k: "idle" }
  | { k: "countdown"; n: number }
  | { k: "recording"; startedAt: number; slide: number }
  | { k: "review"; media: TakeMedia };

const busy = (p: Phase) => p.k !== "idle";
const complete = (t: TakeInfo | undefined) => !!t && t.received >= t.chunks;

/** The slide on screen `ms` into a take. */
function slideAt(cues: Cue[], ms: number): number {
  let slide = 0;
  for (const c of cues) if (c.atMs <= ms) slide = c.slide;
  return slide;
}

/** A WebRTC sample this old is from a link that died mid-take; the presenter sends one every 250 ms. */
const RTC_STALE_MS = 3000;
/** The room copy of my take is refreshed at least this often, and on every slide change. */
const PUBLISH_MS = 1000;

export function Room({ deck, room, serverLive, me, camera, apply, onLeave }: {
  deck: Deck;
  room: RoomState;
  /** The take in progress as the room poll last heard it, for when WebRTC is down or behind. */
  serverLive: HeardLive | null;
  me: Person;
  camera: Camera;
  apply(next: RoomState): void;
  onLeave(): void;
}) {
  const [selected, setSelected] = useState(() => {
    const mine = deck.groups.findIndex((g) => room.assignments[g.id] === me.id && !complete(room.takes[g.id]));
    return Math.max(0, mine);
  });
  const [preview, setPreview] = useState(0);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [rendering, setRendering] = useState(false);
  const [mutedAll, setMutedAll] = useState(false);
  const progress = useUploads();
  const peers = usePeers({ room: room.code, me: me.id, people: room.people, stream: camera.stream });
  const peerVideos = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    void preload(deck).catch(() => undefined);
  }, [deck]);

  useEffect(() => {
    void uploads.resume(room.code, room);
    // Once per room: later polls must not restart uploads in flight.
  }, [room.code]);

  // My take reaches the team over WebRTC and through the room, which works when WebRTC cannot connect.
  // Room writes go one at a time so a stop never lands before the sample it follows.
  const published = useRef({ key: "", at: 0, on: false, queue: Promise.resolve() });
  const peerBroadcast = peers.broadcast;
  const publish = useCallback((state: LiveState | null) => {
    peerBroadcast(state);
    const p = published.current;
    const key = state ? `${state.groupId}:${state.slide}:${state.recording}` : "";
    if (state ? key === p.key && Date.now() - p.at < PUBLISH_MS : !p.on) return;
    p.key = key;
    p.at = Date.now();
    p.on = !!state;
    p.queue = p.queue.then(() => roomApi.live(room.code, me.id, state)).then(() => undefined, () => undefined);
  }, [peerBroadcast, room.code, me.id]);

  // A teammate's take: my stage, transcript and timer follow it while I am not busy with my own.
  const rtcLive = peers.live && Date.now() - peers.live.seen < RTC_STALE_MS ? peers.live : null;
  const live = newerLive(rtcLive, serverLive);
  const followIndex = live?.recording && live.presenterId !== me.id && !busy(phase) && !rendering
    ? deck.groups.findIndex((g) => g.id === live.groupId)
    : -1;
  const follow = followIndex >= 0 ? live : null;
  const index = followIndex >= 0 ? followIndex : selected;
  const presenter = busy(phase) ? me.id : follow ? follow.presenterId : rendering ? null : room.assignments[deck.groups[index].id] ?? null;

  const missing = deck.groups.filter((g) => !complete(room.takes[g.id]) || progress[g.id] !== undefined);
  const total = deckMs(deck);
  const assign = (gi: number, personId: string | null) => void roomApi.assign(room.code, deck.groups[gi].id, personId).then(apply);
  // Each laptop claims its own speaker slot once: the slot is where its person first joined, remembered per
  // room, so leaving and rejoining keeps the same groups. Only free groups are claimed, and only on joining,
  // so a group someone set to Nobody stays that way.
  const claimed = useRef(false);
  useEffect(() => {
    if (claimed.current || !room.people.some((p) => p.id === me.id)) return;
    claimed.current = true;
    const key = `batatis.studio.slot.${room.code}.${me.name.toLowerCase()}`;
    const stored = Number(localStorage.getItem(key));
    const slot = Number.isInteger(stored) && localStorage.getItem(key) !== null ? stored : room.people.findIndex((p) => p.id === me.id);
    localStorage.setItem(key, String(slot));
    const mine = deck.groups.filter((g) => g.speaker === slot && !room.assignments[g.id]);
    void (async () => {
      for (const g of mine) apply(await roomApi.assign(room.code, g.id, me.id));
    })().catch(() => undefined);
  }, [apply, deck.groups, me.id, me.name, room.assignments, room.code, room.people]);
  const remove = (id: string) => void roomApi.leave(room.code, id).then((next) => {
    apply(next);
    if (id === me.id) onLeave();
  });

  return (
    <div className="st-room">
      <header className="st-top">
      <Brand as="span" />
      <Cams
        people={room.people}
        me={me}
        local={camera.stream}
        streams={peers.streams}
        failed={Object.fromEntries(Object.entries(peers.status).map(([id, s]) => [id, s === "failed"]))}
        presenter={presenter}
        mutedAll={mutedAll}
        locked={busy(phase)}
        onMuteAll={setMutedAll}
        onRemove={remove}
        onVideo={(id, el) => (peerVideos.current[id] = el)}
      />
      <div className="st-corner">
        <CopyLink code={room.code} />
        <SavedVideos deck={deck} room={room} upload={progress} />
        <span className={`st-total${total > VIDEO_LIMIT_MS ? " is-over" : ""}`} title="Planned length with intro and outro" aria-label={`Planned length ${clock(total)} of ${clock(VIDEO_LIMIT_MS)}`}>
          <Icon name="clock" size={14} />{clock(total)}<span className="st-total-of">/ {clock(VIDEO_LIMIT_MS)}</span>
        </span>
        {!rendering && (
          <button
            type="button"
            className={`cf-btn${missing.length ? "" : " is-primary"}`}
            disabled={missing.length > 0 || busy(phase)}
            title={missing.length ? `Missing: ${missing.map((g) => g.name).join(", ")}` : undefined}
            onClick={() => setRendering(true)}
          >
            <Icon name="film" size={15} />
            Make the video
          </button>
        )}
      </div>
      </header>

      {rendering ? (
        <div className="st-render">
          <Render deck={deck} room={room} onClose={() => setRendering(false)} />
        </div>
      ) : (
        <Booth
          key={deck.groups[index].id}
          deck={deck}
          index={index}
          room={room}
          me={me}
          camera={camera}
          phase={phase}
          setPhase={setPhase}
          preview={index === selected ? preview : 0}
          setPreview={setPreview}
          follow={follow}
          followVideo={follow ? peerVideos.current[follow.presenterId] ?? null : null}
          broadcast={publish}
          onShown={setShown}
          onAssign={(personId) => assign(index, personId)}
        />
      )}

      <Filmstrip
        deck={deck}
        room={room}
        me={me}
        group={rendering ? -1 : index}
        slide={shown}
        locked={busy(phase) || !!follow}
        assignLocked={busy(phase)}
        upload={progress}
        onPick={(gi, si) => {
          setRendering(false);
          setSelected(gi);
          setPreview(si);
        }}
        onAssign={assign}
      />
    </div>
  );
}

/** The canvas the stage paints. `onStage` hands the live Stage to the parent. */
export function StageCanvas({ deck, onStage, children }: { deck: Deck; onStage(stage: Stage | null): void; children?: React.ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    c.width = 1920;
    c.height = 1080;
    const stage = createStage(c, deck);
    onStage(stage);
    return () => {
      onStage(null);
      stage.destroy();
    };
  }, [deck, onStage]);
  return (
    <div className="st-stage">
      <canvas ref={canvas} />
      {children}
    </div>
  );
}

function Booth({ deck, index, room, me, camera, phase, setPhase, preview, setPreview, follow, followVideo, broadcast, onShown, onAssign }: {
  deck: Deck;
  index: number;
  room: RoomState;
  me: Person;
  camera: Camera;
  phase: Phase;
  setPhase(p: Phase): void;
  /** The slide shown while idle. */
  preview: number;
  setPreview(slide: number): void;
  /** A teammate's take in this group, mirrored read-only. */
  follow: HeardLive | null;
  followVideo: HTMLVideoElement | null;
  broadcast(state: LiveState | null): void;
  /** The slide on stage, for the filmstrip. */
  onShown(slide: number): void;
  onAssign(personId: string): void;
}) {
  const group = deck.groups[index];
  const target = targetMs(group);
  const last = group.slides.length - 1;
  const [stage, setStage] = useState<Stage | null>(null);
  const [replaySlide, setReplaySlide] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<Recording | null>(null);
  const cues = useRef<Cue[]>([]);
  const timers = useRef<number[]>([]);
  const attempt = useRef(0);
  const replay = useRef<HTMLVideoElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const send = useRef(broadcast);
  send.current = broadcast;
  const sent = useRef(false);

  const assignee = room.people.find((p) => p.id === room.assignments[group.id]);
  const mine = assignee?.id === me.id;
  const take = room.takes[group.id];
  const presenter = follow ? room.people.find((p) => p.id === follow.presenterId) : undefined;
  const following = !!follow;

  // One group on its own as a finished video: its slides, clips and the presenter, no intro or outro.
  const [saving, setSaving] = useState<number | null>(null);
  const saveVideo = async () => {
    if (saving !== null) return;
    setSaving(0);
    try {
      const media = phase.k === "review" ? phase.media
        : take && complete(take) ? await takeMedia(room.code, take, () => undefined, new AbortController().signal) : null;
      if (!media) return;
      await preload(deck);
      const { blob, mime } = await exportVideo({ deck, takes: { [group.id]: media }, cards: false, onProgress: (f) => setSaving(f) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `batatis-${group.id}.${mime.includes("mp4") ? "mp4" : "webm"}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setSaving(null);
    }
  };
  const canSave = phase.k === "review" || (phase.k === "idle" && complete(take));

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // Idle: the previewed slide (or the teammate's current one) with this device's camera, or theirs while following.
  const idleSlide = follow ? Math.min(last, follow.slide) : preview;
  const followCam = follow ? followVideo : null;
  const myFace = initials(me.name);
  const theirFace = presenter ? initials(presenter.name) : undefined;
  useEffect(() => {
    if (!stage || phase.k === "review") return;
    // While following, the teammate's camera, or their initials until it has a picture; never this device's camera.
    if (phase.k === "idle" && following) stage.setCamera(followCam, theirFace);
    else stage.setCamera(camera.live, myFace);
  }, [stage, camera.live, phase.k, following, followCam, myFace, theirFace]);
  const placed = useRef(false);
  useEffect(() => {
    if (!stage || phase.k !== "idle") return;
    stage.show(index, idleSlide, { instant: !following || !placed.current });
    placed.current = true;
  }, [stage, index, idleSlide, phase.k, following]);

  const finish = useCallback(async (auto: boolean) => {
    const r = rec.current;
    if (!r || phaseRef.current.k !== "recording") return;
    rec.current = null;
    clearTimers();
    const durationMs = auto ? target : Math.min(target, Math.round(performance.now() - r.startedAt));
    const { blob, mime } = await r.stop();
    setPhase({ k: "review", media: { blob, mime, cues: cues.current, durationMs } });
  }, [setPhase, target]);

  const start = useCallback(() => {
    if (!mine || following || !camera.stream || !stage || (phaseRef.current.k !== "idle" && phaseRef.current.k !== "review")) return;
    const token = ++attempt.current;
    (document.activeElement as HTMLElement | null)?.blur?.();
    stage.setCamera(camera.live, initials(me.name));
    stage.show(index, 0, { instant: true });
    setReplaySlide(0);
    setElapsed(0);
    setPhase({ k: "countdown", n: 3 });
    const stream = camera.stream;
    timers.current.push(
      window.setTimeout(() => setPhase({ k: "countdown", n: 2 }), 1000),
      window.setTimeout(() => setPhase({ k: "countdown", n: 1 }), 2000),
      window.setTimeout(() => {
        void startRecording(stream).then((r) => {
          if (token !== attempt.current) return r.cancel();
          rec.current = r;
          cues.current = [{ slide: 0, atMs: 0 }];
          stage.show(index, 0, { instant: true });
          setPhase({ k: "recording", startedAt: r.startedAt, slide: 0 });
          timers.current.push(window.setTimeout(() => void finish(true), target - (performance.now() - r.startedAt)));
        }, () => setPhase({ k: "idle" }));
      }, 3000),
    );
  }, [camera.live, camera.stream, finish, following, index, me.name, mine, setPhase, stage, target]);

  const cancel = useCallback(() => {
    attempt.current++;
    clearTimers();
    rec.current?.cancel();
    rec.current = null;
    setPhase({ k: "idle" });
  }, [setPhase]);

  const step = useCallback((d: 1 | -1) => {
    const p = phaseRef.current;
    if (p.k === "idle" && !following) return setPreview(Math.min(last, Math.max(0, preview + d)));
    if (p.k !== "recording" || !stage) return;
    const slide = Math.min(last, Math.max(0, p.slide + d));
    if (slide === p.slide) return;
    cues.current = [...cues.current, { slide, atMs: Math.round(performance.now() - p.startedAt) }];
    stage.show(index, slide);
    setPhase({ ...p, slide });
  }, [following, index, last, preview, setPhase, setPreview, stage]);

  // Leaving the group mid-take (or unmounting) never leaves a recorder running, or the team following a take that ended.
  useEffect(() => () => {
    attempt.current++;
    clearTimers();
    rec.current?.cancel();
    if (sent.current) send.current(null);
  }, []);

  // The countdown timer, and the live state the team follows (on start, on every slide change, ~4×/s).
  useEffect(() => {
    if (phase.k !== "recording") {
      if (sent.current) send.current(null);
      sent.current = false;
      return;
    }
    const tick = () => {
      const ms = performance.now() - phase.startedAt;
      setElapsed(ms);
      sent.current = true;
      send.current({ presenterId: me.id, groupId: group.id, slide: phase.slide, recording: true, remainingMs: Math.max(0, Math.round(target - ms)), targetMs: target, at: Date.now() });
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [phase, group.id, me.id, target]);

  // Review: the take is the camera and its cues drive the slides.
  const media = phase.k === "review" ? phase.media : null;
  useEffect(() => {
    if (!media || !stage) return;
    const url = URL.createObjectURL(media.blob);
    const v = document.createElement("video");
    v.playsInline = true;
    v.src = url;
    replay.current = v;
    let shown = -1;
    let raf = 0;
    const tick = () => {
      const ms = v.currentTime * 1000;
      const slide = slideAt(media.cues, ms);
      if (slide !== shown) {
        stage.show(index, slide, { instant: shown === -1 });
        shown = slide;
        setReplaySlide(slide);
      }
      setElapsed(Math.min(ms, media.durationMs));
      if (ms >= media.durationMs && !v.paused) v.pause();
      raf = requestAnimationFrame(tick);
    };
    stage.setCamera(v);
    void v.play().catch(() => undefined);
    tick();
    return () => {
      cancelAnimationFrame(raf);
      v.pause();
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      replay.current = null;
      stage.setCamera(camera.live, initials(me.name));
    };
  }, [media, stage, index, camera.live, me.name]);

  const keep = useCallback(async () => {
    if (!media) return;
    setPhase({ k: "idle" });
    await uploads.keep(room.code, group.id, me.id, media);
  }, [group.id, me.id, media, room.code, setPhase]);

  const again = () => {
    const v = replay.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play();
  };

  // Keys: R record, Space/→ next slide, ← back, Enter stop, Esc cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, select, textarea, [role=menu]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const p = phaseRef.current;
      if (e.key === "Escape" && (p.k === "countdown" || p.k === "recording")) {
        e.preventDefault();
        cancel();
      } else if ((p.k === "recording" || p.k === "idle") && (e.key === " " || e.key === "ArrowRight")) {
        if (p.k === "idle" && (e.key === " " || el.closest("button"))) return;
        e.preventDefault();
        step(1);
      } else if ((p.k === "recording" || p.k === "idle") && e.key === "ArrowLeft") {
        if (p.k === "idle" && el.closest("button")) return;
        e.preventDefault();
        step(-1);
      } else if (p.k === "recording" && e.key === "Enter") {
        e.preventDefault();
        void finish(false);
      } else if ((e.key === "r" || e.key === "R") && (p.k === "idle" || p.k === "review") && !e.repeat) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, finish, start, step]);

  const current = phase.k === "recording" ? phase.slide : phase.k === "review" ? replaySlide : phase.k === "countdown" ? 0 : follow ? idleSlide : null;
  const onStage = current ?? preview;
  useEffect(() => onShown(onStage), [onStage, onShown]);

  // The left column's clock: my take, the teammate's take, or the group's planned length.
  // A followed take's samples can be a second apart, so the clock ticks on its own in between.
  const [, tickFollow] = useState(0);
  useEffect(() => {
    if (!following) return;
    const t = window.setInterval(() => tickFollow((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, [following]);
  const followLeft = follow ? liveLeft(follow) : 0;
  const left = phase.k === "recording" ? Math.max(0, target - elapsed) : follow ? followLeft : target;
  const span = follow ? follow.targetMs || target : target;
  const live = phase.k === "recording" || !!follow;
  const fill = phase.k === "review" ? elapsed / phase.media.durationMs : live ? 1 - left / span : 0;
  const ending = live && left <= 10_000;

  return (
    <>
      <aside className="st-ctl" aria-label="Recording">
        <div className={`st-clock${live ? " is-live" : ""}${ending ? " is-ending" : ""}`} aria-live="off">
          {phase.k === "review" ? <>{clock(elapsed)}<small>/ {clock(phase.media.durationMs)}</small></> : clock(left)}
        </div>
        <div className={`st-track${ending ? " is-ending" : ""}${phase.k === "review" ? " is-review" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, fill) * 100)}>
          <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, fill))})` }} />
        </div>

        <div className="st-actions">
          {phase.k === "idle" && (follow ? (
            <span className="st-who-live"><span className="st-live" aria-hidden="true" />{presenter ? firstName(presenter.name) : "Recording"}</span>
          ) : mine ? (
            <button type="button" className={`cf-btn is-lg st-rec${take ? "" : " is-primary"}`} onClick={start} disabled={!camera.stream || !stage}>
              <span className="st-dot" />{take ? "Retake" : "Record"}<kbd className="cf-kbd">R</kbd>
            </button>
          ) : assignee ? (
            <span className="st-blocked"><span className="st-who-chip">{initials(assignee.name)}</span>{firstName(assignee.name)} records this</span>
          ) : (
            <button type="button" className="cf-btn is-lg" onClick={() => onAssign(me.id)}>Record this one</button>
          ))}
          {phase.k === "idle" && !follow && canSave && (
            <button type="button" className="cf-btn is-lg" onClick={() => void saveVideo()} disabled={saving !== null}>
              <Icon name="download" size={16} />{saving === null ? "Download video" : `Rendering ${Math.round(saving * 100)}%`}
            </button>
          )}
          {phase.k === "review" && saving !== null && <span className="st-step-n">Rendering {Math.round(saving * 100)}%</span>}
          {phase.k === "countdown" && (
            <button type="button" className="cf-btn is-lg" onClick={cancel}>Cancel<kbd className="cf-kbd">Esc</kbd></button>
          )}
          {phase.k === "recording" && (
            <button type="button" className="cf-btn is-lg st-stopbtn" onClick={() => void finish(false)} aria-label="Stop">
              <span className="st-square" />Stop<kbd className="cf-kbd">Enter</kbd>
            </button>
          )}
          {phase.k === "review" && (
            <>
              <button type="button" className="cf-btn is-primary is-lg" onClick={() => void keep()}>
                <Icon name="check" size={16} stroke={2.2} />Keep
              </button>
              <button type="button" className="cf-btn is-lg" onClick={start}>
                <Icon name="restart" size={15} />Retake
              </button>
              <span className="st-review-more">
                <button type="button" className="cf-icon-btn" onClick={() => void saveVideo()} disabled={saving !== null} aria-label="Download this group's video" title="Download this group's video">
                  <Icon name="download" size={16} />
                </button>
                <button type="button" className="cf-icon-btn" onClick={again} aria-label="Play again" title="Play again">
                  <Icon name="play" size={16} />
                </button>
                <button type="button" className="cf-icon-btn" onClick={() => setPhase({ k: "idle" })} aria-label="Discard take" title="Discard">
                  <Icon name="x" size={16} />
                </button>
              </span>
            </>
          )}
        </div>

        <div className="st-steps">
          <button type="button" className="cf-icon-btn" onClick={() => step(-1)} disabled={phase.k === "countdown" || phase.k === "review" || following || onStage === 0} aria-label="Previous slide" title="Previous slide (←)">
            <Icon name="prev" size={18} />
          </button>
          <span className="st-step-n">{onStage + 1} / {last + 1}</span>
          <button type="button" className="cf-icon-btn" onClick={() => step(1)} disabled={phase.k === "countdown" || phase.k === "review" || following || onStage === last} aria-label="Next slide" title="Next slide (→)">
            <Icon name="next" size={18} />
          </button>
        </div>
      </aside>

      <div className="st-stage-cell">
        <StageCanvas deck={deck} onStage={setStage}>
          {phase.k === "countdown" && <div className="st-count" aria-live="assertive">{phase.n}</div>}
        </StageCanvas>
      </div>

      <section className="st-script-col" aria-label={group.name}>
        <h1 className="st-script-title">
          <span className="st-script-dot" style={{ background: groupColor(index) }} aria-hidden="true" />
          {group.name}
        </h1>
        <Transcript
          group={group}
          current={current}
          onPick={phase.k === "idle" && !follow ? setPreview : undefined}
          picked={phase.k === "idle" && !follow ? preview : null}
        />
      </section>
    </>
  );
}

function Transcript({ group, current, picked, onPick }: { group: Group; current: number | null; picked: number | null; onPick?: (slide: number) => void }) {
  const list = useRef<HTMLOListElement>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);
  // The segment being spoken sits at the top with the next ones under it. Only the list scrolls,
  // never the page around it (scrollIntoView would also move the overflow-hidden ancestors).
  useEffect(() => {
    const el = current !== null ? refs.current[current] : null;
    if (el && list.current) list.current.scrollTo({ top: Math.max(0, el.offsetTop - 18), behavior: "smooth" });
  }, [current]);
  const last = group.script.length - 1;
  const at = current ?? picked ?? -1;
  const items = useMemo(() => group.script.map((text, i) => ({ text, i })), [group.script]);
  return (
    <ol ref={list} className={`st-script${current !== null ? " is-following" : ""}`} aria-label="Transcript">
      {items.map(({ text, i }) => (
        <li key={i} ref={(el) => { refs.current[i] = el; }} className={`st-seg${i === at ? " is-now" : i < at ? " is-past" : ""}`}>
          <button type="button" className="st-seg-hit" onClick={onPick ? () => onPick(i) : undefined} disabled={!onPick} aria-current={i === at || undefined}>
            <span className="st-seg-n" aria-label={`Slide ${i + 1}`}>{i + 1}</span>
            <span className="st-seg-text">
              {text}
              {i < last ? (
                <span className="st-next" role="img" aria-label="Next slide"><Icon name="next-arrow" size={15} stroke={2.2} /></span>
              ) : (
                <span className="st-stop" role="img" aria-label="Stop" />
              )}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// The room: cameras along the top, the timer on the left, the slide in the centre, the transcript on the right, every slide along the bottom.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { startRecording, type Recording } from "./recorder";
import { Render, takeMedia } from "./Render";
import { roomApi } from "./room";
import { SavedVideos } from "./SavedVideos";
import { createStage, exportVideo, preload, stageKey, type Stage } from "./stage";
import { cameraOf } from "./stage/camera";
import { CameraFrame } from "./CameraFrame";
import { Cams } from "./Cams";
import { Filmstrip, groupColor } from "./Filmstrip";
import { Brand, CopyLink, editLink, firstName, initials, slug, StartButton, type Camera } from "./parts";
import { startPlayback } from "./playback";
import { usePeers } from "./peers";
import { clock, deckMs, targetMs } from "./timing";
import { liveLeft, newerLive, type Cue, type Deck, type Group, type HeardLive, type LiveState, type Person, type Rect, type RoomState, type TakeInfo, type TakeMedia } from "./types";
import { uploads, useUploads } from "./uploads";

type Phase =
  | { k: "idle" }
  | { k: "countdown"; n: number }
  /** `target` is the group's length when the take started: an edit elsewhere never moves a running clock. */
  | { k: "recording"; startedAt: number; slide: number; target: number }
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
  // By id: a deck edited elsewhere can reorder or remove groups while this one is open.
  const [selected, setSelected] = useState(() => {
    const mine = deck.groups.find((g) => room.assignments[g.id] === me.id && !complete(room.takes[g.id]));
    return (mine ?? deck.groups[0]).id;
  });
  const [preview, setPreview] = useState(0);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [rendering, setRendering] = useState(false);
  const [mutedAll, setMutedAll] = useState(false);
  const [editing, setEditing] = useState(false);
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
  // The deck can lose groups while the room is open (edited on /r/CODE/edit).
  const index = followIndex >= 0 ? followIndex : Math.max(0, deck.groups.findIndex((g) => g.id === selected));
  // A take belongs to the group it was recorded in: if that group leaves the stage (removed elsewhere), so does the take.
  const boothGroup = deck.groups[index].id;
  useEffect(() => setPhase({ k: "idle" }), [boothGroup]);
  const presenter = busy(phase) ? me.id : follow ? follow.presenterId : rendering ? null : room.assignments[deck.groups[index].id] ?? null;

  const missing = deck.groups.filter((g) => !complete(room.takes[g.id]) || progress[g.id] !== undefined);
  const total = deckMs(deck);
  const assign = (gi: number, personId: string | null) => void roomApi.assign(room.code, deck.groups[gi].id, personId).then(apply);
  const remove = (id: string) => void roomApi.leave(room.code, id).then((next) => {
    apply(next);
    if (id === me.id) onLeave();
  });

  return (
    <div className="st-room">
      <header className="st-top">
      <div className="st-where">
        <Brand />
        <span className="st-deck-title" title={deck.title}>{deck.title}</span>
        {/* Hidden, not removed, while a take runs here: leaving would end it, and the header must not shift. */}
        <a
          className={`btn is-quiet is-sm st-edit-slides${busy(phase) ? " is-hidden" : ""}`}
          href={editLink(room.code)}
          aria-hidden={busy(phase) || undefined}
          tabIndex={busy(phase) ? -1 : undefined}
        >
          <Icon name="slides" size={16} />Edit slides
        </a>
      </div>
      <Cams
        people={room.people}
        me={me}
        camera={camera}
        streams={peers.streams}
        failed={Object.fromEntries(Object.entries(peers.status).map(([id, s]) => [id, s === "failed"]))}
        camOff={peers.camOff}
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
        <span className="st-total" title="Planned length with intro and outro" aria-label={`Planned length ${clock(total)}`}>
          <Icon name="clock" size={14} />{clock(total)}
        </span>
        {!rendering && (
          <button
            type="button"
            className={`btn ${missing.length ? "is-secondary" : "is-primary"}`}
            disabled={missing.length > 0 || busy(phase)}
            title={missing.length ? `Missing: ${missing.map((g) => g.name).join(", ")}` : undefined}
            onClick={() => setRendering(true)}
          >
            <Icon name="film" size={16} />
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
          preview={boothGroup === selected ? preview : 0}
          setPreview={setPreview}
          follow={follow}
          followVideo={follow ? peerVideos.current[follow.presenterId] ?? null : null}
          broadcast={publish}
          onShown={setShown}
          onAssign={(personId) => assign(index, personId)}
          editing={editing}
          setEditing={setEditing}
          apply={apply}
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
          setSelected(deck.groups[gi].id);
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
  // Rebuilt only when what it paints changes: a transcript edit leaves the stage (and the take on it) alone.
  const key = stageKey(deck);
  const latest = useRef(deck);
  latest.current = deck;
  useEffect(() => {
    const c = canvas.current!;
    c.width = 1920;
    c.height = 1080;
    const stage = createStage(c, latest.current);
    onStage(stage);
    return () => {
      onStage(null);
      stage.destroy();
    };
  }, [key, onStage]);
  return (
    <div className="st-stage">
      <canvas ref={canvas} />
      {children}
    </div>
  );
}

function Booth({ deck, index, room, me, camera, phase, setPhase, preview, setPreview, follow, followVideo, broadcast, onShown, onAssign, editing, setEditing, apply }: {
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
  /** The transcript is open for editing (kept across groups). */
  editing: boolean;
  setEditing(on: boolean): void;
  apply(next: RoomState): void;
}) {
  const group = deck.groups[index];
  const script = useScriptDraft(room.code, group, apply);
  // The planned length follows the words as they are typed; a running take keeps the length it started with.
  const planned = targetMs({ ...group, script: script.draft });
  const target = phase.k === "recording" ? phase.target : planned;
  const last = group.slides.length - 1;
  const [stage, setStage] = useState<Stage | null>(null);
  const [replaySlide, setReplaySlide] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<Recording | null>(null);
  const cues = useRef<Cue[]>([]);
  const timers = useRef<number[]>([]);
  const attempt = useRef(0);
  const replay = useRef<HTMLVideoElement | null>(null);
  const [refused, setRefused] = useState(false);
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
      a.download = `${slug(deck.title)}-${slug(group.name)}.${mime.includes("mp4") ? "mp4" : "webm"}`;
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
  // The camera tile's place: the room's, or where this device is dragging it until the room has the new one.
  const [camDraft, setCamDraft] = useState<Rect | null>(null);
  const camGesture = useRef(0);
  const camBox = camDraft ?? cameraOf(deck);
  useEffect(() => {
    stage?.placeCamera({ x: camBox.x, y: camBox.y, w: camBox.w, h: camBox.h });
  }, [stage, camBox.x, camBox.y, camBox.w, camBox.h]);
  const moveCam = useCallback((r: Rect) => {
    camGesture.current++;
    setCamDraft(r);
  }, []);
  const placeCam = useCallback(async (r: Rect) => {
    const gesture = ++camGesture.current;
    setCamDraft(r);
    try {
      apply(await roomApi.putDeck(room.code, { ...(await freshDeck(room.code)), camera: r }));
    } catch {
      // Not saved: the tile goes back to where the room has it.
    }
    if (gesture === camGesture.current) setCamDraft(null);
  }, [apply, room.code]);
  const placed = useRef(false);
  useEffect(() => {
    if (!stage || phase.k !== "idle") return;
    stage.show(index, idleSlide, { instant: !following || !placed.current });
    placed.current = true;
  }, [stage, index, idleSlide, phase.k, following]);

  const finish = useCallback(async (auto: boolean) => {
    const r = rec.current;
    const p = phaseRef.current;
    if (!r || p.k !== "recording") return;
    rec.current = null;
    clearTimers();
    const durationMs = auto ? p.target : Math.min(p.target, Math.round(performance.now() - r.startedAt));
    const { blob, mime } = await r.stop();
    setPhase({ k: "review", media: { blob, mime, cues: cues.current, durationMs } });
  }, [setPhase]);

  const start = useCallback(() => {
    if (!mine || following || !camera.stream || !camera.on || !stage || last < 0 || (phaseRef.current.k !== "idle" && phaseRef.current.k !== "review")) return;
    const token = ++attempt.current;
    const length = planned;
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
          setPhase({ k: "recording", startedAt: r.startedAt, slide: 0, target: length });
          timers.current.push(window.setTimeout(() => void finish(true), length - (performance.now() - r.startedAt)));
        }, () => setPhase({ k: "idle" }));
      }, 3000),
    );
  }, [camera.live, camera.on, camera.stream, finish, following, index, last, me.name, mine, planned, setPhase, stage]);

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
    v.addEventListener("playing", () => setRefused(false));
    replay.current = v;
    let live = true;
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
    void startPlayback(v).then((ok) => live && !ok && setRefused(true));
    tick();
    return () => {
      live = false;
      setRefused(false);
      cancelAnimationFrame(raf);
      v.pause();
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      replay.current = null;
      stage.setCamera(camera.live, initials(me.name));
    };
  }, [media, stage, index, camera.live, me.name]);

  // The review stays open until the take is safe on this device; a failed write leaves it there to try again.
  const [keepFailed, setKeepFailed] = useState(false);
  useEffect(() => setKeepFailed(false), [media]);
  const keeping = useRef(false);
  const keep = useCallback(async () => {
    if (!media || keeping.current) return;
    keeping.current = true;
    // Only the review this Keep came from closes: a retake started meanwhile carries on.
    const same = () => phaseRef.current.k === "review" && phaseRef.current.media === media;
    try {
      await uploads.keep(room.code, group.id, me.id, media);
      if (same()) {
        setKeepFailed(false);
        setPhase({ k: "idle" });
      }
    } catch (e) {
      console.error(e);
      if (same()) setKeepFailed(true);
    } finally {
      keeping.current = false;
    }
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
      // A saved take playing over the room has the keys.
      if (document.querySelector("[aria-modal=true]")) return;
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

  // The transcript can be edited only while nothing is being recorded here or followed from a teammate.
  const canEdit = phase.k === "idle" && !follow;
  const writing = editing && canEdit;
  const stopWriting = script.stop;
  useEffect(() => {
    if (!writing) stopWriting();
  }, [writing, stopWriting]);

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
            <button type="button" className={`btn is-lg st-rec ${take ? "is-secondary" : "is-primary"}`} onClick={start} disabled={!camera.stream || !camera.on || !stage || last < 0} title={camera.on ? undefined : "Camera off"}>
              <span className="st-dot" />{take ? "Retake" : "Record"}<kbd className="kbd">R</kbd>
            </button>
          ) : assignee ? (
            <span className="st-blocked"><span className="st-who-chip">{initials(assignee.name)}</span>{firstName(assignee.name)} records this</span>
          ) : (
            <button type="button" className="btn is-secondary is-lg" onClick={() => onAssign(me.id)}>
              <span className="st-who-chip is-none" aria-hidden="true" />Assign to me
            </button>
          ))}
          {phase.k === "idle" && !follow && canSave && (
            <button type="button" className="btn is-secondary is-lg" onClick={() => void saveVideo()} disabled={saving !== null}>
              <Icon name="download" size={16} />{saving === null ? "Download video" : `Rendering ${Math.round(saving * 100)}%`}
            </button>
          )}
          {phase.k === "review" && saving !== null && <span className="st-step-n">Rendering {Math.round(saving * 100)}%</span>}
          {phase.k === "review" && keepFailed && <p className="st-error" role="alert">Not saved</p>}
          {phase.k === "countdown" && (
            <button type="button" className="btn is-secondary is-lg" onClick={cancel}>Cancel<kbd className="kbd">Esc</kbd></button>
          )}
          {phase.k === "recording" && (
            <button type="button" className="btn is-secondary is-lg st-stopbtn" onClick={() => void finish(false)} aria-label="Stop">
              <span className="st-square" />Stop<kbd className="kbd">Enter</kbd>
            </button>
          )}
          {phase.k === "review" && (
            <>
              <button type="button" className="btn is-primary is-lg" onClick={() => void keep()}>
                <Icon name="check" size={16} />Keep
              </button>
              <button type="button" className="btn is-secondary is-lg" onClick={start}>
                <Icon name="restart" size={16} />Retake
              </button>
              <span className="st-review-more">
                <button type="button" className="icon-btn" onClick={() => void saveVideo()} disabled={saving !== null} aria-label="Download this group's video" data-tip="Download this group's video">
                  <Icon name="download" size={16} />
                </button>
                <button type="button" className="icon-btn" onClick={again} aria-label="Play again" data-tip="Play again">
                  <Icon name="play" size={16} />
                </button>
                <button type="button" className="icon-btn" onClick={() => setPhase({ k: "idle" })} aria-label="Discard take" data-tip="Discard">
                  <Icon name="x" size={16} />
                </button>
              </span>
            </>
          )}
        </div>

        <div className="st-steps">
          <button type="button" className="icon-btn" onClick={() => step(-1)} disabled={phase.k === "countdown" || phase.k === "review" || following || onStage === 0} aria-label="Previous slide" data-tip="Previous slide (←)">
            <Icon name="prev" size={20} />
          </button>
          <span className="st-step-n">{onStage + 1} / {last + 1}</span>
          <button type="button" className="icon-btn" onClick={() => step(1)} disabled={phase.k === "countdown" || phase.k === "review" || following || onStage === last} aria-label="Next slide" data-tip="Next slide (→)">
            <Icon name="next" size={20} />
          </button>
        </div>
      </aside>

      <div className="st-stage-cell">
        <StageCanvas deck={deck} onStage={setStage}>
          {canEdit && stage && <CameraFrame box={camBox} onChange={moveCam} onCommit={placeCam} />}
          {phase.k === "countdown" && <div className="st-count" aria-live="assertive">{phase.n}</div>}
          {refused && <StartButton onStart={again} />}
        </StageCanvas>
      </div>

      <section className="st-script-col" aria-label={group.name}>
        <header className="st-script-head">
          <h1 className="st-script-title">
            <span className="st-script-dot" style={{ background: groupColor(index) }} aria-hidden="true" />
            <span>{group.name}</span>
          </h1>
          {script.failed && <span className="st-error" role="alert">Not saved</span>}
          <button
            type="button"
            className={`icon-btn is-sm st-script-edit${writing ? " is-on" : ""}`}
            onClick={() => setEditing(!editing)}
            disabled={!canEdit}
            aria-pressed={writing}
            aria-label={writing ? "Done editing" : "Edit transcript"}
            data-tip={writing ? "Done" : "Edit transcript"}
          >
            <Icon name={writing ? "check" : "pencil"} size={16} />
          </button>
        </header>
        {writing ? (
          <ScriptEditor slides={Math.max(group.slides.length, script.draft.length)} draft={script.draft} at={preview} onChange={script.change} onFocus={(i) => { script.focus(true); setPreview(i); }} onBlur={() => script.focus(false)} />
        ) : (
          <Transcript
            script={script.draft}
            current={current}
            onPick={phase.k === "idle" && !follow ? setPreview : undefined}
            picked={phase.k === "idle" && !follow ? preview : null}
          />
        )}
      </section>
    </>
  );
}

function Transcript({ script, current, picked, onPick }: { script: string[]; current: number | null; picked: number | null; onPick?: (slide: number) => void }) {
  const list = useRef<HTMLOListElement>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);
  // The segment being spoken sits at the top with the next ones under it. Only the list scrolls,
  // never the page around it (scrollIntoView would also move the overflow-hidden ancestors).
  useEffect(() => {
    const el = current !== null ? refs.current[current] : null;
    if (el && list.current) list.current.scrollTo({ top: Math.max(0, el.offsetTop - 18), behavior: "smooth" });
  }, [current]);
  const last = script.length - 1;
  const at = current ?? picked ?? -1;
  const items = useMemo(() => script.map((text, i) => ({ text, i })), [script]);
  return (
    <ol ref={list} className={`st-script${current !== null ? " is-following" : ""}`} aria-label="Transcript">
      {items.map(({ text, i }) => (
        <li key={i} ref={(el) => { refs.current[i] = el; }} className={`st-seg${i === at ? " is-now" : i < at ? " is-past" : ""}`}>
          <button type="button" className="st-seg-hit" onClick={onPick ? () => onPick(i) : undefined} disabled={!onPick} aria-current={i === at || undefined}>
            <span className="st-seg-n" aria-label={`Slide ${i + 1}`}>{i + 1}</span>
            <span className="st-seg-text">
              {text}
              {i < last ? (
                <span className="st-next" role="img" aria-label="Next slide"><Icon name="arrow" size={16} /></span>
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

/** The room's deck as it is now, so a write that changes one part of it never puts back an older copy of the rest. */
async function freshDeck(code: string): Promise<Deck> {
  const { deck } = await roomApi.get(code);
  if (!deck) throw new Error("The room has no slides");
  return deck;
}

/** Debounce for transcript saves: one PUT per pause in typing. */
const SAVE_MS = 600;
const RETRY_SAVE_MS = 3000;

/**
 * The group's transcript as this device shows it. Edits go to the room a pause after the last key, as the room's
 * current deck with only this group's words changed. The room's copy flows in whenever this device is not typing and has nothing unsaved, so a poll
 * never overwrites words mid-sentence.
 */
function useScriptDraft(code: string, group: Group, apply: (next: RoomState) => void) {
  const pad = (script: string[]) => Array.from({ length: Math.max(group.slides.length, script.length) }, (_, i) => script[i] ?? "");
  const [draft, setDraft] = useState(() => pad(group.script));
  const [failed, setFailed] = useState(false);
  const groupRef = useRef(group);
  groupRef.current = group;
  const pending = useRef<string[] | null>(null);
  const inflight = useRef(false);
  const focused = useRef(false);
  const timer = useRef(0);

  const idle = () => !focused.current && !pending.current && !inflight.current;
  const sync = useCallback(() => {
    if (!idle()) return;
    const g = groupRef.current;
    setDraft(Array.from({ length: Math.max(g.slides.length, g.script.length) }, (_, i) => g.script[i] ?? ""));
  }, []);

  useEffect(() => sync(), [group.script, group.slides.length, sync]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const script = pending.current;
    if (!script || inflight.current) return;
    pending.current = null;
    inflight.current = true;
    const id = groupRef.current.id;
    let ok = false;
    try {
      const d = await freshDeck(code);
      if (d.groups.some((g) => g.id === id)) apply(await roomApi.putDeck(code, { ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, script } : g)) }));
      ok = true;
    } catch {
      pending.current ??= script;
    } finally {
      inflight.current = false;
    }
    setFailed(!ok);
    if (pending.current) timer.current = window.setTimeout(() => void flush(), ok ? SAVE_MS : RETRY_SAVE_MS);
    else sync();
  }, [apply, code, sync]);

  const change = useCallback((i: number, text: string) => {
    setDraft((cur) => {
      const next = cur.slice();
      next[i] = text;
      pending.current = next;
      return next;
    });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_MS);
  }, [flush]);

  const focus = useCallback((on: boolean) => {
    focused.current = on;
    if (!on) {
      void flush();
      sync();
    }
  }, [flush, sync]);

  /** Editing ended (Done, a take starting, the group changing): save now and follow the room again. */
  const stop = useCallback(() => focus(false), [focus]);

  // Leaving the group never drops the last words typed.
  useEffect(() => () => void flush(), [flush]);

  return { draft, failed, change, focus, stop };
}

/** Each slide's words as a plain text field, numbered like the transcript. */
function ScriptEditor({ slides, draft, at, onChange, onFocus, onBlur }: {
  slides: number;
  draft: string[];
  at: number;
  onChange(i: number, text: string): void;
  onFocus(i: number): void;
  onBlur(): void;
}) {
  return (
    <ol className="st-script is-editing" aria-label="Transcript">
      {Array.from({ length: slides }, (_, i) => (
        <li key={i} className={`st-seg${i === at ? " is-now" : ""}`}>
          <label className="st-seg-edit">
            <span className="st-seg-n" aria-label={`Slide ${i + 1}`}>{i + 1}</span>
            <textarea
              value={draft[i] ?? ""}
              rows={2}
              spellCheck
              onChange={(e) => onChange(i, e.target.value)}
              onFocus={() => onFocus(i)}
              onBlur={onBlur}
            />
          </label>
        </li>
      ))}
    </ol>
  );
}

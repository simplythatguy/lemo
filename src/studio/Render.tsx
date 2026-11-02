// Make the video: fetch every take this device lacks, then render intro + takes + outro in real time.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { slug, StartButton } from "./parts";
import { startPlayback } from "./playback";
import { roomApi, RoomError } from "./room";
import { createStage, exportVideo, preload } from "./stage";
import { takeCache } from "./takeCache";
import { Transport } from "./Transport";
import { clock, INTRO_MS, OUTRO_MS } from "./timing";
import type { Deck, RoomState, TakeInfo, TakeMedia } from "./types";
import "./render.css";

type State =
  | { k: "working"; label: string; fraction: number; leftMs?: number }
  | { k: "done"; url: string; mime: string; ms: number; poster: string }
  | { k: "failed"; message: string };

export async function takeMedia(room: string, info: TakeInfo, onBytes: (n: number) => void, signal: AbortSignal): Promise<TakeMedia> {
  const cached = await takeCache.byTakeId(info.id);
  if (cached && cached.blob.size === info.size) {
    onBytes(info.size);
    return { blob: cached.blob, mime: cached.mime, cues: cached.cues, durationMs: cached.durationMs };
  }
  const parts: Blob[] = [];
  for (let i = 0; i < info.chunks; i++) {
    const part = await roomApi.getChunk(room, info.id, i, signal);
    parts.push(part);
    onBytes(part.size);
  }
  const blob = new Blob(parts, { type: info.mime });
  await takeCache.put({
    key: info.id, room, groupId: info.groupId, personId: info.personId, takeId: info.id, blob, mime: info.mime,
    cues: info.cues, durationMs: info.durationMs, sent: info.chunks, createdAt: info.createdAt,
  });
  return { blob, mime: info.mime, cues: info.cues, durationMs: info.durationMs };
}

/** The video's length, and a still from its logo intro for the player (frame zero is a blank page). */
const inspect = (url: string) =>
  new Promise<{ ms: number; poster: string }>((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    let ms = 0;
    const still = () => {
      v.onseeked = () => {
        const c = document.createElement("canvas");
        c.width = 960;
        c.height = 540;
        let poster = "";
        try {
          c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
          poster = c.toDataURL("image/jpeg", 0.85);
        } catch {
          /* no still: the player shows its first frame */
        }
        resolve({ ms, poster });
      };
      v.currentTime = Math.min(INTRO_MS * 0.6, ms / 2) / 1000;
    };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) {
        ms = v.duration * 1000;
        return still();
      }
      // Recorded webm has no duration until it is seeked to the end.
      v.ondurationchange = () => {
        if (!Number.isFinite(v.duration) || ms) return;
        ms = v.duration * 1000;
        still();
      };
      v.currentTime = 1e9;
    };
    v.onerror = () => resolve({ ms, poster: "" });
    v.src = url;
  });

export function Render({ deck, room, onClose }: { deck: Deck; room: RoomState; onClose(): void }) {
  const [state, setState] = useState<State>({ k: "working", label: "Loading", fraction: 0 });
  const [attempt, setAttempt] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The deck and takes as they were when the render started; later polls and edits do not restart it.
  const takes = useRef(room.takes);
  const started = useRef(deck);

  useEffect(() => {
    const ctl = new AbortController();
    let url = "";
    const deck = started.current;
    setState({ k: "working", label: "Loading", fraction: 0 });
    // The first slide holds the picture while the takes download; the export paints over it from the intro on.
    let still: ReturnType<typeof createStage> | null = canvas.current ? createStage(canvas.current, deck) : null;
    still?.show(0, 0, { instant: true });
    const dropStill = () => {
      still?.destroy();
      still = null;
    };
    void (async () => {
      try {
        const infos = deck.groups.map((g) => takes.current[g.id]);
        const bytes = infos.reduce((s, t) => s + t.size, 0);
        let got = 0;
        const media: Record<string, TakeMedia> = {};
        for (const info of infos) {
          media[info.groupId] = await takeMedia(room.code, info, (n) => {
            got += n;
            setState({ k: "working", label: "Downloading", fraction: got / bytes });
          }, ctl.signal);
        }
        await preload(deck, (f) => setState({ k: "working", label: "Loading slides", fraction: f }));
        // It renders in real time: what is left of the video is how long until Download.
        const totalMs = INTRO_MS + infos.reduce((s, t) => s + t.durationMs, 0) + OUTRO_MS;
        dropStill();
        const opts: Parameters<typeof exportVideo>[0] = {
          deck,
          takes: media,
          signal: ctl.signal,
          canvas: canvas.current ?? undefined,
          monitor: true,
          onProgress: (fraction, label) => setState({ k: "working", label, fraction, leftMs: (1 - fraction) * totalMs }),
        };
        const { blob, mime } = await exportVideo(opts);
        url = URL.createObjectURL(blob);
        const { ms, poster } = await inspect(url);
        if (!ctl.signal.aborted) setState({ k: "done", url, mime, ms, poster });
      } catch (e) {
        if (ctl.signal.aborted) return;
        const message = e instanceof RoomError ? (e.status ? "Could not download every take" : e.message) : e instanceof Error ? e.message : "The render failed";
        setState({ k: "failed", message });
      }
    })();
    return () => {
      ctl.abort();
      dropStill();
      if (url) URL.revokeObjectURL(url);
    };
  }, [room.code, attempt]);

  return (
    <div className="st-booth">
      {state.k === "done" ? (
        <Finished deck={deck} url={state.url} mime={state.mime} ms={state.ms} poster={state.poster} onClose={onClose} />
      ) : (
        <>
          <div className={`st-stage is-export${state.k === "failed" ? " is-failed" : ""}`}>
            <canvas ref={canvas} width={1920} height={1080} />
          </div>
          {state.k === "working" ? (
            <div className="st-work">
              <span className="st-meter" role="progressbar" aria-label={state.label} aria-valuenow={Math.round(state.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ transform: `scaleX(${state.fraction})` }} />
              </span>
              <div className="st-work-row">
                <span className="st-work-part">{state.label}</span>
                <span className="st-work-left">
                  {state.leftMs === undefined ? `${Math.round(state.fraction * 100)}%` : `${clock(state.leftMs)} left`}
                </span>
                <button type="button" className="btn is-quiet is-sm st-work-cancel" onClick={onClose}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="st-work-row">
              <p className="st-error" role="alert">{state.message}</p>
              <button type="button" className="btn is-quiet" onClick={onClose}>Back to the room</button>
              <button type="button" className="btn is-primary" onClick={() => setAttempt((n) => n + 1)}>
                <Icon name="restart" size={16} />Try again
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The end of the flow: the finished video plays, with Download as the one thing to do next. */
function Finished({ deck, url, mime, ms, poster, onClose }: { deck: Deck; url: string; mime: string; ms: number; poster: string; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [refused, setRefused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let alive = true;
    let raf = 0;
    const tick = () => {
      setElapsed(Math.min(ms, v.currentTime * 1000));
      setPaused(v.paused);
      raf = requestAnimationFrame(tick);
    };
    tick();
    // In full screen the browser's own controls take over: the row under the video is not there.
    const full = () => (v.controls = document.fullscreenElement === v);
    v.addEventListener("fullscreenchange", full);
    void startPlayback(v).then((ok) => alive && setRefused(!ok));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      v.removeEventListener("fullscreenchange", full);
    };
  }, [url, ms]);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const seek = (at: number) => {
    if (video.current) video.current.currentTime = at / 1000;
  };
  const mute = () => {
    if (video.current) video.current.muted = !video.current.muted;
  };
  const fullScreen = () => {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?(): void }) | null;
    if (v?.requestFullscreen) void v.requestFullscreen().catch(() => undefined);
    else v?.webkitEnterFullscreen?.();
  };
  const ext = mime.includes("mp4") ? "mp4" : "webm";

  return (
    <>
      <div className="st-stage st-result">
        <video ref={video} src={url} poster={poster || undefined} playsInline onClick={toggle} onPlaying={() => setRefused(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)} />
        {refused && <StartButton onStart={toggle} />}
      </div>
      <div className="st-work-row">
        <Transport length={ms} elapsed={elapsed} paused={paused} muted={muted} ready onToggle={toggle} onSeek={seek} onMute={mute}>
          <button type="button" className="icon-btn" onClick={fullScreen} aria-label="Full screen" data-tip="Full screen">
            <Icon name="expand" size={16} />
          </button>
        </Transport>
        <button type="button" className="btn is-quiet" onClick={onClose}>Back to the room</button>
        <a className="btn is-primary is-lg" href={url} download={`${slug(deck.title)}-demo.${ext}`}>
          <Icon name="download" size={16} />Download
        </a>
      </div>
    </>
  );
}

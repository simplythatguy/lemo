// Make the video: fetch every take this device lacks, then render intro + takes + outro in real time.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { roomApi } from "./room";
import { exportVideo, preload } from "./stage";
import { takeCache } from "./takeCache";
import { clock, INTRO_MS, OUTRO_MS } from "./timing";
import type { Deck, RoomState, TakeInfo, TakeMedia } from "./types";

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
  const canvas = useRef<HTMLCanvasElement>(null);
  // The takes as they were when the render started; later polls do not restart it.
  const takes = useRef(room.takes);

  useEffect(() => {
    const ctl = new AbortController();
    let url = "";
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
        if (!ctl.signal.aborted) setState({ k: "failed", message: e instanceof Error ? e.message : "The render failed" });
      }
    })();
    return () => {
      ctl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [deck, room.code]);

  const ext = state.k === "done" && state.mime.includes("mp4") ? "mp4" : "webm";

  return (
    <div className="st-booth">
      <header className="st-booth-head">
        <button type="button" className="cf-icon-btn" onClick={onClose} aria-label="Back to the room" title="Back">
          <Icon name="back" size={18} />
        </button>
        <h1 className="st-title">The video</h1>
      </header>
      {state.k === "done" ? (
        <>
          <video className="st-result" src={state.url} poster={state.poster || undefined} controls playsInline />
          <div className="st-bar">
            <a className="cf-btn is-primary is-lg" href={state.url} download={`batatis-demo.${ext}`}>
              <Icon name="download" size={16} />Download
            </a>
            <span className="st-timer">{clock(state.ms)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="st-stage is-export">
            <canvas ref={canvas} width={1920} height={1080} />
          </div>
          <div className="st-bar">
            {state.k === "working" ? (
              <>
                <span className="st-work">{state.label}</span>
                <span className="st-meter" role="progressbar" aria-valuenow={Math.round(state.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ transform: `scaleX(${state.fraction})` }} />
                </span>
                {state.leftMs !== undefined && <span className="st-timer" aria-label={`${clock(state.leftMs)} left`}>{clock(state.leftMs)}</span>}
                <button type="button" className="cf-btn" onClick={onClose}>Cancel</button>
              </>
            ) : (
              <>
                <p className="st-error" role="alert">{state.message}</p>
                <button type="button" className="cf-btn" onClick={onClose}>Back</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

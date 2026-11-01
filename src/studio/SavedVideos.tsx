// Every saved take, in deck order (the order of the final video), for the whole room: play it, download it.
// Groups can be recorded in any order; the numbered rows always follow the deck.
import { useEffect, useRef, useState } from "react";
import { groupColor } from "./Filmstrip";
import { Icon } from "./icons";
import { initials } from "./parts";
import { takeMedia } from "./Render";
import { createStage, exportVideo, preload } from "./stage";
import { clock, targetMs } from "./timing";
import type { Cue, Deck, RoomState, TakeInfo, TakeMedia } from "./types";
import "./savedVideos.css";

const complete = (t: TakeInfo | undefined) => !!t && t.received >= t.chunks;

function slideAt(cues: Cue[], ms: number): number {
  let slide = 0;
  for (const c of cues) if (c.atMs <= ms) slide = c.slide;
  return slide;
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Renders the given takes in deck order and hands the file to the browser as <name>.mp4|webm. */
async function download(deck: Deck, room: string, takes: TakeInfo[], name: string, cards: boolean, onProgress: (f: number) => void) {
  const media: Record<string, TakeMedia> = {};
  for (const take of takes) media[take.groupId] = await takeMedia(room, take, () => undefined, new AbortController().signal);
  await preload(deck);
  const { blob, mime } = await exportVideo({ deck, takes: media, cards, onProgress: (f) => onProgress(f) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${mime.includes("mp4") ? "mp4" : "webm"}`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function SavedVideos({ deck, room, upload }: {
  deck: Deck;
  room: RoomState;
  /** groupId → fraction this device has uploaded. */
  upload: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [saving, setSaving] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && playing === null) setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("keydown", key);
    };
  }, [open, playing]);

  const saved = deck.groups.filter((g) => complete(room.takes[g.id]));
  const recordedMs = saved.reduce((s, g) => s + room.takes[g.id].durationMs, 0);
  const plannedMs = deck.groups.reduce((s, g) => s + targetMs(g), 0);

  const save = (take: TakeInfo) => {
    if (saving[take.groupId] !== undefined) return;
    const set = (f: number | null) => setSaving((m) => {
      const next = { ...m };
      if (f === null) delete next[take.groupId];
      else next[take.groupId] = f;
      return next;
    });
    set(0);
    // One group alone: no intro or outro.
    void download(deck, room.code, [take], `batatis-${take.groupId}`, false, set).catch(() => undefined).finally(() => set(null));
  };

  // Every saved group joined in deck order, with the intro and outro: the video so far, sound included.
  const [all, setAll] = useState<number | null>(null);
  const saveAll = () => {
    if (all !== null || !saved.length) return;
    setAll(0);
    void download(deck, room.code, saved.map((g) => room.takes[g.id]), "batatis-demo", true, setAll)
      .catch(() => undefined).finally(() => setAll(null));
  };

  return (
    <>
      <button
        type="button"
        className={`st-saved-btn${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Saved videos, ${saved.length} of ${deck.groups.length}`}
        title="Saved videos"
      >
        <StackIcon />
        <span className="st-saved-n">{saved.length}<span>/{deck.groups.length}</span></span>
      </button>

      {open && (
        <aside className="st-saved" aria-label="Saved videos">
          <header className="st-saved-head">
            <h2 className="st-saved-title">Saved</h2>
            <span className="st-saved-head-acts">
              <button type="button" className="cf-btn is-sm" onClick={saveAll} disabled={all !== null || !saved.length}
                aria-label={all === null ? `Download all ${saved.length} saved as one video` : `Rendering, ${Math.round(all * 100)}%`}>
                <Icon name="download" size={14} />{all === null ? "Download all" : `${Math.round(all * 100)}%`}
              </button>
              <button type="button" className="cf-icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close">
                <Icon name="x" size={16} />
              </button>
            </span>
          </header>
          <p className="st-saved-sum">
            {saved.length} of {deck.groups.length} recorded<span aria-hidden="true"> · </span>{clock(recordedMs)} of {clock(plannedMs)}
          </p>
          <div className="st-saved-bar" aria-hidden="true">
            {deck.groups.map((g, gi) => (
              <span
                key={g.id}
                style={{ flexGrow: targetMs(g), background: complete(room.takes[g.id]) ? groupColor(gi) : undefined }}
              />
            ))}
          </div>

          <ol className="st-saved-list">
            {deck.groups.map((g, gi) => {
              const take = room.takes[g.id];
              const done = complete(take);
              const who = room.people.find((p) => p.id === (take?.personId ?? room.assignments[g.id]));
              const up = upload[g.id] ?? (take && !done ? take.received / take.chunks : undefined);
              const s = saving[g.id];
              return (
                <li key={g.id} className={`st-saved-row${done ? "" : " is-empty"}`}>
                  <span className="st-saved-i">{gi + 1}</span>
                  <span className="st-saved-dot" style={{ background: groupColor(gi) }} aria-hidden="true" />
                  <span className="st-saved-main">
                    <span className="st-saved-name">{g.name}</span>
                    <span className="st-saved-meta">
                      {who && <span className="st-saved-who" title={who.name}>{initials(who.name)}</span>}
                      {up !== undefined ? (
                        `Uploading ${Math.round(up * 100)}%`
                      ) : done && take ? (
                        <>{clock(take.durationMs)}<span aria-hidden="true"> · </span>{ago(take.createdAt, now)}</>
                      ) : (
                        "Not recorded"
                      )}
                    </span>
                  </span>
                  {done && take && (
                    <span className="st-saved-acts">
                      <button type="button" className="cf-icon-btn" onClick={() => setPlaying(gi)} aria-label={`Play ${g.name}`} title="Play">
                        <Icon name="play" size={15} />
                      </button>
                      {s === undefined ? (
                        <button type="button" className="cf-icon-btn" onClick={() => save(take)} aria-label={`Download ${g.name}`} title="Download">
                          <Icon name="download" size={15} />
                        </button>
                      ) : (
                        <span className="st-saved-pct" role="status" aria-label={`Rendering ${g.name}, ${Math.round(s * 100)}%`}>{Math.round(s * 100)}%</span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>
      )}

      {playing !== null && room.takes[deck.groups[playing].id] && (
        <Player
          deck={deck}
          room={room.code}
          index={playing}
          take={room.takes[deck.groups[playing].id]}
          saving={saving[deck.groups[playing].id]}
          onSave={() => save(room.takes[deck.groups[playing].id])}
          onClose={() => setPlaying(null)}
        />
      )}
    </>
  );
}

/** The take replayed on its own stage: its video is the camera tile and its cues switch the slides. */
function Player({ deck, room, index, take, saving, onSave, onClose }: {
  deck: Deck;
  room: string;
  index: number;
  take: TakeInfo;
  saving: number | undefined;
  onSave(): void;
  onClose(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = useState<number | null>(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const group = deck.groups[index];
  const length = take.durationMs;
  // The room poll hands over a fresh take object every 2 s; only a different take restarts the player.
  const current = useRef(take);
  current.current = take;

  useEffect(() => {
    const take = current.current;
    const ctl = new AbortController();
    const c = canvas.current!;
    c.width = 1920;
    c.height = 1080;
    const stage = createStage(c, deck);
    stage.show(index, 0, { instant: true });
    let raf = 0;
    let url = "";
    const v = document.createElement("video");
    v.playsInline = true;
    void (async () => {
      let got = 0;
      const media: TakeMedia = await takeMedia(room, take, (n) => {
        got += n;
        setLoaded(Math.min(1, got / take.size));
      }, ctl.signal);
      await preload(deck);
      if (ctl.signal.aborted) return;
      url = URL.createObjectURL(media.blob);
      v.src = url;
      video.current = v;
      let shown = 0;
      const tick = () => {
        const ms = v.currentTime * 1000;
        const slide = slideAt(media.cues, ms);
        if (slide !== shown) {
          stage.show(index, slide);
          shown = slide;
        }
        setElapsed(Math.min(ms, length));
        if (ms >= length && !v.paused) v.pause();
        setPaused(v.paused);
        raf = requestAnimationFrame(tick);
      };
      stage.setCamera(v);
      setLoaded(null);
      void v.play().catch(() => undefined);
      tick();
    })().catch(() => undefined);
    return () => {
      ctl.abort();
      cancelAnimationFrame(raf);
      v.pause();
      v.removeAttribute("src");
      v.load();
      if (url) URL.revokeObjectURL(url);
      video.current = null;
      stage.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, index, length, room, take.id]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime * 1000 >= length - 50) v.currentTime = 0;
      void v.play();
    } else v.pause();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === " " && !(e.target as HTMLElement).closest("button")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = video.current;
    if (!v) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = (Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * length) / 1000;
  };

  return (
    <div className="st-play" role="dialog" aria-modal="true" aria-label={group.name} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-play-box">
        <header className="st-play-head">
          <span className="st-saved-i">{index + 1}</span>
          <span className="st-saved-dot" style={{ background: groupColor(index) }} aria-hidden="true" />
          <h2 className="st-play-title">{group.name}</h2>
          <button type="button" className="cf-icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="st-stage">
          <canvas ref={canvas} />
          {loaded !== null && <div className="st-play-load">{Math.round(loaded * 100)}%</div>}
        </div>
        <div className="st-play-bar">
          <button type="button" className="cf-icon-btn" onClick={toggle} disabled={loaded !== null} aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"}>
            {paused ? <Icon name="play" size={16} /> : <PauseIcon />}
          </button>
          <div className="st-play-track" onPointerDown={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(length / 1000)} aria-valuenow={Math.round(elapsed / 1000)}>
            <span style={{ transform: `scaleX(${length ? Math.min(1, elapsed / length) : 0})` }} />
          </div>
          <span className="st-play-time">{clock(elapsed)}<small> / {clock(length)}</small></span>
          {saving === undefined ? (
            <button type="button" className="cf-icon-btn" onClick={onSave} aria-label={`Download ${group.name}`} title="Download">
              <Icon name="download" size={16} />
            </button>
          ) : (
            <span className="st-saved-pct" role="status">{Math.round(saving * 100)}%</span>
          )}
        </div>
      </div>
    </div>
  );
}

const StackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="9" width="18" height="12" rx="2" />
    <path d="M6 5.5h12M9 2h6" />
    <path d="m10.5 12.5 4 2.5-4 2.5z" fill="currentColor" stroke="none" />
  </svg>
);

const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="4.5" width="4" height="15" rx="1" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" />
  </svg>
);

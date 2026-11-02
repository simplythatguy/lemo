// Every saved take, in deck order (the order of the final video), for the whole room: play it, download it.
// Groups can be recorded in any order; the numbered rows always follow the deck.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { firstName, slug, StartButton } from "./parts";
import { startPlayback } from "./playback";
import { takeMedia } from "./Render";
import { createStage, exportVideo, preload, stageKey } from "./stage";
import { clock } from "./timing";
import { Transport } from "./Transport";
import type { Cue, Deck, RoomState, TakeInfo, TakeMedia } from "./types";
import "./savedVideos.css";

const complete = (t: TakeInfo | undefined) => !!t && t.received >= t.chunks;

function slideAt(cues: Cue[], ms: number): number {
  let slide = 0;
  for (const c of cues) if (c.atMs <= ms) slide = c.slide;
  return slide;
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
  /** The group whose take is playing, by id: the deck can change under the player. */
  const [playing, setPlaying] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, number>>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && playing === null) setOpen(false);
    };
    // The player opens over the popover: its clicks must not close the list under it.
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (playing === null && !panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", away);
    };
  }, [open, playing]);

  // Wide screens hang the popover under its trigger; phones get a bottom sheet from CSS.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      // The same width as the bottom sheet in savedVideos.css.
      setAt(r && !matchMedia("(max-width: 600px)").matches ? { top: r.bottom + 8, right: Math.max(16, innerWidth - r.right) } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const saved = deck.groups.filter((g) => complete(room.takes[g.id]));
  // In whole seconds as each row shows them, so the rows add up to the total.
  const recordedMs = saved.reduce((s, g) => s + Math.ceil(room.takes[g.id].durationMs / 1000) * 1000, 0);

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
    const group = deck.groups.find((g) => g.id === take.groupId);
    void download(deck, room.code, [take], `${slug(deck.title)}-${slug(group?.name ?? take.groupId)}`, false, set).catch(() => undefined).finally(() => set(null));
  };

  // Every saved group joined in deck order, with the intro and outro: the video so far, sound included.
  const [all, setAll] = useState<number | null>(null);
  const saveAll = () => {
    if (all !== null || !saved.length) return;
    setAll(0);
    void download(deck, room.code, saved.map((g) => room.takes[g.id]), `${slug(deck.title)}-demo`, true, setAll)
      .catch(() => undefined).finally(() => setAll(null));
  };

  const playingIndex = deck.groups.findIndex((g) => g.id === playing);
  const playable = playingIndex >= 0 && !!room.takes[playing!];
  // The group or its take went away under the player: it closes, and Escape closes the list again.
  useEffect(() => {
    if (playing !== null && !playable) setPlaying(null);
  }, [playing, playable]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`st-saved-btn${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Saved videos, ${saved.length} of ${deck.groups.length}`}
        data-tip="Saved videos"
      >
        <Icon name="saved" />
        <span className="st-saved-n">{saved.length}<span>/{deck.groups.length}</span></span>
      </button>

      {open && !playable && (
        <>
          <div className="st-saved-dim" aria-hidden="true" />
          <aside ref={panel} className="st-saved" aria-label="Saved videos" style={at ?? undefined}>
            <header className="st-saved-head">
              <h2 className="st-saved-title">Saved</h2>
              <button type="button" className="icon-btn is-sm" onClick={() => setOpen(false)} aria-label="Close" data-tip="Close">
                <Icon name="x" size={16} />
              </button>
            </header>
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
                    <span className="st-saved-main">
                      <span className="st-saved-name">{g.name}</span>
                      {who && <span className="st-saved-who">{firstName(who.name)}</span>}
                    </span>
                    <span className="st-saved-len">
                      {up !== undefined ? `Uploading ${Math.round(up * 100)}%` : done && take ? clock(take.durationMs) : "Not recorded"}
                    </span>
                    <span className="st-saved-acts">
                      {done && take && (
                        <>
                          <button type="button" className="icon-btn is-sm" onClick={() => setPlaying(g.id)} aria-label={`Play ${g.name}`} data-tip="Play">
                            <Icon name="play" size={16} />
                          </button>
                          {s === undefined ? (
                            <button type="button" className="icon-btn is-sm" onClick={() => save(take)} aria-label={`Download ${g.name}`} data-tip="Download">
                              <Icon name="download" size={16} />
                            </button>
                          ) : (
                            <span className="st-saved-pct" role="status" aria-label={`Rendering ${g.name}, ${Math.round(s * 100)}%`}>{Math.round(s * 100)}%</span>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            {saved.length > 0 && (
              <footer className="st-saved-foot">
                <button type="button" className="btn is-quiet is-sm st-saved-all" onClick={saveAll} aria-busy={all !== null}
                  aria-label={all === null ? `Download all ${saved.length} saved as one video` : `Rendering, ${Math.round(all * 100)}%`}>
                  <Icon name="download" size={16} />{all === null ? "Download all" : `Rendering ${Math.round(all * 100)}%`}
                </button>
                <span className="st-saved-sum">
                  {saved.length} of {deck.groups.length} recorded<span aria-hidden="true"> · </span>{clock(recordedMs)}
                </span>
              </footer>
            )}
          </aside>
        </>
      )}

      {playable && (
        <Player
          deck={deck}
          room={room.code}
          index={playingIndex}
          take={room.takes[playing!]}
          saving={saving[playing!]}
          onSave={() => save(room.takes[playing!])}
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
  const [muted, setMuted] = useState(false);
  const [refused, setRefused] = useState(false);
  const group = deck.groups[index];
  const length = take.durationMs;
  // The room poll hands over a fresh take object every 2 s; only a different take restarts the player.
  const current = useRef(take);
  current.current = take;
  const latestDeck = useRef(deck);
  latestDeck.current = deck;
  // A teammate's retake swaps the video under the player; the sound stays as it was set.
  const mutedNow = useRef(muted);
  mutedNow.current = muted;
  const painted = stageKey(deck);

  useEffect(() => {
    const take = current.current;
    const deck = latestDeck.current;
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
    v.muted = mutedNow.current;
    v.addEventListener("playing", () => setRefused(false));
    v.addEventListener("volumechange", () => setMuted(v.muted));
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
      tick();
      if (!(await startPlayback(v)) && !ctl.signal.aborted) setRefused(true);
    })().catch(() => undefined);
    return () => {
      ctl.abort();
      cancelAnimationFrame(raf);
      v.pause();
      v.removeAttribute("src");
      v.load();
      if (url) URL.revokeObjectURL(url);
      video.current = null;
      setRefused(false);
      stage.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painted, index, length, room, take.id]);

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

  const seekTo = (ms: number) => {
    const v = video.current;
    if (v) v.currentTime = ms / 1000;
  };
  const mute = () => {
    const v = video.current;
    if (v) v.muted = !v.muted;
  };

  return (
    <div className="st-play" role="dialog" aria-modal="true" aria-label={group.name} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-play-box">
        <header className="st-play-head">
          <h2 className="st-play-title">{group.name}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" data-tip="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="st-stage">
          <canvas ref={canvas} />
          {loaded !== null && (
            <div className="st-play-load" role="progressbar" aria-label="Loading" aria-valuenow={Math.round(loaded * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ transform: `scaleX(${loaded})` }} />
            </div>
          )}
          {refused && <StartButton onStart={toggle} />}
        </div>
        <Transport length={length} elapsed={elapsed} paused={paused} muted={muted} ready={loaded === null} onToggle={toggle} onSeek={seekTo} onMute={mute}>
          {saving === undefined ? (
            <button type="button" className="icon-btn" onClick={onSave} aria-label={`Download ${group.name}`} data-tip="Download">
              <Icon name="download" size={16} />
            </button>
          ) : (
            <span className="st-saved-pct" role="status" aria-label={`Rendering ${group.name}, ${Math.round(saving * 100)}%`}>{Math.round(saving * 100)}%</span>
          )}
        </Transport>
      </div>
    </div>
  );
}

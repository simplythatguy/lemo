// Everyone's camera along the top (small circles on a phone): your own first, then as many as fit (four at most, so
// the top bar stays quieter than the stage), then a quiet "+N".
// Any tile, circle or the "+N" opens the People list, the one place to remove someone or leave (and, on a phone, to
// switch your camera). A camera with no picture is a dark tile with the person's initials. The team hears everyone;
// only the presenter's mic goes into the video, and only their tile shows a mic. A red ring marks whoever is recording.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { CameraToggle, firstName, initials, Menu, type Camera } from "./parts";
import type { Person } from "./types";

const MOST_TILES = 4;

export function Cams({ people, me, camera, streams, failed, camOff, presenter, recording, mutedAll, locked, onMuteAll, onRemove, onVideo }: {
  people: Person[];
  me: Person;
  camera: Camera;
  streams: Record<string, MediaStream>;
  failed: Record<string, boolean>;
  /** Teammates who turned their camera off: their stream still has a video track, with no picture coming. */
  camOff: Record<string, boolean>;
  presenter: string | null;
  /** The presenter is recording now (here or followed from a teammate). */
  recording: boolean;
  mutedAll: boolean;
  locked: boolean;
  onMuteAll(muted: boolean): void;
  onRemove(id: string): void;
  /** Each remote camera's element, so the stage can show the presenter while following their take. */
  onVideo(id: string, el: HTMLVideoElement | null): void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<HTMLElement | null>(null);
  /** How many tiles fit in the width the top bar grants: Infinity while every tile does. */
  const [room, setRoom] = useState(Infinity);
  const team = people.length > 1;
  const mine = people.find((p) => p.id === me.id);
  const order = mine ? [mine, ...people.filter((p) => p !== mine)] : people;
  const fit = Math.min(order.length, room, MOST_TILES);
  const shown = new Set(order.slice(0, fit).map((p) => p.id));
  // Whoever presents stays in view, so the red ring is never behind the "+N".
  if (presenter && !shown.has(presenter) && fit > 1) {
    shown.delete(order[fit - 1].id);
    shown.add(presenter);
  }
  const more = order.length - fit;

  // Someone who leaves fades out where they were while the others close the gap.
  const [leaving, setLeaving] = useState<Person[]>([]);
  const [known, setKnown] = useState(people);
  if (known !== people) {
    setKnown(people);
    const gone = known.filter((p) => !people.some((q) => q.id === p.id));
    if (gone.length) setLeaving((l) => [...l, ...gone]);
  }
  const fading = leaving.filter((p) => !people.some((q) => q.id === p.id));

  // Where every tile and button was painted before the team changed, so they glide to their new places.
  const lineup = order.map((p) => p.id).join();
  const glide = useRef<{ lineup: string; from: Map<string, DOMRect> | null }>({ lineup, from: null });
  if (lineup !== glide.current.lineup && !glide.current.from && row.current) glide.current.from = placesIn(row.current);

  // The row asks for the width of its tiles (and the "+N" past the fourth); the top bar grants what it can spare, and
  // the tiles that fit show.
  // Hidden tiles stay mounted: their sound keeps playing and the stage can still follow their camera.
  const measure = useCallback(() => {
    const el = row.current!;
    const s = getComputedStyle(el);
    const tile = el.querySelector<HTMLElement>(".st-tile:not([hidden], .is-leaving)")?.offsetWidth ?? 0;
    const gap = parseFloat(s.columnGap) || 0;
    const pad = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
    const sound = el.querySelector<HTMLElement>(".st-cams-sound")?.offsetWidth ?? 0;
    const plus = el.querySelector<HTMLElement>(".st-cams-more")?.offsetWidth || tile;
    const extra = sound ? sound + gap : 0;
    const asked = Math.min(people.length, MOST_TILES);
    const all = asked * tile + (asked - 1) * gap + (asked < people.length ? gap + plus : 0);
    el.style.width = `${Math.ceil(pad + all + extra)}px`;
    const granted = el.clientWidth - pad - extra;
    const next = all <= granted + 0.5 ? Infinity : Math.max(1, Math.floor((granted - plus) / (tile + gap)));
    setRoom(next);
    return next;
  }, [people.length]);

  useLayoutEffect(() => {
    const el = row.current!;
    const watch = new ResizeObserver(() => void measure());
    watch.observe(el);
    watch.observe(el.parentElement!);
    return () => watch.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    const el = row.current!;
    // A first pass with a stale fit is never painted: glide from what was, once the row has settled.
    if (measure() !== room) return;
    const g = glide.current;
    if (g.lineup === lineup) return;
    const from = g.from;
    glide.current = { lineup, from: null };
    if (!from) return;
    const box = el.getBoundingClientRect();
    const unseen: string[] = [];
    for (const t of el.querySelectorAll<HTMLElement>(".st-tile.is-leaving")) {
      const was = from.get(t.dataset.place!);
      if (!was) unseen.push(t.dataset.place!);
      else {
        t.style.left = `${was.left - box.left}px`;
        t.style.top = `${was.top - box.top}px`;
      }
    }
    // They were behind the "+N": nothing on screen to fade.
    if (unseen.length) setLeaving((l) => l.filter((p) => !unseen.includes(p.id)));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = getComputedStyle(document.documentElement);
    const timing = { duration: parseFloat(root.getPropertyValue("--dur-sheet")), easing: root.getPropertyValue("--ease").trim() };
    for (const [key, now] of placesIn(el)) {
      const was = from.get(key);
      const dx = was ? was.left - now.left : 0;
      if (Math.abs(dx) > 0.5) el.querySelector<HTMLElement>(`[data-place="${key}"]`)?.animate({ translate: [`${dx}px 0`, "0 0"] }, timing);
    }
  });

  // The list closes with the "+N" or circle it hangs from (everyone fits again, or that person left).
  useLayoutEffect(() => {
    if (list && !list.getClientRects().length) setList(null);
  });

  const open = (anchor: HTMLElement) => setList((a) => (a === anchor ? null : anchor));
  return (
    <div ref={row} className="st-cams" aria-label="People">
      {order.map((p) => {
        const own = p.id === me.id;
        return (
          <Tile
            key={p.id}
            person={p}
            mine={own}
            hidden={!shown.has(p.id)}
            camera={own ? camera : undefined}
            stream={own ? camera.stream : streams[p.id] ?? null}
            off={own ? !camera.on : !!camOff[p.id]}
            presenting={p.id === presenter}
            recording={recording && p.id === presenter}
            audible={!own && !mutedAll}
            locked={locked}
            onOpen={open}
            onVideo={own ? undefined : (el) => onVideo(p.id, el)}
          />
        );
      })}
      {fading.map((p) => (
        <Tile
          key={p.id}
          person={p}
          mine={false}
          hidden={false}
          leaving
          stream={streams[p.id] ?? null}
          off={!!camOff[p.id]}
          presenting={false}
          recording={false}
          audible={false}
          locked
          onOpen={() => undefined}
          onGone={() => setLeaving((l) => l.filter((q) => q.id !== p.id))}
        />
      ))}
      {more > 0 && (
        <button
          type="button"
          data-place="more"
          className="btn is-quiet st-cams-more"
          aria-haspopup="dialog"
          aria-expanded={!!list}
          aria-label={`+${more}, show everyone`}
          data-tip="Everyone"
          onClick={(e) => open(e.currentTarget)}
        >
          +{more}
        </button>
      )}
      {team && (
        <button
          type="button"
          data-place="sound"
          className="icon-btn st-cams-sound"
          aria-pressed={mutedAll}
          aria-label={mutedAll ? "Unmute the team" : "Mute the team on this laptop"}
          data-tip={mutedAll ? "Unmute" : "Mute"}
          onClick={() => onMuteAll(!mutedAll)}
        >
          <Icon name={mutedAll ? "speaker-off" : "speaker"} />
        </button>
      )}
      <Menu role="dialog" label="People" anchor={list} onClose={() => setList(null)}>
        {list && (
          <ul className="st-people">
            {order.map((p) => {
              const own = p.id === me.id;
              return (
                <li key={p.id} className="st-people-row">
                  <span className="st-menu-name">{own ? `${p.name} (you)` : p.name}</span>
                  {p.id === presenter && (
                    <span className="st-people-state is-live" role="img" aria-label="Presenting: this mic is recorded">
                      <Icon name="mic" size={14} />
                    </span>
                  )}
                  {!own && camOff[p.id] && (
                    <span className="st-people-state" role="img" aria-label="Camera off">
                      <Icon name="camera-off" size={14} />
                    </span>
                  )}
                  {!own && failed[p.id] && !streams[p.id] && <span className="st-people-state">No video</span>}
                  {own && <CameraToggle camera={camera} className="icon-btn is-sm" size={16} disabled={locked} />}
                  <button
                    type="button"
                    className="icon-btn is-sm"
                    disabled={locked}
                    aria-label={own ? "Leave the room" : `Remove ${p.name}`}
                    data-tip={own ? "Leave" : "Remove"}
                    onClick={() => onRemove(p.id)}
                  >
                    <Icon name={own ? "leave" : "x"} size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Menu>
    </div>
  );
}

function Tile({ person, mine, hidden, leaving, camera, stream, off, presenting, recording, audible, locked, onOpen, onVideo, onGone }: {
  person: Person;
  mine: boolean;
  /** Past the room the top bar has: only in the People list. */
  hidden: boolean;
  /** They left: the tile fades out where it was, then `onGone`. */
  leaving?: boolean;
  /** This device's camera, on my own tile only. */
  camera?: Camera;
  stream: MediaStream | null;
  off: boolean;
  presenting: boolean;
  recording: boolean;
  audible: boolean;
  locked: boolean;
  /** The whole tile opens the People list. */
  onOpen(anchor: HTMLElement): void;
  onVideo?: (el: HTMLVideoElement | null) => void;
  onGone?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);
  // Sound plays from its own <audio>: the video stays muted so it can always autoplay. Browsers refuse
  // unmuted playback until the page has had a click or key press, so retry on the next one.
  const sound = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = sound.current;
    if (!a) return;
    if (a.srcObject !== stream) a.srcObject = mine ? null : stream;
    a.muted = !audible;
    if (!stream || mine || !audible) return;
    const play = () => void a.play().catch(() => undefined);
    play();
    const retry = () => { if (a.paused) play(); };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
    return () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
    };
  }, [audible, mine, stream]);
  useEffect(() => {
    onVideo?.(stream ? video.current : null);
    return () => onVideo?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);
  const picture = usePicture(video, stream) && !off;

  return (
    <figure
      hidden={hidden}
      data-place={person.id}
      className={`st-tile${recording ? " is-live" : ""}${picture ? "" : " is-empty"}${mine ? " is-mine" : ""}${off ? " is-off" : ""}${leaving ? " is-leaving" : ""}`}
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
      onAnimationEnd={leaving ? (e) => e.animationName === "st-tile-out" && onGone?.() : undefined}
    >
      <video ref={video} autoPlay playsInline muted />
      <audio ref={sound} autoPlay />
      {/* No picture: the initials alone, with the full name in the tile's tooltip (and "No video" in the People list). */}
      {picture ? <figcaption>{firstName(person.name)}</figcaption> : <span className="st-tile-face" aria-hidden="true">{initials(person.name)}</span>}
      <button
        type="button"
        className="st-tile-menu"
        aria-haspopup="dialog"
        aria-label={person.name}
        data-tip={person.name}
        onClick={(e) => onOpen(e.currentTarget)}
      />
      {presenting && (
        <span className="st-tile-mic" role="img" aria-label="Presenting: this mic is recorded">
          <Icon name="mic" size={12} />
        </span>
      )}
      {camera && <CameraToggle camera={camera} className="st-tile-cam" size={14} disabled={locked} />}
    </figure>
  );
}

/** Where each tile and button of the row is on screen, by its `data-place`. */
function placesIn(row: HTMLElement): Map<string, DOMRect> {
  const at = new Map<string, DOMRect>();
  for (const el of row.querySelectorAll<HTMLElement>("[data-place]:not(.is-leaving)")) if (el.getClientRects().length) at.set(el.dataset.place!, el.getBoundingClientRect());
  return at;
}

/** Whether `stream` is painting frames into the element: false with no stream, before the first frame, and while the track is muted or ended. */
function usePicture(video: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const v = video.current;
    setOn(false);
    if (!v || !stream) return;
    const tracks = stream.getVideoTracks();
    const check = () => setOn(v.videoWidth > 0 && tracks.some((t) => t.readyState === "live" && !t.muted));
    const media = ["loadeddata", "playing", "resize", "emptied"] as const;
    const track = ["mute", "unmute", "ended"] as const;
    media.forEach((e) => v.addEventListener(e, check));
    tracks.forEach((t) => track.forEach((e) => t.addEventListener(e, check)));
    check();
    // A track stopped on this device fires no event; look again now and then.
    const poll = window.setInterval(check, 1000);
    return () => {
      window.clearInterval(poll);
      media.forEach((e) => v.removeEventListener(e, check));
      tracks.forEach((t) => track.forEach((e) => t.removeEventListener(e, check)));
    };
  }, [video, stream]);
  return on;
}

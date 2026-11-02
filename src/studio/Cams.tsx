// Everyone's camera along the top (small circles on a phone): your own first, then as many as fit, then a quiet "+N".
// Any tile, circle or the "+N" opens the People list, the one place to remove someone or leave (and, on a phone, to
// switch your camera). A camera with no picture is a dark tile with the person's initials. The team hears everyone;
// only the presenter's mic goes into the video, and only their tile shows a mic. A red ring marks whoever is recording.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { CameraToggle, firstName, initials, Menu, type Camera } from "./parts";
import type { Person } from "./types";

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
  /** The row's width with every tile in it, and how many tiles fit in the width the top bar gives it. */
  const [size, setSize] = useState<{ width: number; fit: number } | null>(null);
  const team = people.length > 1;
  const mine = people.find((p) => p.id === me.id);
  const order = mine ? [mine, ...people.filter((p) => p !== mine)] : people;
  const fit = Math.min(order.length, size?.fit ?? order.length);
  const shown = new Set(order.slice(0, fit).map((p) => p.id));
  // Whoever presents stays in view, so the red ring is never behind the "+N".
  if (presenter && !shown.has(presenter) && fit > 1) {
    shown.delete(order[fit - 1].id);
    shown.add(presenter);
  }
  const more = order.length - fit;

  // The row asks for the width of every tile; the top bar grants what it can spare, and the tiles that fit show.
  // Hidden tiles stay mounted: their sound keeps playing and the stage can still follow their camera.
  useLayoutEffect(() => {
    const el = row.current!;
    const measure = () => {
      const s = getComputedStyle(el);
      const tile = el.querySelector<HTMLElement>(".st-tile:not([hidden])")?.offsetWidth ?? 0;
      const gap = parseFloat(s.columnGap) || 0;
      const pad = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
      const sound = el.querySelector<HTMLElement>(".st-cams-sound")?.offsetWidth ?? 0;
      const plus = el.querySelector<HTMLElement>(".st-cams-more")?.offsetWidth || tile;
      const extra = sound ? sound + gap : 0;
      const all = people.length * tile + (people.length - 1) * gap;
      const room = el.clientWidth - pad - extra;
      const next = {
        width: Math.ceil(pad + all + extra),
        fit: all <= room + 0.5 ? people.length : Math.max(1, Math.floor((room - plus) / (tile + gap))),
      };
      setSize((cur) => (cur?.width === next.width && cur.fit === next.fit ? cur : next));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    watch.observe(el.parentElement!);
    return () => watch.disconnect();
  }, [people.length, more > 0]);

  // The list closes with the "+N" or circle it hangs from (everyone fits again, or that person left).
  useLayoutEffect(() => {
    if (list && !list.getClientRects().length) setList(null);
  });

  const open = (anchor: HTMLElement) => setList((a) => (a === anchor ? null : anchor));
  return (
    <div ref={row} className="st-cams" aria-label="People" style={size ? { width: size.width } : undefined}>
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
      {more > 0 && (
        <button
          type="button"
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
                  <span className={`st-menu-dot${own ? " is-me" : ""}${recording && p.id === presenter ? " is-live" : ""}`} aria-hidden="true">{initials(p.name)}</span>
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

function Tile({ person, mine, hidden, camera, stream, off, presenting, recording, audible, locked, onOpen, onVideo }: {
  person: Person;
  mine: boolean;
  /** Past the room the top bar has: only in the People list. */
  hidden: boolean;
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
    <figure hidden={hidden} className={`st-tile${recording ? " is-live" : ""}${picture ? "" : " is-empty"}${mine ? " is-mine" : ""}${off ? " is-off" : ""}`}>
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

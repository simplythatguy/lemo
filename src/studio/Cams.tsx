// Everyone's camera along the top. The team hears everyone; only the presenter's mic goes into the video,
// which the mic icon shows (live for the presenter, slashed for everyone else).
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { firstName, initials } from "./parts";
import type { Person } from "./types";

// Lucide shapes (ISC licence), like icons.tsx.
const MIC = <><path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" width="6" height="13" rx="3" /></>;
const MIC_OFF = <><path d="M12 19v3" /><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" /><path d="M16.95 16.95A7 7 0 0 1 5 12v-2" /><path d="M18.89 13.23A7 7 0 0 0 19 12v-2" /><path d="m2 2 20 20" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /></>;
const SPEAKER = <><path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.4 18.4a9 9 0 0 0 0-12.8" /></>;
const SPEAKER_OFF = <><path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></>;

const Glyph = ({ d, size = 14 }: { d: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export function Cams({ people, me, local, streams, failed, presenter, mutedAll, locked, onMuteAll, onRemove, onVideo }: {
  people: Person[];
  me: Person;
  local: MediaStream | null;
  streams: Record<string, MediaStream>;
  failed: Record<string, boolean>;
  presenter: string | null;
  mutedAll: boolean;
  locked: boolean;
  onMuteAll(muted: boolean): void;
  onRemove(id: string): void;
  /** Each remote camera's element, so the stage can show the presenter while following their take. */
  onVideo(id: string, el: HTMLVideoElement | null): void;
}) {
  return (
    <div className="st-cams" aria-label="People">
      {people.map((p) => {
        const mine = p.id === me.id;
        return (
          <Tile
            key={p.id}
            person={p}
            mine={mine}
            stream={mine ? local : streams[p.id] ?? null}
            failed={!mine && !!failed[p.id]}
            presenting={p.id === presenter}
            audible={!mine && !mutedAll}
            locked={locked}
            onRemove={() => onRemove(p.id)}
            onVideo={mine ? undefined : (el) => onVideo(p.id, el)}
          />
        );
      })}
      {people.length > 1 && (
        <button
          type="button"
          className="cf-icon-btn st-cams-sound"
          aria-pressed={mutedAll}
          aria-label={mutedAll ? "Unmute the team" : "Mute the team on this laptop"}
          title={mutedAll ? "Unmute" : "Mute"}
          onClick={() => onMuteAll(!mutedAll)}
        >
          <Glyph d={mutedAll ? SPEAKER_OFF : SPEAKER} size={17} />
        </button>
      )}
    </div>
  );
}

function Tile({ person, mine, stream, failed, presenting, audible, locked, onRemove, onVideo }: {
  person: Person;
  mine: boolean;
  stream: MediaStream | null;
  failed: boolean;
  presenting: boolean;
  audible: boolean;
  locked: boolean;
  onRemove(): void;
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
  const picture = usePicture(video, stream);

  return (
    <figure className={`st-tile${presenting ? " is-on" : ""}${picture ? "" : " is-empty"}${mine ? " is-mine" : ""}`}>
      <video ref={video} autoPlay playsInline muted />
      <audio ref={sound} autoPlay />
      {!picture && <span className="st-tile-face" aria-hidden="true">{initials(person.name)}</span>}
      <figcaption>
        {firstName(person.name)}
        {failed && !stream && <span className="st-tile-hint">No video</span>}
      </figcaption>
      <span className={`st-tile-mic${presenting ? " is-live" : ""}`} role="img" aria-label={presenting ? "Presenting: this mic is recorded" : "Not in the recording"}>
        <Glyph d={presenting ? MIC : MIC_OFF} size={12} />
      </span>
      <button
        type="button"
        className="st-tile-x"
        disabled={locked}
        aria-label={mine ? "Leave the room" : `Remove ${person.name}`}
        title={mine ? "Leave" : "Remove"}
        onClick={onRemove}
      >
        <Icon name="x" size={11} stroke={2.4} />
      </button>
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

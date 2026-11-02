// Everyone's camera along the top (small circles on a phone). The team hears everyone; only the presenter's mic goes
// into the video, which the mic icon shows (live for the presenter, slashed for everyone else). A red ring marks
// whoever is recording right now.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { CameraToggle, firstName, initials, type Camera } from "./parts";
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
  return (
    <div className="st-cams" aria-label="People">
      {people.map((p) => {
        const mine = p.id === me.id;
        return (
          <Tile
            key={p.id}
            person={p}
            mine={mine}
            camera={mine ? camera : undefined}
            stream={mine ? camera.stream : streams[p.id] ?? null}
            off={mine ? !camera.on : !!camOff[p.id]}
            failed={!mine && !!failed[p.id]}
            presenting={p.id === presenter}
            recording={recording && p.id === presenter}
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
          className="icon-btn st-cams-sound"
          aria-pressed={mutedAll}
          aria-label={mutedAll ? "Unmute the team" : "Mute the team on this laptop"}
          data-tip={mutedAll ? "Unmute" : "Mute"}
          onClick={() => onMuteAll(!mutedAll)}
        >
          <Icon name={mutedAll ? "speaker-off" : "speaker"} />
        </button>
      )}
    </div>
  );
}

function Tile({ person, mine, camera, stream, off, failed, presenting, recording, audible, locked, onRemove, onVideo }: {
  person: Person;
  mine: boolean;
  /** This device's camera, on my own tile only. */
  camera?: Camera;
  stream: MediaStream | null;
  off: boolean;
  failed: boolean;
  presenting: boolean;
  recording: boolean;
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
  const picture = usePicture(video, stream) && !off;

  return (
    <figure className={`st-tile${recording ? " is-live" : ""}${picture ? "" : " is-empty"}${mine ? " is-mine" : ""}${off ? " is-off" : ""}`}>
      <video ref={video} autoPlay playsInline muted />
      <audio ref={sound} autoPlay />
      {!picture && <span className="st-tile-face" aria-hidden="true">{initials(person.name)}</span>}
      <figcaption>
        {firstName(person.name)}
        {failed && !stream && <span className="st-tile-hint">No video</span>}
      </figcaption>
      <span className={`st-tile-mic${presenting ? " is-live" : ""}`} role="img" aria-label={presenting ? "Presenting: this mic is recorded" : "Not in the recording"}>
        <Icon name={presenting ? "mic" : "mic-off"} size={12} />
      </span>
      {camera && <CameraToggle camera={camera} className="st-tile-cam" size={12} disabled={locked} />}
      <button
        type="button"
        className="st-tile-x"
        disabled={locked}
        aria-label={mine ? "Leave the room" : `Remove ${person.name}`}
        data-tip={mine ? "Leave" : "Remove"}
        onClick={onRemove}
      >
        <Icon name="x" size={12} />
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

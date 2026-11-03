// /r/CODE: the team records the presentation one slide group at a time. Join → room (record, review, keep) → render.
// The deck lives on the server with the room; /r/CODE/edit sets it up.
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import type { Camera } from "./parts";
import { Brand, CameraToggle, CopyLink, editLink, initials, ProjectMark, vr } from "./parts";
import { listDevices, liveVideo, openCamera, stopStream } from "./recorder";
import { lastSeat, loadSeat, rememberRoom, roomApi, RoomError, saveLastSeat, saveSeat, useRoom, type Seat } from "./room";
import { Room } from "./RoomView";
import { preload } from "./stage";
import type { Deck } from "./types";
import "./studio.css";
import "./join.css";

/** The room's deck, as the same object until its content changes: the poll hands over a fresh copy every 2 s. */
function useStableDeck(deck: Deck | null | undefined): Deck | null {
  const kept = useRef<{ json: string; deck: Deck | null }>({ json: "null", deck: null });
  const json = JSON.stringify(deck ?? null);
  if (json !== kept.current.json) kept.current = { json, deck: deck ?? null };
  return kept.current.deck;
}

let liveEl: HTMLVideoElement | null = null;

// One camera open at a time. Windows can switch the camera on for two overlapping opens and then send the surviving one
// no frames once the other is stopped, so each open waits for the last to settle and is skipped if no longer wanted.
let opening: Promise<void> = Promise.resolve();

function useCamera(camId: string | undefined, micId: string | undefined): Camera {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [attempt, setAttempt] = useState(0);
  const [on, setOn] = useState(true);
  liveEl ??= liveVideo();
  const live = liveEl;

  useEffect(() => {
    let alive = true;
    let opened: MediaStream | null = null;
    // Turning the camera off or on reopens the mic with it: one stream, opened in one place.
    opening = opening.then(async () => {
      if (!alive) return;
      try {
        const s = await openCamera(camId, micId, on);
        if (!alive) return stopStream(s);
        opened = s;
        live.srcObject = s;
        void live.play().catch(() => undefined);
        setStream(s);
        setError(null);
        void listDevices().then((d) => alive && setDevices(d));
      } catch (e) {
        if (!alive) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(name === "NotAllowedError" ? "Camera blocked" : name === "NotFoundError" ? "No camera found" : "Camera unavailable");
      }
    });
    return () => {
      alive = false;
      stopStream(opened);
    };
  }, [camId, micId, on, attempt, live]);

  return { stream, live, error, on, turn: setOn, ...devices, retry: () => setAttempt((n) => n + 1) };
}

export function Studio({ code }: { code: string }) {
  const [seat, setSeat] = useState<Seat>(() => ({ ...lastSeat(), ...loadSeat(code) }));
  const { room, live, status, apply } = useRoom(code);
  const deck = useStableDeck(room?.deck);
  const camera = useCamera(seat.camId, seat.micId);

  const loaded = !!room;
  useEffect(() => {
    if (loaded) rememberRoom(code);
  }, [code, loaded]);
  // While the join screen shows, so the room's stage has its fonts and slides by the time it opens.
  useEffect(() => {
    if (deck) void preload(deck).catch(() => undefined);
  }, [deck]);

  const updateSeat = useCallback((patch: Partial<Seat>) => {
    setSeat((s) => {
      const next = { ...s, ...patch };
      saveSeat(code, next);
      saveLastSeat(next);
      return next;
    });
  }, [code]);

  // A teammate removed this person, or the room forgot them: back to the join screen.
  const me = room?.people.find((p) => p.id === seat.personId) ?? null;
  useEffect(() => {
    if (room && seat.personId && !me) updateSeat({ personId: undefined });
  }, [room, me, seat.personId, updateSeat]);

  if (!room) {
    if (status.kind === "missing") return <NoSlides code={code} />;
    return (
      <div className="st-page st-center" aria-busy={status.kind === "loading"}>
        <div className={`st-wait${status.kind === "offline" ? " is-offline" : ""}`}>
          <span className="st-mark" aria-hidden="true" />
          {status.kind === "offline" && <p className="st-quiet" role="status">No connection</p>}
        </div>
      </div>
    );
  }
  if (!deck || !deck.groups.length) return <NoSlides code={code} />;
  if (!me) {
    return (
      <Join
        code={code}
        deck={deck}
        taken={room.people.map((p) => p.name.toLowerCase())}
        name={seat.name ?? ""}
        camera={camera}
        onDevice={updateSeat}
        onJoin={async (name) => {
          const person = await roomApi.join(code, name);
          // The room on screen does not list this person yet; without this the seat would be dropped.
          apply(await roomApi.get(code));
          const kept: Seat = { ...seat, name, personId: person.id };
          saveSeat(code, kept);
          saveLastSeat(kept);
          setSeat(kept);
        }}
      />
    );
  }
  return <Room deck={deck} room={room} serverLive={live} me={me} camera={camera} apply={apply} onLeave={() => updateSeat({ personId: undefined })} />;
}

/** A room nobody has set up yet: one way forward. */
function NoSlides({ code }: { code: string }) {
  return (
    <div className="st-page st-center">
      <div className="st-empty">
        <Brand named />
        <a className="btn is-primary is-lg" href={editLink(code)}>
          <Icon name="slides" size={16} />Add slides
        </a>
        <CopyLink code={code} />
      </div>
    </div>
  );
}

const CAMERA_FIX: Record<string, string> = {
  "Camera blocked": "Allow it in the address bar",
  "No camera found": "Connect a camera",
  "Camera unavailable": "Close other apps using it",
};

function Join({ code, deck, taken, name: initialName, camera, onDevice, onJoin }: {
  code: string;
  deck: Deck;
  /** Names already in the room, lower case: the team list only suggests the others. */
  taken: string[];
  name: string;
  camera: Camera;
  onDevice(patch: Pick<Seat, "camId"> | Pick<Seat, "micId">): void;
  onJoin(name: string): Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The stream the preview has painted a frame of: until then the slot stays in its starting state.
  const [painted, setPainted] = useState<MediaStream | null>(null);
  useEffect(() => setName((n) => n || initialName), [initialName]);
  useEffect(() => {
    if (preview.current) preview.current.srcObject = camera.stream;
  }, [camera.stream]);

  const picture = camera.on && !!camera.stream?.getVideoTracks().length && painted === camera.stream;
  const starting = camera.on && !picture && !camera.error;
  const camId = camera.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const micId = camera.stream?.getAudioTracks()[0]?.getSettings().deviceId;
  const typed = name.trim().toLowerCase();
  const here = !!typed && taken.includes(typed);
  const notHere = deck.team.map((n) => n.trim()).filter((n) => n && !taken.includes(n.toLowerCase()));
  const suggested = notHere.filter((n) => n.toLowerCase() !== typed && n.toLowerCase().startsWith(typed));
  // The row keeps its last names while it folds away, so it closes smoothly instead of emptying first.
  const [shown, setShown] = useState(suggested);
  if (suggested.length && suggested.join("\n") !== shown.join("\n")) setShown(suggested);
  const open = here || suggested.length > 0;
  async function go() {
    if (!name.trim()) field.current?.focus();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onJoin(name.trim());
    } catch (e) {
      setError(e instanceof RoomError && e.status === 404 ? "Room not found" : e instanceof RoomError && e.status === 409 ? "Room is full" : "Could not join");
      setBusy(false);
    }
  }

  return (
    <div className="st-page st-center">
      <form className="st-join" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h1 className="st-join-title">
          <ProjectMark title={deck.title} logo={deck.logo} size={32} />
          <span>{deck.title}</span>
        </h1>
        <div className={`st-cam${picture ? "" : " is-empty"}${starting ? " is-starting" : ""}${camera.error ? " is-blocked" : ""}`}>
          <video ref={preview} autoPlay muted playsInline onPlaying={(e) => setPainted(e.currentTarget.srcObject as MediaStream | null)} />
          {camera.error ? (
            <div className="st-cam-error" role="alert">
              <strong>{camera.error}</strong>
              <span>{CAMERA_FIX[camera.error]}</span>
              <button type="button" className="btn is-quiet is-sm" onClick={camera.retry}><Icon name="restart" size={16} />Try again</button>
            </div>
          ) : !picture && !!name.trim() && (
            <span className="st-cam-face" aria-hidden="true">{initials(name)}</span>
          )}
          {!camera.error && <CameraToggle camera={camera} className="st-cam-toggle" size={20} />}
          <MicLevel stream={camera.stream} />
        </div>
        <div className="st-devices">
          <DevicePicker icon="camera" label="Camera" devices={camera.cams} value={camId} onChange={(id) => { onDevice({ camId: id }); camera.turn(true); }} />
          <DevicePicker icon="mic" label="Microphone" devices={camera.mics} value={micId} onChange={(id) => onDevice({ micId: id })} />
        </div>
        <div className="st-name">
          <label className="st-field">
            <span>Name</span>
            <input ref={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" required />
          </label>
          <div className={`st-suggest${open ? " is-open" : ""}`}>
            <div>
              {here && <span className="st-suggest-note">Already in the room</span>}
              {(open ? suggested : shown).map((n) => (
                <button key={n} type="button" className="btn is-quiet is-sm" onClick={() => setName(n)}>{n}</button>
              ))}
            </div>
          </div>
        </div>
        {error && <p className="st-error" role="alert">{error}</p>}
        <button type="submit" className="btn is-primary is-lg st-join-go" disabled={(vr("jn") !== "c" && !name.trim()) || busy || !camera.stream}>
          {busy ? "Joining" : "Join"}
        </button>
        <CopyLink code={code} />
      </form>
    </div>
  );
}

function DevicePicker({ icon, label, devices, value, onChange }: {
  icon: "camera" | "mic";
  label: string;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  onChange(id: string): void;
}) {
  return (
    <label className="st-device">
      <Icon name={icon} size={16} />
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={!devices.length}>
        {!devices.length && <option value="">{label}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>
        ))}
      </select>
    </label>
  );
}

/** A short bar in the camera tile's corner that moves with the microphone. */
function MicLevel({ stream }: { stream: MediaStream | null }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stream?.getAudioTracks().length) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, (peak / 128) * 2.5)})`;
      raf = requestAnimationFrame(tick);
    };
    void ctx.resume().catch(() => undefined);
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);
  return <div className="st-level" aria-hidden="true"><div ref={bar} /></div>;
}

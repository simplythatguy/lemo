// /studio: the team records the pitch one slide group at a time. Join → room (record, review, keep) → render.
import { useCallback, useEffect, useRef, useState } from "react";
import { deck as pitchDeck } from "./deck";
import { Icon } from "./icons";
import type { Camera } from "./parts";
import { Brand, CopyLink, initials } from "./parts";
import { listDevices, liveVideo, openCamera, stopStream } from "./recorder";
import { accountName, lastSeat, loadSeat, roomApi, RoomError, saveLastSeat, saveSeat, signedOut, TEAM_ROOM, useRoom, validCode, type Seat } from "./room";
import { Room } from "./RoomView";
import type { Deck } from "./types";

const STUDIO_RETURN = "batatis.studio.return";

// ?deck=test swaps in the short test deck, when it is part of the build.
const testDecks = import.meta.glob<{ testDeck: Deck }>("./testDeck.ts");

async function loadDeck(): Promise<Deck> {
  if (new URLSearchParams(location.search).get("deck") === "test") {
    const load = Object.values(testDecks)[0];
    if (load) return (await load()).testDeck;
  }
  return pitchDeck;
}

/** ?room=CODE opens that room; without one, everybody lands in the same team room. */
function roomFromUrl(): string {
  const code = new URLSearchParams(location.search).get("room")?.trim().toUpperCase() ?? "";
  return validCode(code) ? code : TEAM_ROOM;
}

let liveEl: HTMLVideoElement | null = null;

function useCamera(camId: string | undefined, micId: string | undefined): Camera {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [attempt, setAttempt] = useState(0);
  liveEl ??= liveVideo();
  const live = liveEl;

  useEffect(() => {
    let alive = true;
    let opened: MediaStream | null = null;
    openCamera(camId, micId).then(
      (s) => {
        if (!alive) return stopStream(s);
        opened = s;
        live.srcObject = s;
        void live.play().catch(() => undefined);
        setStream(s);
        setError(null);
        void listDevices().then((d) => alive && setDevices(d));
      },
      (e: unknown) => {
        if (!alive) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(name === "NotAllowedError" ? "Camera blocked" : name === "NotFoundError" ? "No camera found" : "Camera unavailable");
      },
    );
    return () => {
      alive = false;
      stopStream(opened);
    };
  }, [camId, micId, attempt, live]);

  return { stream, live, error, ...devices, retry: () => setAttempt((n) => n + 1) };
}

export function Studio() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [account, setAccount] = useState<{ signedIn: boolean; name: string } | null>(null);
  const [code] = useState(roomFromUrl);
  const [seat, setSeat] = useState<Seat>(() => ({ ...lastSeat(), ...loadSeat(code) }));
  const { room, live, status, apply } = useRoom(account?.signedIn ? code : null);
  const camera = useCamera(seat.camId, seat.micId);

  useEffect(() => {
    void loadDeck().then(setDeck);
    void accountName().then(setAccount);
  }, []);

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

  if (!deck || !account || (status.kind === "loading" && seat.personId)) return <div className="st-page st-splash" aria-busy="true" />;
  if (!account.signedIn || status.kind === "signed-out") return <SignIn />;
  if (!me || !room) {
    return (
      <Join
        code={code}
        name={seat.name || account.name}
        camera={camera}
        onDevice={(camId, micId) => updateSeat({ camId, micId })}
        onJoin={async (name) => {
          await roomApi.open(code);
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

function SignIn() {
  return (
    <div className="st-page st-center">
      <div className="st-signin">
        <Brand />
        <a className="cf-btn is-primary is-lg" href="/#/signin" onClick={() => sessionStorage.setItem(STUDIO_RETURN, location.href)}>
          Sign in
        </a>
      </div>
    </div>
  );
}

function Join({ code, name: initialName, camera, onDevice, onJoin }: {
  code: string;
  name: string;
  camera: Camera;
  onDevice(camId: string | undefined, micId: string | undefined): void;
  onJoin(name: string): Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => setName((n) => n || initialName), [initialName]);
  useEffect(() => {
    if (preview.current) preview.current.srcObject = camera.stream;
  }, [camera.stream]);

  const camId = camera.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const micId = camera.stream?.getAudioTracks()[0]?.getSettings().deviceId;
  async function go() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onJoin(name.trim());
    } catch (e) {
      setError(signedOut(e) ? "Signed out" : e instanceof RoomError && e.status === 404 ? "Room not found" : e instanceof RoomError && e.status === 409 ? "Room is full" : "Could not join");
      setBusy(false);
    }
  }

  return (
    <div className="st-page st-center">
      <form className="st-join" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Brand />
        <div className={`st-cam${camera.stream ? "" : " is-empty"}`}>
          <video ref={preview} autoPlay muted playsInline />
          {!camera.stream && !camera.error && name.trim() && <span className="st-tile-face" aria-hidden="true">{initials(name)}</span>}
          {camera.error && (
            <div className="st-cam-error">
              <span>{camera.error}</span>
              <button type="button" className="cf-btn is-sm" onClick={camera.retry}>Try again</button>
            </div>
          )}
          <MicLevel stream={camera.stream} />
        </div>
        <div className="st-devices">
          <DevicePicker icon="camera" label="Camera" devices={camera.cams} value={camId} onChange={(id) => onDevice(id, micId)} />
          <DevicePicker icon="mic" label="Microphone" devices={camera.mics} value={micId} onChange={(id) => onDevice(camId, id)} />
        </div>
        <label className="st-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" required />
        </label>
        {error && <p className="st-error" role="alert">{error}</p>}
        <div className="st-join-actions">
          <button type="submit" className="cf-btn is-primary is-lg" disabled={!name.trim() || busy || !camera.stream}>
            Join
          </button>
          <CopyLink code={code} />
        </div>
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
    <label className="st-device" title={label}>
      <Icon name={icon} size={15} />
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={!devices.length}>
        {!devices.length && <option value="">{label}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>
        ))}
      </select>
    </label>
  );
}

/** A thin bar along the camera tile's bottom edge that moves with the microphone. */
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

// Small pieces shared by the studio screens.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconSize } from "../icons";

export interface Camera {
  stream: MediaStream | null;
  /** The page-lifetime element playing `stream`; the stage paints it as the camera tile. */
  live: HTMLVideoElement;
  error: string | null;
  /** The camera is on. Off, `stream` carries the mic alone. */
  on: boolean;
  turn(on: boolean): void;
  cams: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  retry(): void;
}

/** Turns this device's camera off (its light goes out) and on again. */
export function CameraToggle({ camera, className, size, disabled }: { camera: Camera; className: string; size: IconSize; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-pressed={!camera.on}
      aria-label={camera.on ? "Turn camera off" : "Turn camera on"}
      data-tip={camera.on ? "Camera off" : "Camera on"}
      onClick={() => camera.turn(!camera.on)}
    >
      <Icon name={camera.on ? "camera" : "camera-off"} size={size} />
    </button>
  );
}

/** Over the stage when startPlayback was refused: one click plays it. */
export function StartButton({ onStart }: { onStart(): void }) {
  return (
    <button type="button" className="st-start" onClick={onStart} aria-label="Play" data-tip="Play">
      <Icon name="play" size={28} />
    </button>
  );
}

/** The first two letters of the first name: "Abdel Abdelwaly" → "Ab". */
export const initials = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.charAt(0).toUpperCase() + first.slice(1, 2).toLowerCase();
};

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const roomLink = (code: string) => `${location.origin}/r/${code}`;
export const editLink = (code: string) => `/r/${code}/edit`;

/** A file-name-safe form of `s`: "My Big Demo!" → "my-big-demo". */
export const slug = (s: string) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "demo";

export function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="st-copy"
      data-tip="Copy the room link"
      aria-label={`Room ${code}, copy link`}
      onClick={() => {
        void navigator.clipboard?.writeText(roomLink(code)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <span>{code}</span>
      <Icon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}

/** The app's mark, a link home to every demo this device knows. `named` adds the product name beside it. */
export function Brand({ named = false }: { named?: boolean }) {
  return (
    <a className="st-brand" href="/" aria-label="Lemo" data-tip="My demos">
      <span className="st-mark" aria-hidden="true" />
      {named && <span aria-hidden="true">Lemo</span>}
    </a>
  );
}

/** The project's mark: its logo, or its first letter on an ink square without one. */
export function ProjectMark({ title, logo, size = 28 }: { title: string; logo?: string; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const letter = Array.from(title.trim())[0]?.toUpperCase() ?? "";
  return logo && broken !== logo ? (
    <img className="st-pmark" src={logo} alt="" width={size} height={size} onError={() => setBroken(logo)} />
  ) : (
    <span className="st-pmark is-letter" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">{letter}</span>
  );
}

/** A menu hung off `anchor`, opening above or below it and kept on screen. Focus moves in; Escape or a click elsewhere closes it. */
export function Menu({ label, anchor, above = false, onClose, children }: {
  label: string;
  anchor: HTMLElement;
  above?: boolean;
  onClose(): void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = ref.current!;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const m = el.getBoundingClientRect();
      el.style.left = `${Math.min(Math.max(a.left, 8), innerWidth - 8 - m.width)}px`;
      el.style.top = `${above ? a.top - 8 - m.height : a.bottom + 8}px`;
    };
    place();
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    return () => {
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
    };
  }, [anchor, above]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-checked=true], button:not(:disabled), a")?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close.current();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [anchor]);
  return <div ref={ref} className="st-menu" role="menu" aria-label={label}>{children}</div>;
}

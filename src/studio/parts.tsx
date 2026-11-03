// Small pieces shared by the studio screens.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconSize } from "../icons";

// VARIATIONS (temporary): ?cd= ?cue= ?up= ?cap= ?ph= ?sp= ?jn= ?mk= land on <html data-*> for CSS and vr() for TSX.
for (const [k, v] of new URLSearchParams(location.search)) if (/^(cd|cue|up|cap|ph|sp|jn|mk)$/.test(k)) document.documentElement.dataset[k] = v;
export const vr = (k: string) => document.documentElement.dataset[k] ?? "";

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
      data-tip={camera.on ? "Turn camera off" : "Turn camera on"}
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
      <span className={`st-mark${vr("mk") ? ` is-${vr("mk")}` : ""}`} aria-hidden="true">
        {vr("mk") === "a" ? "L" : vr("mk") ? (
          <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">
            <rect x="4" y="6" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
            <rect x="12.5" y="11.5" width="5" height="4" rx="1" fill="currentColor" />
          </svg>
        ) : null}
      </span>
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

/** A menu (or a small list of controls) hung off `anchor`, opening above or below it and kept on screen. Focus moves in;
    Escape, a pick or a click elsewhere closes it, and focus goes back to `anchor`. A click elsewhere only closes it: it
    never also presses what is under it. Render it always; with `anchor` null it plays its exit, then unmounts. */
export function Menu({ label, anchor, role = "menu", above = false, onClose, children }: {
  label: string;
  role?: "menu" | "dialog";
  anchor: HTMLElement | null;
  above?: boolean;
  onClose(): void;
  children: React.ReactNode;
}) {
  // What it showed when it was last open, so the exit has something to fade.
  const last = useRef<{ anchor: HTMLElement; children: React.ReactNode } | null>(null);
  const [, rerender] = useState(0);
  if (anchor) last.current = { anchor, children };
  const shown = last.current;
  if (!shown) return null;
  return (
    <MenuSurface
      label={label}
      role={role}
      anchor={shown.anchor}
      above={above}
      closing={!anchor}
      onClose={onClose}
      onExited={() => {
        last.current = null;
        rerender((n) => n + 1);
      }}
    >
      {shown.children}
    </MenuSurface>
  );
}

function MenuSurface({ label, role, anchor, above, closing, onClose, onExited, children }: {
  label: string;
  role: "menu" | "dialog";
  anchor: HTMLElement;
  above: boolean;
  closing: boolean;
  onClose(): void;
  onExited(): void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const exited = useRef(onExited);
  exited.current = onExited;
  const attached = () => anchor.isConnected && anchor.getClientRects().length > 0;
  useLayoutEffect(() => {
    const el = ref.current!;
    const place = () => {
      if (!attached()) return;
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
    if (closing) return;
    ref.current?.querySelector<HTMLElement>("[aria-checked=true], button:not(:disabled), a")?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      // Not the focus move, and not the click that follows: on a phone that tap would also change the slide under it.
      e.preventDefault();
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      // A tap that turns into a scroll sends no click.
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 600);
      close.current();
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
  }, [anchor, closing]);
  useLayoutEffect(() => {
    if (!closing) return;
    const el = ref.current!;
    const giveBack = () => {
      const at = document.activeElement;
      if (attached() && (!at || at === document.body || el.contains(at))) anchor.focus({ preventScroll: true });
    };
    giveBack();
    // Its trigger is gone (that person left, everyone fits again): nothing to fade back into.
    const motion = attached() ? el.getAnimations() : [];
    let live = true;
    void Promise.all(motion.map((a) => a.finished)).then(() => {
      if (!live) return;
      giveBack();
      exited.current();
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [closing]);
  return (
    <div
      ref={ref}
      className={`st-menu${above ? " is-above" : ""}${closing ? " is-closing" : ""}`}
      role={role}
      aria-label={label}
      inert={closing || undefined}
    >
      {children}
    </div>
  );
}

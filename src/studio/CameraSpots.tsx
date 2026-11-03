// Where your camera sits: tap it (or press C) and the stage shows the five places it can go, each a wide rectangle
// with the upright one inside it. Tap the wide or the upright one to move there in that shape. Each place's S M L,
// which scale both, ride its edge; a small stage has room for one row, the place you're on or the one you point at.
// Tap a size to move there at that size.
// Works while recording.
// Keys while open: arrows change place, 1 2 3 the size, Enter or Esc close.
import { useEffect, useRef, useState } from "react";
import "./cameraSpots.css";
import { STAGE_H, STAGE_W } from "./stage";
import { PLACES, SIZES, spotBox, spotParts, type CameraBox } from "./stage/camera";
import { spotOf, toPlace, useSpotPref } from "./spot";
import type { CameraShape, CameraSize, Place } from "./types";

const PLACE_NAME: Record<Place, string> = { tl: "Top left", tr: "Top right", c: "Centre", bl: "Bottom left", br: "Bottom right" };
const SIZE_NAME: Record<CameraSize, string> = { s: "Small", m: "Medium", l: "Large" };
const SHAPE_NAME: Record<CameraShape, string> = { h: "wide", v: "upright" };

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const place = (b: CameraBox): React.CSSProperties => ({
  left: pct(b.x, STAGE_W),
  top: pct(b.y, STAGE_H),
  width: pct(b.w, STAGE_W),
  height: pct(b.h, STAGE_H),
  borderRadius: `${pct(b.r, b.w)} / ${pct(b.r, b.h)}`,
});

/** The place an arrow key leads to from `from`: the nearest one that way, if any. */
function neighbour(from: Place, key: string): Place | null {
  const at = (p: Place) => spotBox(`${p}-h-l`);
  const a = at(from);
  const [dx, dy] = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key] ?? [0, 0];
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of PLACES) {
    const b = at(p);
    const vx = b.x + b.w / 2 - (a.x + a.w / 2), vy = b.y + b.h / 2 - (a.y + a.h / 2);
    if (vx * dx + vy * dy <= 0) continue;
    const d = Math.hypot(vx, vy);
    if (d < bestD) [best, bestD] = [p, d];
  }
  return best;
}

/** Where a place's S M L row hangs at `size`: on its wide shape's inner edge, at the outer side (the centre's above it). */
function rowAt(p: Place, size: CameraSize) {
  const b = spotBox(`${p}-h-${size}`);
  if (p === "c") return { x: b.x + b.w / 2, y: b.y };
  return { x: p[1] === "l" ? b.x : b.x + b.w, y: p[0] === "t" ? b.y + b.h : b.y };
}

function Sizes({ p, size, current, kept }: { p: Place; size: CameraSize; current: boolean; kept: boolean }) {
  // Under a mouse the row stays where it was clicked until the pointer leaves it, so S M L can be clicked through
  // without chasing the edge; then it rides the edge again.
  const [held, setHeld] = useState<CameraSize | null>(null);
  const at = rowAt(p, held ?? size);
  return (
    <div
      className={`st-spot-size is-at-${p}${kept ? " is-kept" : ""}`}
      style={{ left: pct(at.x, STAGE_W), top: pct(at.y, STAGE_H) }}
      role="radiogroup"
      aria-label={`${PLACE_NAME[p]} size`}
      onPointerLeave={() => setHeld(null)}
    >
      {SIZES.map((s, i) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={size === s}
          aria-label={SIZE_NAME[s]}
          aria-keyshortcuts={current ? String(i + 1) : undefined}
          onClick={(e) => {
            if ((e.nativeEvent as PointerEvent).pointerType === "mouse") setHeld((h) => h ?? size);
            toPlace(p, { size: s });
          }}
        >
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function CameraSpots({ open, onOpen }: { open: boolean; onOpen(open: boolean): void }) {
  const pref = useSpotPref();
  // The place pointed at or focused last; a small stage keeps its sizes instead of the current place's.
  const [aim, setAim] = useState<Place | null>(null);
  if (!open && aim) setAim(null);
  const here = spotBox(spotOf(pref));
  const handle = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const focusHere = () => layer.current?.querySelector<HTMLElement>(".st-spot[aria-pressed=true]")?.focus({ preventScroll: true });

  // C opens it from anywhere in the room, like R records.
  useEffect(() => {
    if (open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, select, textarea, [contenteditable], [role=menu], [role=dialog]")) return;
      if (document.querySelector("[aria-modal=true]")) return;
      e.preventDefault();
      onOpen(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onOpen]);

  useEffect(() => {
    if (!open) return;
    focusHere();
    const close = () => {
      onOpen(false);
      handle.current?.focus({ preventScroll: true });
    };
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const now = spotParts(spotOf(pref)).place;
      if (k === "escape" || k === "enter" || k === "c") close();
      else if (k === "1" || k === "2" || k === "3") toPlace(now, { size: SIZES[Number(k) - 1] });
      else if (k.startsWith("arrow")) {
        const next = neighbour(now, k);
        if (next) toPlace(next);
        requestAnimationFrame(focusHere);
      } else return;
      // These keys belong to the picker, not the room (arrows would change slides, Enter would stop the take).
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, onOpen, pref]);

  return (
    <>
      <button
        ref={handle}
        type="button"
        className="st-spots-handle"
        style={place(here)}
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-keyshortcuts="C"
        aria-label="Move camera"
        data-tip="Move camera  C"
      />
      {open && (
        <div ref={layer} className="st-spots" role="group" aria-label="Camera position">
          <div className="st-spots-dim" onPointerDown={() => onOpen(false)} />
          {PLACES.map((p) => {
            const size = pref.sizes[p];
            return (
              <div key={p} className="st-spot-place" onPointerMove={() => setAim(p)} onFocus={() => setAim(p)}>
                {(["h", "v"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`st-spot is-${k}`}
                    style={place(spotBox(`${p}-${k}-${size}`))}
                    aria-pressed={pref.place === p && pref.shapes[p] === k}
                    aria-label={`${PLACE_NAME[p]}, ${SHAPE_NAME[k]}`}
                    onClick={() => {
                      toPlace(p, { shape: k });
                      onOpen(false);
                    }}
                  />
                ))}
                <Sizes p={p} size={size} current={pref.place === p} kept={p === (aim ?? pref.place)} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

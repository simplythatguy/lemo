// Where your camera sits: tap it (or press C) and the stage shows the five places it can go, each a wide rectangle
// with the upright one inside it, and S M L beside each, which scale both. Tap the wide or the upright one to move
// there in that shape; tap a size to move there at that size. Works while recording.
// Keys while open: arrows change place, 1 2 3 the size, Enter or Esc close.
import { useEffect, useRef } from "react";
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

export function CameraSpots({ open, onOpen }: { open: boolean; onOpen(open: boolean): void }) {
  const pref = useSpotPref();
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
            // The sizes stay where the large size puts them, so they never move out from under the pointer.
            const large = spotBox(`${p}-h-l`);
            const side = p === "c" ? "above" : p[1] === "l" ? "right" : "left";
            return (
              <div key={p} className="st-spot-place">
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
                <div
                  className={`st-spot-size is-${side} is-row-${p[0] === "t" ? "top" : "bottom"}`}
                  style={{
                    "--left": pct(large.x, STAGE_W),
                    "--right": pct(large.x + large.w, STAGE_W),
                    "--top": pct(large.y, STAGE_H),
                    "--bottom": pct(large.y + large.h, STAGE_H),
                    "--cx": pct(large.x + large.w / 2, STAGE_W),
                    "--cy": pct(large.y + large.h / 2, STAGE_H),
                  } as React.CSSProperties}
                  role="radiogroup"
                  aria-label={`${PLACE_NAME[p]} size`}
                >
                  {SIZES.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={size === s}
                      aria-label={SIZE_NAME[s]}
                      aria-keyshortcuts={pref.place === p ? String(i + 1) : undefined}
                      onClick={() => toPlace(p, { size: s })}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

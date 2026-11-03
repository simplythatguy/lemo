// Where your camera sits: tap it (or press C) and the stage shows the five places it can go, each a wide rectangle
// with the upright one inside it, and S M L on each. Tap a place to move there at the size it had last; tap a size to
// move there at that size. Works while recording. Keys while open: arrows change place, 1 2 3 the size, Enter or Esc close.
import { useEffect, useRef } from "react";
import { STAGE_H, STAGE_W } from "./stage";
import { PLACES, SIZES, spotBox, spotParts, type CameraBox } from "./stage/camera";
import { spotOf, toPlace, useSpotPref } from "./spot";
import type { CameraSize, Place } from "./types";

const PLACE_NAME: Record<Place, string> = { tl: "Top left", tr: "Top right", c: "Centre", bl: "Bottom left", br: "Bottom right" };
const SIZE_NAME: Record<CameraSize, string> = { s: "Small", m: "Medium", l: "Large" };

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
  const at = (p: Place) => spotBox(`${p}-l`);
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
      else if (k === "1" || k === "2" || k === "3") toPlace(now, SIZES[Number(k) - 1]);
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
            const wide = spotBox(`${p}-l`);
            const on = pref.place === p;
            // Sizes sit above the centre, beside each corner on the side facing the middle; inside the place on a small stage.
            const side = p === "c" ? "above" : p[1] === "l" ? "right" : "left";
            return (
              <div key={p} className="st-spot-place">
                <button
                  type="button"
                  className="st-spot"
                  style={place(wide)}
                  aria-pressed={on}
                  aria-label={PLACE_NAME[p]}
                  onClick={() => {
                    toPlace(p);
                    onOpen(false);
                  }}
                />
                <span className="st-spot-upright" style={place(spotBox(`${p}-m`))} aria-hidden="true" />
                <div
                  className={`st-spot-size is-${side}`}
                  style={{
                    "--left": pct(wide.x, STAGE_W),
                    "--right": pct(wide.x + wide.w, STAGE_W),
                    "--top": pct(wide.y, STAGE_H),
                    "--cx": pct(wide.x + wide.w / 2, STAGE_W),
                    "--cy": pct(wide.y + wide.h / 2, STAGE_H),
                  } as React.CSSProperties}
                  role="radiogroup"
                  aria-label={`${PLACE_NAME[p]} size`}
                >
                  {SIZES.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={pref.sizes[p] === s}
                      aria-label={SIZE_NAME[s]}
                      aria-keyshortcuts={on ? String(i + 1) : undefined}
                      onClick={() => toPlace(p, s)}
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

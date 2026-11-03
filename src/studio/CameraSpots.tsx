import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./cameraSpots.css";
import { STAGE_H, STAGE_W } from "./stage";
import { GLIDE_MS, observeCameraFrame, PLACES, SHAPES, shapeBox, SIZES, spotBox, type CameraBox } from "./stage/camera";
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

/** Where a place's S M L row hangs from its wide shape: on the edge that faces the middle of the stage. Mirrored
 *  corners hang theirs alike; the centre's row is above it. */
function rowAt(p: Place, wide: CameraBox): { x: number; y: number; side: string } {
  if (p === "c") return { x: wide.x + wide.w / 2, y: wide.y, side: "is-above is-mid" };
  return {
    x: p[1] === "l" ? wide.x : wide.x + wide.w,
    y: p[0] === "t" ? wide.y + wide.h : wide.y,
    side: `${p[0] === "t" ? "is-below" : "is-above"}${p[1] === "r" ? " is-end" : ""}`,
  };
}

interface SizeTarget { size: CameraSize; rect: DOMRect }
interface SizeGesture { p: Place; until: number; origin: SizeTarget[]; latest: SizeTarget[] }

function Sizes({ p, wide, size, current, kept, onPick }: { p: Place; wide: CameraBox; size: CameraSize; current: boolean; kept: boolean; onPick(row: HTMLElement): void }) {
  const at = rowAt(p, wide);
  const row = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={row}
      className={`st-spot-size ${at.side}${kept ? " is-kept" : ""}${current ? " is-here" : ""}`}
      style={{ left: pct(at.x, STAGE_W), top: pct(at.y, STAGE_H) }}
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
          aria-keyshortcuts={current ? String(i + 1) : undefined}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onClick={(e) => {
            if (e.detail && row.current) onPick(row.current);
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
  useLayoutEffect(() => { setAim(null); }, [pref.place]);
  const here = spotBox(spotOf(pref));
  const gesture = useRef<SizeGesture | null>(null);
  if (!open) gesture.current = null;
  const swallow = useRef(false);
  const remember = (p: Place, row: HTMLElement) => {
    const latest = [...row.querySelectorAll("button")].map((b, i) => ({ size: SIZES[i], rect: b.getBoundingClientRect() }));
    const t = performance.now();
    const prior = gesture.current;
    gesture.current = { p, until: t + GLIDE_MS, origin: prior?.p === p && t < prior.until ? prior.origin : latest, latest };
  };
  // A quick press where a ring was still means that size, even after the row has moved away.
  const press = (e: React.PointerEvent) => {
    swallow.current = false;
    if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest(".st-spot-size")) return;
    const t = performance.now();
    const g = gesture.current;
    if (!g || t >= g.until) return;
    const hit = [...g.latest, ...g.origin].find(({ rect: r }) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    swallow.current = true;
    g.until = t + GLIDE_MS;
    toPlace(g.p, { size: hit.size });
    layer.current?.querySelector<HTMLElement>(`[aria-label="${PLACE_NAME[g.p]} size"] [aria-label="${SIZE_NAME[hit.size]}"]`)?.focus({ preventScroll: true });
  };
  const handle = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const focusHere = () => layer.current?.querySelector<HTMLElement>(".st-spot[aria-pressed=true]")?.focus({ preventScroll: true });

  useLayoutEffect(() => {
    const canvas = handle.current?.parentElement?.querySelector("canvas");
    if (!canvas) return;
    const hole = layer.current?.querySelector<HTMLElement>(".st-spots-dim-hole");
    const groups = layer.current?.querySelectorAll<HTMLElement>(".st-spot-place");
    return observeCameraFrame(canvas, (box) => {
      if (handle.current) Object.assign(handle.current.style, place(box));
      if (hole) Object.assign(hole.style, place(box));
      groups?.forEach((group, i) => {
        const p = PLACES[i];
        const h = box.place === p ? box.h : spotBox(`${p}-h-${pref.sizes[p]}`).h;
        for (const k of SHAPES) {
          const outline = group.querySelector<HTMLElement>(`.is-${k}`);
          const b = box.place === p && pref.shapes[p] === k ? box : shapeBox(p, k, h);
          if (outline) Object.assign(outline.style, place(b));
        }
        const row = group.querySelector<HTMLElement>(".st-spot-size");
        const at = rowAt(p, shapeBox(p, "h", h));
        if (row) Object.assign(row.style, { left: pct(at.x, STAGE_W), top: pct(at.y, STAGE_H) });
      });
    });
  }, [open, pref]);

  useEffect(() => { if (open) focusHere(); }, [open]);

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
    const close = () => {
      onOpen(false);
      handle.current?.focus({ preventScroll: true });
    };
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const now = pref.place;
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
        <div
          ref={layer}
          className="st-spots"
          role="group"
          aria-label="Camera position"
          onPointerDownCapture={press}
          onPointerCancelCapture={() => { swallow.current = false; }}
          onClickCapture={(e) => {
            if (!e.detail || !swallow.current) return;
            swallow.current = false;
            e.stopPropagation();
          }}
        >
          <div className="st-spots-dim" onPointerDown={() => onOpen(false)} />
          <div className="st-spots-dim-hole" style={place(here)} />
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
                <Sizes p={p} wide={spotBox(`${p}-h-${size}`)} size={size} current={pref.place === p} kept={p === (aim ?? pref.place)} onPick={(row) => remember(p, row)} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

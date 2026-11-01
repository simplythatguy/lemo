// The presenter's camera tile, picked up off the stage: drag it to move it, drag an edge or corner to resize it,
// double-click to put it back in the corner. Arrow keys move it and + / − resize it while it has focus.
import { useRef } from "react";
import { STAGE_H, STAGE_W } from "./stage";
import { CAMERA, cameraRadius, moveCamera, resizeCamera, type Handle } from "./stage/camera";
import type { Rect } from "./types";

const HANDLES: Handle[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];
const nameOf = (h: Handle) => `${["n", "", "s"][h.y + 1]}${["w", "", "e"][h.x + 1]}`;

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export function CameraFrame({ box, onChange, onCommit }: {
  box: Rect;
  /** While dragging or keying: the tile's new place, not saved yet. */
  onChange(r: Rect): void;
  /** The gesture ended: save `r`. */
  onCommit(r: Rect): void;
}) {
  const drag = useRef<{ start: Rect; handle: Handle | null; px: number; py: number; scale: number; last: Rect } | null>(null);
  const keyed = useRef(0);
  const radius = cameraRadius(box);

  const down = (handle: Handle | null) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const stage = e.currentTarget.closest(".st-stage")!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { start: box, handle, px: e.clientX, py: e.clientY, scale: STAGE_W / stage.getBoundingClientRect().width, last: box };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) * d.scale, dy = (e.clientY - d.py) * d.scale;
    d.last = d.handle ? resizeCamera(d.start, d.handle, dx, dy) : moveCamera(d.start, dx, dy);
    onChange(d.last);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.last !== d.start) onCommit(d.last);
  };

  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 96 : 16;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    let next: Rect | null = null;
    if (arrows[e.key]) next = moveCamera(box, ...arrows[e.key]);
    else if (e.key === "+" || e.key === "=") next = resizeCamera(box, { x: -1, y: -1 }, -box.w * 0.1, 0);
    else if (e.key === "-") next = resizeCamera(box, { x: -1, y: -1 }, box.w * 0.1, 0);
    if (!next) return;
    // The room's own arrow keys change slides; these belong to the tile.
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
    window.clearTimeout(keyed.current);
    const r = next;
    keyed.current = window.setTimeout(() => onCommit(r), 500);
  };

  return (
    <div
      className="st-camframe"
      tabIndex={0}
      role="group"
      aria-label="Camera"
      style={{
        left: pct(box.x, STAGE_W),
        top: pct(box.y, STAGE_H),
        width: pct(box.w, STAGE_W),
        height: pct(box.h, STAGE_H),
        borderRadius: `${pct(radius, box.w)} / ${pct(radius, box.h)}`,
      }}
      onPointerDown={down(null)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onCommit(CAMERA)}
      onKeyDown={key}
    >
      {HANDLES.map((h) => (
        <span
          key={nameOf(h)}
          className={`st-camframe-h is-${nameOf(h)}`}
          onPointerDown={down(h)}
        />
      ))}
    </div>
  );
}

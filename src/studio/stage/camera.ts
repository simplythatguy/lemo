// Where the presenter's camera tile sits on the 1920×1080 stage. One placement for the whole video, kept on the deck.

import type { Deck, Rect } from "../types";

const W = 1920, H = 1080;

/** Inset equally from the right and bottom edges so it sits cleanly over a full-bleed page. */
export const CAMERA: Rect = { x: W - 48 - 344, y: H - 48 - 430, w: 344, h: 430 };
const INSET = 48;
const SNAP = 16;
const MIN = 120;

/** Which edges a resize moves: -1 the left or top edge, 1 the right or bottom one, 0 neither. Two non-zero: a corner. */
export interface Handle { x: -1 | 0 | 1; y: -1 | 0 | 1 }

/** The tile's corner radius: 28 stage pixels, less on a small tile. */
export const cameraRadius = (r: Rect) => Math.min(28, Math.min(r.w, r.h) / 4);

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Pulls `v` onto the default inset from either edge when it is within a few pixels of it. */
function snap(v: number, size: number, extent: number): number {
  if (Math.abs(v - INSET) < SNAP) return INSET;
  const far = extent - INSET - size;
  return Math.abs(v - far) < SNAP ? far : v;
}

/** The deck's camera placement, or the default when it has none or it does not fit the stage. */
export function cameraOf(deck: Pick<Deck, "camera">): Rect {
  const r = deck.camera;
  if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) return CAMERA;
  const w = clamp(r.w, MIN, W), h = clamp(r.h, MIN, H);
  return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h };
}

/** `start` moved by (`dx`, `dy`), kept on the stage, snapped to the default inset. */
export function moveCamera(start: Rect, dx: number, dy: number): Rect {
  const x = clamp(start.x + dx, 0, W - start.w), y = clamp(start.y + dy, 0, H - start.h);
  return { ...start, x: snap(x, start.w, W), y: snap(y, start.h, H) };
}

/**
 * `start` resized by dragging `handle` by (`dx`, `dy`), the opposite edge or corner held still. A corner keeps the
 * tile's shape; an edge stretches one side. Never smaller than MIN on a side, never off the stage.
 */
export function resizeCamera(start: Rect, handle: Handle, dx: number, dy: number): Rect {
  // The fixed edges, and the room on the stage beyond them in the direction the handle grows.
  const ax = handle.x > 0 ? start.x : start.x + start.w;
  const ay = handle.y > 0 ? start.y : start.y + start.h;
  const roomW = handle.x > 0 ? W - ax : ax;
  const roomH = handle.y > 0 ? H - ay : ay;
  let w = start.w, h = start.h;
  if (handle.x && handle.y) {
    const sx = (start.w + handle.x * dx) / start.w, sy = (start.h + handle.y * dy) / start.h;
    const s = clamp(Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy, Math.max(MIN / start.w, MIN / start.h), Math.min(roomW / start.w, roomH / start.h));
    w = start.w * s;
    h = start.h * s;
  } else if (handle.x) w = clamp(start.w + handle.x * dx, MIN, roomW);
  else if (handle.y) h = clamp(start.h + handle.y * dy, MIN, roomH);
  return {
    x: handle.x < 0 ? ax - w : handle.x > 0 ? ax : start.x,
    y: handle.y < 0 ? ay - h : handle.y > 0 ? ay : start.y,
    w,
    h,
  };
}

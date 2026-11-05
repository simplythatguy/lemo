// Where the presenter's camera tile sits: one of five places (four corners and the centre),
// wide or upright, at one of three sizes. A corner's tile hugs its corner; the centre's is centred.

import type { CameraShape, CameraSize, Cue, Deck, Place, Rect, Spot } from "../types";
import { frameSize } from "../format.ts";

const W = 1920, H = 1080;
const INSET = 48;
const MIN = 120;
const RADIUS = 28;

/** A camera tile on the stage: its rectangle and corner radius, in stage pixels, and the place it sits in (none for
 *  an old take's placement). */
export interface CameraBox extends Rect { r: number; place?: Place }

/** The wide tile's size; the upright one is as tall, 4:5. Three large wide tiles sit side by side between the insets. */
const HEIGHT: Record<CameraSize, number> = { s: 180, m: 252, l: 324 };

export const PLACES: readonly Place[] = ["tl", "tr", "c", "bl", "br"];
export const SHAPES: readonly CameraShape[] = ["h", "v"];
export const SIZES: readonly CameraSize[] = ["s", "m", "l"];
export const SPOTS: readonly Spot[] = PLACES.flatMap((p) => SHAPES.flatMap((k) => SIZES.map((s) => `${p}-${k}-${s}` as const)));
export const DEFAULT_SPOT: Spot = "br-v-l";

export const isSpot = (v: unknown): v is Spot => SPOTS.includes(v as Spot);

export function spotParts(spot: Spot): { place: Place; shape: CameraShape; size: CameraSize } {
  const [place, shape, size] = spot.split("-") as [Place, CameraShape, CameraSize];
  return { place, shape, size };
}

export function spotBox(spot: Spot, deck: Pick<Deck, "format"> = {}): CameraBox {
  const { place, shape, size } = spotParts(spot);
  const f = frameSize(deck);
  return shapeBox(place, shape, HEIGHT[size] * Math.min(f.width / W, f.height / H), deck);
}

export function shapeBox(place: Place, shape: CameraShape, h: number, deck: Pick<Deck, "format"> = {}): CameraBox {
  const f = frameSize(deck);
  const scale = Math.min(f.width / W, f.height / H);
  const inset = INSET * scale, r = RADIUS * scale;
  const w = shape === "h" ? (h * 16) / 9 : Math.round((h * 4) / 5);
  if (place === "c") return { x: (f.width - w) / 2, y: (f.height - h) / 2, w, h, r, place };
  return { x: place[1] === "l" ? inset : f.width - inset - w, y: place[0] === "t" ? inset : f.height - inset - h, w, h, r, place };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Where takes recorded before spots existed put the camera: the deck's one placement, else the corner tile they had. */
const OLD_CORNER: Rect = { x: W - INSET - 344, y: H - INSET - 430, w: 344, h: 430 };

export function deckBox(deck: Pick<Deck, "camera" | "format">): CameraBox {
  const f = frameSize(deck);
  const scale = Math.min(f.width / W, f.height / H);
  if (!deck.camera && deck.format) return spotBox(DEFAULT_SPOT, deck);
  const r = deck.camera && [deck.camera.x, deck.camera.y, deck.camera.w, deck.camera.h].every(Number.isFinite) ? deck.camera : OLD_CORNER;
  const w = clamp(r.w * scale, MIN * scale, f.width), h = clamp(r.h * scale, MIN * scale, f.height);
  return { x: clamp(r.x * scale + (f.width - W * scale) / 2, 0, f.width - w), y: clamp(r.y * scale + (f.height - H * scale) / 2, 0, f.height - h), w, h, r: Math.min(RADIUS * scale, Math.min(w, h) / 4) };
}

/** Where a take's camera sits `ms` into it: its latest spot by then, or the deck's placement for a take without spots. */
export function boxAt(cues: Cue[], ms: number, deck: Pick<Deck, "camera" | "format">): CameraBox {
  let spot: Spot | undefined;
  let at = -Infinity;
  for (const c of cues) {
    if (c.spot && c.atMs <= ms && c.atMs >= at) {
      spot = c.spot;
      at = c.atMs;
    }
  }
  return spot ? spotBox(spot, deck) : deckBox(deck);
}

export const sameBox = (a: CameraBox, b: CameraBox) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.r === b.r;

/** A new size in the same place grows or shrinks into its shape; a new place is a cut. */
export const glides = (from: CameraBox, to: CameraBox) => from.place !== undefined && from.place === to.place;

/** `a` on its way to `b`, `t` from 0 to 1. */
export function mixBox(a: CameraBox, b: CameraBox, t: number): CameraBox {
  const m = (p: number, q: number) => p + (q - p) * t;
  return { x: m(a.x, b.x), y: m(a.y, b.y), w: m(a.w, b.w), h: m(a.h, b.h), r: m(a.r, b.r), place: b.place };
}

/** How long a glide takes, on the stage and in the picker drawn over it. */
export const GLIDE_MS = 420;

/** Where a glide from `a` to `b` is `ms` after it began. */
export function glideBox(a: CameraBox, b: CameraBox, ms: number): CameraBox {
  const t = Math.min(1, Math.max(0, ms / GLIDE_MS));
  return mixBox(a, b, 1 - (1 - t) ** 3);
}

export interface CameraMotion { from: CameraBox; to: CameraBox; at: number }

export const cameraAt = (motion: CameraMotion, now: number) => glideBox(motion.from, motion.to, now - motion.at);

export function moveCamera(motion: CameraMotion, to: CameraBox, now: number, instant = false): CameraMotion {
  if (!instant && sameBox(motion.to, to)) return motion;
  const from = instant || !glides(motion.to, to) ? to : cameraAt(motion, now);
  return { from, to, at: now };
}

interface CameraFrame { box: CameraBox | null; listeners: Set<(box: CameraBox) => void> }
const frames = new WeakMap<HTMLCanvasElement, CameraFrame>();
function cameraFrame(canvas: HTMLCanvasElement): CameraFrame {
  let frame = frames.get(canvas);
  if (!frame) {
    frame = { box: null, listeners: new Set() };
    frames.set(canvas, frame);
  }
  return frame;
}

/** The overlay receives the box painted this frame, on the canvas's clock. */
export function publishCameraFrame(canvas: HTMLCanvasElement, box: CameraBox) {
  const frame = cameraFrame(canvas);
  if (frame.box && sameBox(frame.box, box) && frame.box.place === box.place) return;
  frame.box = box;
  for (const draw of frame.listeners) draw(box);
}

export function observeCameraFrame(canvas: HTMLCanvasElement, draw: (box: CameraBox) => void) {
  const frame = cameraFrame(canvas);
  frame.listeners.add(draw);
  if (frame.box) draw(frame.box);
  return () => { frame.listeners.delete(draw); };
}

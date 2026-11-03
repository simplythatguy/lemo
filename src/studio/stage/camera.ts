// Where the presenter's camera tile sits on the 1920×1080 stage: one of five places (four corners and the centre),
// wide or upright, at one of three sizes. A corner's tile hugs its corner; the centre's is centred.

import type { CameraShape, CameraSize, Cue, Deck, Place, Rect, Spot } from "../types";

const W = 1920, H = 1080;
const INSET = 48;
const MIN = 120;
const RADIUS = 28;

/** A camera tile on the stage: its rectangle and corner radius, in stage pixels, and the place it sits in (none for
 *  an old take's placement). */
export interface CameraBox extends Rect { r: number; place?: Place }

/** The wide tile's size; the upright one is as tall, 4:5. Three large wide tiles sit side by side between the insets. */
const WIDE: Record<CameraSize, { w: number; h: number }> = {
  s: { w: 320, h: 180 },
  m: { w: 448, h: 252 },
  l: { w: 576, h: 324 },
};

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

export function spotBox(spot: Spot): CameraBox {
  const { place, shape, size } = spotParts(spot);
  const { h } = WIDE[size];
  const w = shape === "h" ? WIDE[size].w : Math.round((h * 4) / 5);
  if (place === "c") return { x: (W - w) / 2, y: (H - h) / 2, w, h, r: RADIUS, place };
  return { x: place[1] === "l" ? INSET : W - INSET - w, y: place[0] === "t" ? INSET : H - INSET - h, w, h, r: RADIUS, place };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Where takes recorded before spots existed put the camera: the deck's one placement, else the corner tile they had. */
const OLD_CORNER: Rect = { x: W - INSET - 344, y: H - INSET - 430, w: 344, h: 430 };

export function deckBox(deck: Pick<Deck, "camera">): CameraBox {
  const r = deck.camera && [deck.camera.x, deck.camera.y, deck.camera.w, deck.camera.h].every(Number.isFinite) ? deck.camera : OLD_CORNER;
  const w = clamp(r.w, MIN, W), h = clamp(r.h, MIN, H);
  return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h, r: Math.min(RADIUS, Math.min(w, h) / 4) };
}

/** Where a take's camera sits `ms` into it: its latest spot by then, or the deck's placement for a take without spots. */
export function boxAt(cues: Cue[], ms: number, deck: Pick<Deck, "camera">): CameraBox {
  let spot: Spot | undefined;
  let at = -Infinity;
  for (const c of cues) {
    if (c.spot && c.atMs <= ms && c.atMs >= at) {
      spot = c.spot;
      at = c.atMs;
    }
  }
  return spot ? spotBox(spot) : deckBox(deck);
}

export const sameBox = (a: CameraBox, b: CameraBox) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.r === b.r;

/** A new size in the same place grows or shrinks into its shape; a new place is a cut. */
export const glides = (from: CameraBox, to: CameraBox) => from.place !== undefined && from.place === to.place;

/** `a` on its way to `b`, `t` from 0 to 1. */
export function mixBox(a: CameraBox, b: CameraBox, t: number): CameraBox {
  const m = (p: number, q: number) => p + (q - p) * t;
  return { x: m(a.x, b.x), y: m(a.y, b.y), w: m(a.w, b.w), h: m(a.h, b.h), r: m(a.r, b.r), place: b.place };
}

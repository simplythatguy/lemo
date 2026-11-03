// This device's camera spot: the place your camera takes when you record, and the shape and size each place had when
// you last used it. Kept in this browser only; your teammates have their own.
import { useSyncExternalStore } from "react";
import { PLACES, SHAPES, SIZES } from "./stage/camera";
import type { CameraShape, CameraSize, Place, Spot } from "./types";

export interface SpotPref {
  place: Place;
  shapes: Record<Place, CameraShape>;
  sizes: Record<Place, CameraSize>;
}

const KEY = "lemo.camera";
const each = <T,>(v: T) => ({ tl: v, tr: v, c: v, bl: v, br: v });
const DEFAULT: SpotPref = { place: "br", shapes: each<CameraShape>("v"), sizes: each<CameraSize>("l") };

export const spotOf = (p: SpotPref): Spot => `${p.place}-${p.shapes[p.place]}-${p.sizes[p.place]}`;

function parse(raw: string | null): SpotPref {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<SpotPref> | null;
    if (!v || typeof v !== "object") return DEFAULT;
    const sizes = { ...DEFAULT.sizes }, shapes = { ...DEFAULT.shapes };
    for (const p of PLACES) {
      if (SIZES.includes(v.sizes?.[p] as CameraSize)) sizes[p] = v.sizes![p];
      if (SHAPES.includes(v.shapes?.[p] as CameraShape)) shapes[p] = v.shapes![p];
    }
    return { place: PLACES.includes(v.place as Place) ? v.place! : DEFAULT.place, shapes, sizes };
  } catch {
    return DEFAULT;
  }
}

let raw: string | null = null;
let cached = DEFAULT;
const listeners = new Set<() => void>();

function read(): SpotPref {
  let now: string | null;
  try {
    now = localStorage.getItem(KEY);
  } catch {
    return cached;
  }
  if (now !== raw) {
    raw = now;
    cached = parse(now);
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const other = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", other);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", other);
  };
}

export function setSpotPref(update: (p: SpotPref) => SpotPref) {
  const next = update(read());
  cached = next;
  try {
    raw = JSON.stringify(next);
    localStorage.setItem(KEY, raw);
  } catch {
    /* storage blocked: kept for this page only */
  }
  for (const l of listeners) l();
}

export const useSpotPref = () => useSyncExternalStore(subscribe, read);

/** Moves the camera to `place`, in the shape and size that place had last, or the ones given from now on. */
export const toPlace = (place: Place, set: { shape?: CameraShape; size?: CameraSize } = {}) =>
  setSpotPref((p) => ({
    place,
    shapes: set.shape ? { ...p.shapes, [place]: set.shape } : p.shapes,
    sizes: set.size ? { ...p.sizes, [place]: set.size } : p.sizes,
  }));

// This device's camera spot: the place your camera takes when you record, and the size each place had when you last
// used it. Kept in this browser only; your teammates have their own.
import { useSyncExternalStore } from "react";
import { PLACES, SIZES } from "./stage/camera";
import type { CameraSize, Place, Spot } from "./types";

export interface SpotPref {
  place: Place;
  sizes: Record<Place, CameraSize>;
}

const KEY = "lemo.camera";
const DEFAULT: SpotPref = { place: "br", sizes: { tl: "m", tr: "m", c: "m", bl: "m", br: "m" } };

export const spotOf = (p: SpotPref): Spot => `${p.place}-${p.sizes[p.place]}`;

function parse(raw: string | null): SpotPref {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<SpotPref> | null;
    if (!v || typeof v !== "object") return DEFAULT;
    const sizes = { ...DEFAULT.sizes };
    for (const p of PLACES) if (SIZES.includes(v.sizes?.[p] as CameraSize)) sizes[p] = v.sizes![p];
    return { place: PLACES.includes(v.place as Place) ? v.place! : DEFAULT.place, sizes };
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

/** Moves the camera to `place`, at the size that place had last, or at `size` from now on. */
export const toPlace = (place: Place, size?: CameraSize) =>
  setSpotPref((p) => ({ place, sizes: size ? { ...p.sizes, [place]: size } : p.sizes }));

// Filmstrip thumbnails: each slide's finished still, painted once at full size and kept as a small bitmap.

import type { Deck, Slide } from "../types";
import { clipUrl, loadFonts, loadImage } from "./assets";
import { C } from "./draw";
import { hasTitle, paintSlide, paintTitle } from "./slides";
import { STAGE_H, STAGE_W } from "./stage";

/** Cached thumbnails are this wide: 2× a 128 px filmstrip tile. */
const THUMB_W = 256;
const THUMB_H = (THUMB_W * STAGE_H) / STAGE_W;
/** A clip that has not shown a frame by then is painted as its empty frame. */
const CLIP_WAIT_MS = 4000;

const cache = new WeakMap<Deck, Map<string, Promise<HTMLCanvasElement>>>();

/** The clip's first frame, or undefined when the file is missing or will not decode. */
function firstFrame(slide: Extract<Slide, { kind: "clip" }>): Promise<HTMLVideoElement | undefined> {
  return clipUrl(slide.src).then(
    (url) =>
      new Promise((resolve) => {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        const timer = window.setTimeout(() => resolve(undefined), CLIP_WAIT_MS);
        const done = (ok: boolean) => {
          window.clearTimeout(timer);
          resolve(ok && v.videoWidth ? v : undefined);
        };
        v.onloadeddata = () => {
          v.onseeked = () => done(true);
          v.currentTime = (slide.from ?? 0) + 0.04;
        };
        v.onerror = () => done(false);
        v.src = url;
      }),
    () => undefined,
  );
}

async function paintThumb(deck: Deck, group: number, index: number): Promise<HTMLCanvasElement> {
  const slide = deck.groups[group]?.slides[index];
  const full = document.createElement("canvas");
  full.width = STAGE_W;
  full.height = STAGE_H;
  const ctx = full.getContext("2d", { alpha: false })!;
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  if (slide) {
    await loadFonts();
    if (slide.kind === "image") await loadImage(slide.src).catch(() => undefined);
    if (slide.kind === "compare") await Promise.all([slide.left.src, slide.right.src].map((s) => loadImage(s).catch(() => undefined)));
    const video = slide.kind === "clip" ? await firstFrame(slide) : undefined;
    if (hasTitle(slide)) paintTitle(ctx, slide.title);
    paintSlide(ctx, slide, { video });
    if (video) video.removeAttribute("src");
  }
  const small = document.createElement("canvas");
  small.width = THUMB_W;
  small.height = THUMB_H;
  const s = small.getContext("2d", { alpha: false })!;
  s.imageSmoothingQuality = "high";
  s.drawImage(full, 0, 0, THUMB_W, THUMB_H);
  return small;
}

export function thumbnail(deck: Deck, group: number, slide: number): Promise<HTMLCanvasElement> {
  let byDeck = cache.get(deck);
  if (!byDeck) cache.set(deck, (byDeck = new Map()));
  const key = `${group}:${slide}`;
  let p = byDeck.get(key);
  if (!p) {
    p = paintThumb(deck, group, slide);
    byDeck.set(key, p);
    p.catch(() => byDeck.delete(key));
  }
  return p;
}

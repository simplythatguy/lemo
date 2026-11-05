// Filmstrip thumbnails: each slide's finished still, painted once at full size and kept as a small bitmap.

import type { Deck, Slide } from "../types";
import { clipUrl, loadFonts, loadImage } from "./assets";
import { C } from "./draw";
import { hasTitle, paintSlide, paintTitle } from "./slides";
import { frameSize, thumbSize } from "../format";

/** Cached thumbnails are this wide: 2× a 128 px filmstrip tile. */
const THUMB_W = 256;
/** A clip that has not shown a frame by then is painted as its empty frame. */
const CLIP_WAIT_MS = 4000;

/** Keyed by what the slide paints, so a deck edited elsewhere (a transcript, another group) keeps its stills. */
const cache = new Map<string, Promise<HTMLCanvasElement>>();

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

async function paintThumb(deck: Deck, slide: Slide | undefined): Promise<HTMLCanvasElement> {
  const { width, height } = frameSize(deck);
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const ctx = full.getContext("2d", { alpha: false })!;
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, width, height);
  if (slide) {
    await loadFonts();
    if (slide.kind === "page" || slide.kind === "image") await loadImage(slide.src).catch(() => undefined);
    if (slide.kind === "logo" && deck.logo) await loadImage(deck.logo).catch(() => undefined);
    if (slide.kind === "compare") await Promise.all([slide.left.src, slide.right.src].map((s) => loadImage(s).catch(() => undefined)));
    const video = slide.kind === "clip" ? await firstFrame(slide) : undefined;
    if (hasTitle(slide)) paintTitle(ctx, slide.title);
    paintSlide(ctx, slide, { video, brand: { title: deck.title, logo: deck.logo } });
    if (video) video.removeAttribute("src");
  }
  const small = document.createElement("canvas");
  const thumb = thumbSize(deck, THUMB_W);
  small.width = thumb.width;
  small.height = thumb.height;
  const s = small.getContext("2d", { alpha: false })!;
  s.imageSmoothingQuality = "high";
  s.drawImage(full, 0, 0, small.width, small.height);
  return small;
}

export function thumbnail(deck: Deck, group: number, index: number): Promise<HTMLCanvasElement> {
  const slide = deck.groups[group]?.slides[index];
  const key = JSON.stringify([slide, deck.format, slide?.kind === "logo" ? [deck.title, deck.logo] : null]);
  let p = cache.get(key);
  if (!p) {
    p = paintThumb(deck, slide);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

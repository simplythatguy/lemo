// The stage: paints the deck on a 1920×1080 canvas, live in the studio and frame-exact in the export.

import type { Deck, TakeMedia } from "../types";
import { preload as preloadAssets } from "./assets";
import { exportVideo as renderVideo } from "./export";
import { makeStage, type Stage } from "./stage";
import { thumbnail } from "./thumb";

export { STAGE_W, STAGE_H, type Stage } from "./stage";

/** Paints `deck` into `canvas` (backing store 1920×1080, CSS-scaled by the caller) on its own rAF loop. */
export function createStage(canvas: HTMLCanvasElement, deck: Deck): Stage {
  return makeStage(canvas, deck);
}

/** Loads fonts, images and clips (as blob URLs, for exact seeking). Call before recording or exporting. */
export function preload(deck: Deck, onProgress?: (fraction: number) => void): Promise<void> {
  return preloadAssets(deck, onProgress);
}

/** Real-time render of the whole video: intro card (INTRO_MS), every group that has a take in deck order (slides switched at the take's cues, the take's video as the camera tile, the take's audio as the only audio), outro card (OUTRO_MS). */
export function exportVideo(opts: {
  deck: Deck;
  takes: Record<string, TakeMedia>;
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
  /** Paint into this visible canvas, so the render screen shows the video as it is made. */
  canvas?: HTMLCanvasElement;
  /** false leaves out the intro and outro cards, for one group on its own. */
  cards?: boolean;
  /** Also play the sound out loud, so a render that is being watched is heard as it is made. */
  monitor?: boolean;
}): Promise<{ blob: Blob; mime: string }> {
  return renderVideo(opts);
}

/** Paints slide `slide` of group `group` into `canvas`, scaled to its backing size. Each slide is painted once per deck and cached. */
export async function renderThumb(canvas: HTMLCanvasElement, deck: Deck, group: number, slide: number): Promise<void> {
  const still = await thumbnail(deck, group, slide);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(still, 0, 0, canvas.width, canvas.height);
}

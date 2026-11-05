// The stage: paints the deck at its document ratio, live in the studio and in the export.

import type { Deck, TakeMedia } from "../types";
import { preload as preloadAssets } from "./assets";
import { exportVideo as renderVideo } from "./export";
import { makeStage, type Stage } from "./stage";
import { thumbnail } from "./thumb";

export { type Stage } from "./stage";

/** Everything about `deck` the stage paints (not the transcript or timings): a stage only needs rebuilding when this changes. */
export function stageKey(deck: Deck): string {
  return JSON.stringify([deck.title, deck.logo ?? null, deck.team, deck.format, deck.groups.map((g) => g.slides)]);
}

/** Paints `deck` into a document-shaped canvas, CSS-scaled by the caller, on its own rAF loop. */
export function createStage(canvas: HTMLCanvasElement, deck: Deck): Stage {
  return makeStage(canvas, deck);
}

/** Loads fonts, images (slide pages, the logo) and clips (as blob URLs, for exact seeking). Call before recording or exporting. */
export function preload(deck: Deck, onProgress?: (fraction: number) => void): Promise<void> {
  return preloadAssets(deck, onProgress);
}

/** Renders takes in deck order, replaying their slide/camera cues and sound. Parts mode adds intro/outro cards. */
export function exportVideo(opts: {
  deck: Deck;
  takes: Record<string, TakeMedia>;
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
  /** Paint into this visible canvas, so the render screen shows the video as it is made. */
  canvas?: HTMLCanvasElement;
  /** Override title cards; by default continuous takes omit them and parts mode includes them. */
  cards?: boolean;
  /** Also play the sound out loud, so a render that is being watched is heard as it is made. */
  monitor?: boolean;
}): Promise<{ blob: Blob; mime: string }> {
  return renderVideo(opts);
}

/** Paints slide `slide` of group `group` into `canvas`, scaled to its backing size. Each distinct slide is painted once and cached. */
export async function renderThumb(canvas: HTMLCanvasElement, deck: Deck, group: number, slide: number): Promise<void> {
  const still = await thumbnail(deck, group, slide);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(still, 0, 0, canvas.width, canvas.height);
}

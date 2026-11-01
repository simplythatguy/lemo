// Fonts, stills and clips, loaded once per page and shared by every stage (the live one and the export one).
// Clips are fetched whole and played from blob URLs, so seeking is exact and never waits on the network.

import "@fontsource-variable/inter/opsz.css";
import type { Deck, Rect } from "../types";
import { FAMILY, WEIGHTS } from "./draw";

const images = new Map<string, Promise<HTMLImageElement>>();
const decoded = new Map<string, HTMLImageElement>();
const clips = new Map<string, Promise<string>>();
let fonts: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  fonts ??= Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 60px ${FAMILY}`, "Batatis 0123456789 $“”·–"))).then(() => {});
  return fonts;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = (async () => {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      await img.decode();
      decoded.set(src, img);
      return img;
    })();
    images.set(src, p);
    p.catch(() => images.delete(src));
  }
  return p;
}

/** The decoded still, or undefined while it loads (starting the load if nobody has). */
export function image(src: string): HTMLImageElement | undefined {
  const img = decoded.get(src);
  if (!img) void loadImage(src).catch(() => {});
  return img;
}

const inks = new Map<HTMLImageElement, Rect>();

/** The bounding box of everything that is not near-white in `img`, in its own pixels. A page minus its blank margin. */
export function inkBounds(img: HTMLImageElement): Rect {
  let r = inks.get(img);
  if (r) return r;
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  r = x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  inks.set(img, r);
  return r;
}

export function clipUrl(src: string): Promise<string> {
  let p = clips.get(src);
  if (!p) {
    p = fetch(src).then(async (res) => {
      if (!res.ok) throw new Error(`clip ${src}: HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    });
    clips.set(src, p);
    p.catch(() => clips.delete(src));
  }
  return p;
}

export function deckSources(deck: Deck): { images: string[]; clips: string[] } {
  const imgs = new Set<string>(), vids = new Set<string>();
  for (const g of deck.groups)
    for (const s of g.slides) {
      if (s.kind === "image") imgs.add(s.src);
      if (s.kind === "compare") imgs.add(s.left.src).add(s.right.src);
      if (s.kind === "clip") vids.add(s.src);
    }
  return { images: [...imgs], clips: [...vids] };
}

export async function preload(deck: Deck, onProgress?: (fraction: number) => void): Promise<void> {
  const { images: imgs, clips: vids } = deckSources(deck);
  const jobs: Promise<unknown>[] = [loadFonts(), ...imgs.map(loadImage), ...vids.map(clipUrl)];
  let done = 0;
  onProgress?.(0);
  await Promise.all(jobs.map((j) => j.then(() => onProgress?.(++done / jobs.length))));
}

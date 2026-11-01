// A dropped PDF or PowerPoint becomes 1920×1080 JPEG slides. Both renderers load on first use.
import { FILE_MAX_BYTES } from "../studio/room";

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
const WIDE = 16 / 9;

/** A file the setup refuses, with the short line to show. */
export class SlideFileError extends Error {}

export type SlideKind = "pdf" | "pptx";

export function slideKind(file: File): SlideKind {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".pptx") || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (name.endsWith(".ppt")) throw new SlideFileError("Save it as .pptx first");
  if (name.endsWith(".key")) throw new SlideFileError("Export it as PDF first");
  throw new SlideFileError("Use a PDF or PowerPoint file");
}

/** Within 1% of 16:9. */
export const isWide = (w: number, h: number) => w > 0 && h > 0 && Math.abs(w / h / WIDE - 1) <= 0.01;

const NAMED: [number, number][] = [[16, 9], [16, 10], [4, 3], [3, 2], [5, 4], [1, 1], [21, 9], [9, 16], [3, 4], [2, 3], [4, 5]];

/** "4:3", "A4", or "1.29:1". */
export function ratioLabel(w: number, h: number): string {
  const r = w / h;
  for (const [a, b] of NAMED) if (Math.abs(r / (a / b) - 1) < 0.015) return `${a}:${b}`;
  if (Math.abs(Math.max(r, 1 / r) / Math.SQRT2 - 1) < 0.01) return "A4";
  if (Math.abs(Math.max(r, 1 / r) / (11 / 8.5) - 1) < 0.01) return "Letter";
  return r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}

export const ratioError = (w: number, h: number, page?: number) =>
  new SlideFileError(`${page ? `Page ${page} is ` : ""}${ratioLabel(w, h)} — slides must be 16:9`);

export interface Rendering {
  /** Pages in the file, once known. */
  onCount(n: number): void;
  /** Page `i` is ready. */
  onSlide(i: number, jpeg: Blob): void;
  signal: AbortSignal;
}

/** Renders every page of `file` in order. Throws SlideFileError for a file it refuses. */
export async function importSlides(file: File, r: Rendering): Promise<void> {
  const kind = slideKind(file);
  const data = await file.arrayBuffer();
  if (kind === "pdf") {
    const { renderPdf } = await import("./pdf");
    await renderPdf(data, r);
  } else {
    const { renderPptx } = await import("./pptx");
    await renderPptx(data, r);
  }
}

/** A 1920×1080 canvas painted white. */
export function slideCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  return [canvas, ctx];
}

/** JPEG at 0.9, lower when a busy slide would pass the server's file limit. */
export async function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const q of [0.9, 0.82, 0.74, 0.65, 0.55]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
    if (!blob) break;
    if (blob.size <= FILE_MAX_BYTES) return blob;
  }
  throw new SlideFileError("A slide is too detailed to save");
}

// A dropped PDF or PowerPoint becomes JPEG slides in its native aspect ratio. Renderers load on first use.
import { FILE_MAX_BYTES } from "../studio/room";
import { frameSize, validFormat, type FrameSize } from "../studio/format";

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

export function documentFormat(width: number, height: number): FrameSize {
  const format = { width, height };
  if (!validFormat(format)) throw new SlideFileError("This page size can't be rendered");
  return format;
}

export interface Rendering {
  onFormat(format: FrameSize): void;
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

/** A document-shaped canvas painted white. */
export function slideCanvas(format: FrameSize): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const size = frameSize({ format });
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size.width, size.height);
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

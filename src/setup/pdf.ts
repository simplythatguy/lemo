// PDF pages to slides with pdf.js. Every page must be 16:9 before any is drawn.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ratioError, SlideFileError, isWide, slideCanvas, SLIDE_H, SLIDE_W, toJpeg, type Rendering } from "./importSlides";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function renderPdf(data: ArrayBuffer, r: Rendering): Promise<void> {
  const task = getDocument({ data: new Uint8Array(data) });
  r.signal.addEventListener("abort", () => void task.destroy(), { once: true });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    if (r.signal.aborted) throw e;
    const name = (e as { name?: string }).name;
    throw new SlideFileError(name === "PasswordException" ? "This PDF is locked" : "This PDF can't be read");
  }
  try {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { width, height } = page.getViewport({ scale: 1 });
      if (!isWide(width, height)) throw ratioError(width, height, pdf.numPages > 1 ? i : undefined);
      pages.push(page);
    }
    r.onCount(pages.length);
    for (const [i, page] of pages.entries()) {
      if (r.signal.aborted) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: SLIDE_W / base.width });
      const [canvas] = slideCanvas();
      // Pages within 1% of 16:9 are stretched the last few pixels to fill 1080 exactly.
      await page.render({ canvas, viewport, transform: [1, 0, 0, SLIDE_H / viewport.height, 0, 0], background: "#ffffff" }).promise;
      r.onSlide(i, await toJpeg(canvas));
      page.cleanup();
    }
  } finally {
    void task.destroy();
  }
}

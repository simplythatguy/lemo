// PDF pages to slides with pdf.js. The first page sets the video frame; other page sizes fit inside it.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { documentFormat, SlideFileError, slideCanvas, toJpeg, type Rendering } from "./importSlides";

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
      pages.push(page);
    }
    const first = pages[0].getViewport({ scale: 1 });
    const format = documentFormat(first.width, first.height);
    r.onFormat(format);
    r.onCount(pages.length);
    for (const [i, page] of pages.entries()) {
      if (r.signal.aborted) return;
      const base = page.getViewport({ scale: 1 });
      const [canvas] = slideCanvas(format);
      const viewport = page.getViewport({ scale: Math.min(canvas.width / base.width, canvas.height / base.height) });
      await page.render({ canvas, viewport, transform: [1, 0, 0, 1, (canvas.width - viewport.width) / 2, (canvas.height - viewport.height) / 2], background: "#ffffff" }).promise;
      r.onSlide(i, await toJpeg(canvas));
      page.cleanup();
    }
  } finally {
    void task.destroy();
  }
}

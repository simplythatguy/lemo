// PowerPoint slides to images in the browser: @aiden0z/pptx-renderer lays each slide out as HTML/SVG at its own size,
// modern-screenshot rasterises that DOM, and the result is drawn onto a 1920×1080 canvas. Hidden slides are left out.
import { buildPresentation, parseZip, RECOMMENDED_ZIP_LIMITS, renderSlide } from "@aiden0z/pptx-renderer";
import { domToCanvas } from "modern-screenshot";
import { isWide, ratioError, SlideFileError, slideCanvas, SLIDE_H, SLIDE_W, toJpeg, type Rendering } from "./importSlides";

/** Charts draw with a short entrance animation; capture after it ends. */
const CHART_SETTLE_MS = 1200;

/** `<p:sldSz cx cy>` from ppt/presentation.xml, in EMU. */
export function slideSize(presentationXml: string): { cx: number; cy: number } | null {
  const tag = presentationXml.match(/<p:sldSz\b[^>]*>/)?.[0];
  const cx = Number(tag?.match(/\bcx="(\d+)"/)?.[1]);
  const cy = Number(tag?.match(/\bcy="(\d+)"/)?.[1]);
  return cx > 0 && cy > 0 ? { cx, cy } : null;
}

const frame = () => new Promise((r) => requestAnimationFrame(r));

export async function renderPptx(data: ArrayBuffer, r: Rendering): Promise<void> {
  let files;
  try {
    files = await parseZip(data, RECOMMENDED_ZIP_LIMITS);
  } catch {
    throw new SlideFileError("This PowerPoint can't be read");
  }
  const size = slideSize(files.presentation);
  if (!size) throw new SlideFileError("This PowerPoint can't be read");
  if (!isWide(size.cx, size.cy)) throw ratioError(size.cx, size.cy);

  const pres = buildPresentation(files);
  const slides = pres.slides.filter((s) => !s.hidden);
  if (!slides.length) throw new SlideFileError("This PowerPoint has no slides");
  r.onCount(slides.length);

  // Laid out off screen at the deck's own size; the screenshot scales it to 1920 wide.
  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${pres.width}px;height:${pres.height}px;overflow:hidden;pointer-events:none`;
  document.body.appendChild(stage);
  const mediaUrlCache = new Map<string, string>();
  try {
    for (const [i, slide] of slides.entries()) {
      if (r.signal.aborted) return;
      const handle = renderSlide(pres, slide, { mediaUrlCache, externalMedia: "block" });
      try {
        stage.replaceChildren(handle.element);
        await handle.ready;
        await document.fonts.ready;
        await Promise.all([...handle.element.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
        if (handle.element.querySelector("canvas")) await new Promise((res) => setTimeout(res, CHART_SETTLE_MS));
        await frame();
        const shot = await domToCanvas(handle.element, {
          width: pres.width,
          height: pres.height,
          // No backgroundColor: it would paint over the slide's own background on the root element.
          scale: SLIDE_W / pres.width,
        });
        const [canvas, ctx] = slideCanvas();
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(shot, 0, 0, SLIDE_W, SLIDE_H);
        r.onSlide(i, await toJpeg(canvas));
      } finally {
        handle.dispose();
      }
    }
  } finally {
    stage.remove();
    for (const url of mediaUrlCache.values()) URL.revokeObjectURL(url);
  }
}

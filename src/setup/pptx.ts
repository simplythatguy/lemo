// PowerPoint slides to images in the browser: @aiden0z/pptx-renderer lays each slide out as HTML/SVG at its own size,
// modern-screenshot rasterises that DOM at its native ratio. Hidden slides are left out.
import { buildPresentation, parseZip, RECOMMENDED_ZIP_LIMITS, renderSlide } from "@aiden0z/pptx-renderer";
import { domToCanvas } from "modern-screenshot";
import { documentFormat, SlideFileError, slideCanvas, toJpeg, type Rendering } from "./importSlides";
import { frameSize } from "../studio/format";

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
  const format = documentFormat(size.cx, size.cy);
  const output = frameSize({ format });
  r.onFormat(format);

  const pres = buildPresentation(files);
  const slides = pres.slides.filter((s) => !s.hidden);
  if (!slides.length) throw new SlideFileError("This PowerPoint has no slides");
  r.onCount(slides.length);

  // Laid out off screen at the deck's own size; the screenshot scales to the bounded video frame.
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
          scale: Math.min(output.width / pres.width, output.height / pres.height),
        });
        const [canvas, ctx] = slideCanvas(format);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(shot, (output.width - shot.width) / 2, (output.height - shot.height) / 2);
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

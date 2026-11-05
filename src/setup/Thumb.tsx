// One slide in its document frame: the uploaded page, or a kept slide painted by the stage.
import { useEffect, useRef } from "react";
import { renderThumb } from "../studio/stage";
import type { DraftSlide } from "./draft";
import { thumbSize } from "../studio/format";
import type { Deck } from "../studio/types";

export function Thumb({ slide, format }: { slide: DraftSlide; format?: Deck["format"] }) {
  if (slide.kept) return <KeptThumb slide={slide} format={format} />;
  // A just-imported slide is already in memory: loading it lazily would blank it for a frame as the import's grid hands over.
  const local = slide.src.startsWith("blob:");
  return <img className="su-thumb-img" src={slide.src} alt="" draggable={false} loading={local ? undefined : "lazy"} decoding={local ? undefined : "async"} />;
}

function KeptThumb({ slide, format }: { slide: DraftSlide; format?: Deck["format"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !slide.kept) return;
    const size = thumbSize({ format }, 384);
    c.width = size.width;
    c.height = size.height;
    const deck = { title: "", team: [], format, groups: [{ id: "g", name: "", speaker: 0, slides: [slide.kept], script: [""] }] };
    void renderThumb(c, deck, 0, 0).catch(() => undefined);
  }, [slide, format]);
  return <canvas ref={canvas} className="su-thumb-img" aria-hidden="true" />;
}

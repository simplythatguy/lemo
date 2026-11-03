// One slide as a rounded 16:9 picture: the uploaded page, or a kept slide of an older deck painted by the stage.
import { useEffect, useRef } from "react";
import { renderThumb } from "../studio/stage";
import type { DraftSlide } from "./draft";

export function Thumb({ slide }: { slide: DraftSlide }) {
  if (slide.kept) return <KeptThumb slide={slide} />;
  // A just-imported slide is already in memory: loading it lazily would blank it for a frame as the import's grid hands over.
  const local = slide.src.startsWith("blob:");
  return <img className="su-thumb-img" src={slide.src} alt="" draggable={false} loading={local ? undefined : "lazy"} decoding={local ? undefined : "async"} />;
}

function KeptThumb({ slide }: { slide: DraftSlide }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !slide.kept) return;
    c.width = 384;
    c.height = 216;
    const deck = { title: "", team: [], groups: [{ id: "g", name: "", speaker: 0, slides: [slide.kept], script: [""] }] };
    void renderThumb(c, deck, 0, 0).catch(() => undefined);
  }, [slide]);
  return <canvas ref={canvas} className="su-thumb-img" aria-hidden="true" />;
}

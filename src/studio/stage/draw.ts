// Canvas primitives for the stage: palette, type, framed media with a cached soft shadow, marks and the Batatis mark.

import type { Mark, Rect } from "../types";

export type Ctx = CanvasRenderingContext2D;

export const C = {
  white: "#FFFFFF",
  ink: "#0B0D12",
  grey: "#6B7280",
  faint: "#A1A6B0",
  hairline: "#E5E7EB",
  bar: "#E1E3E8",
  blue: "#5266EB",
  tint: "rgba(82,102,235,0.08)",
  /** The camera tile before (or without) a picture. */
  camera: "#F0F1F5",
} as const;

export const FAMILY = "'Inter Variable', Inter, system-ui, sans-serif";
export const WEIGHTS = [400, 500, 600] as const;

/** Layout constants, in stage pixels. Everything left-aligns on `margin`. */
export const L = {
  margin: 96,
  titleBaseline: 150,
  frame: { x: 96, y: 210, w: 1344, h: 840 } as Rect,
  camera: { x: 1480, y: 620, w: 344, h: 430 } as Rect,
  radius: 28,
} as const;

export function font(ctx: Ctx, weight: number, size: number, tracking = 0) {
  ctx.font = `${weight} ${size}px ${FAMILY}`;
  ctx.letterSpacing = `${(tracking * size).toFixed(2)}px`;
}

export function text(ctx: Ctx, s: string, x: number, y: number, color: string, align: CanvasTextAlign = "left") {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y);
}

/** Width of `s` in the current font. Canvas adds letter-spacing after the last glyph too; drop it. */
export function measure(ctx: Ctx, s: string): number {
  const extra = parseFloat(ctx.letterSpacing) || 0;
  return ctx.measureText(s).width - (s.length ? extra : 0);
}

/** Greedy word wrap that keeps explicit line breaks. */
export function wrap(ctx: Ctx, s: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(ctx, next) > maxW) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function roundRectPath(ctx: Ctx, r: Rect, radius: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

// A blurred shadow redrawn every frame costs a full Gaussian pass; draw it once per size and reuse the sprite.
const shadowCache = new Map<string, HTMLCanvasElement>();
const SHADOW = { dy: 10, blur: 44, color: "rgba(15,23,42,0.07)" };

function shadowSprite(w: number, h: number, radius: number): HTMLCanvasElement {
  const key = `${Math.round(w)}x${Math.round(h)}r${radius}`;
  let sprite = shadowCache.get(key);
  if (sprite) return sprite;
  const pad = SHADOW.blur * 2;
  sprite = document.createElement("canvas");
  sprite.width = Math.ceil(w + pad * 2);
  sprite.height = Math.ceil(h + pad * 2 + SHADOW.dy);
  const s = sprite.getContext("2d")!;
  // Draw the shape far off-canvas and keep only its shadow, so the sprite holds no fill.
  s.shadowColor = SHADOW.color;
  s.shadowBlur = SHADOW.blur;
  s.shadowOffsetX = 10000;
  s.shadowOffsetY = SHADOW.dy;
  s.fillStyle = "#000";
  s.beginPath();
  s.roundRect(pad - 10000, pad, w, h, radius);
  s.fill();
  shadowCache.set(key, sprite);
  return sprite;
}

/** A rounded media frame: very soft shadow, white fill, contents drawn by `inner` clipped to it, then a 1px hairline. */
export function frame(ctx: Ctx, r: Rect, inner?: (ctx: Ctx) => void, radius: number = L.radius) {
  const sprite = shadowSprite(r.w, r.h, radius);
  const pad = SHADOW.blur * 2;
  ctx.drawImage(sprite, r.x - pad, r.y - pad, sprite.width, sprite.height);
  ctx.save();
  roundRectPath(ctx, r, radius);
  ctx.fillStyle = C.white;
  ctx.fill();
  if (inner) {
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    inner(ctx);
  }
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, { x: r.x + 0.5, y: r.y + 0.5, w: r.w - 1, h: r.h - 1 }, radius - 0.5);
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Contain-fit of a `sw`×`sh` source into `box`: the destination rect. */
export function containRect(sw: number, sh: number, box: Rect): Rect {
  const s = Math.min(box.w / sw, box.h / sh);
  const w = sw * s, h = sh * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Cover-crop source rect for a `sw`×`sh` source filling `dw`×`dh`, centred on (`cx`,`cy`) in 0..1, zoomed by `zoom`. */
export function coverSource(sw: number, sh: number, dw: number, dh: number, cx = 0.5, cy = 0.5, zoom = 1): Rect {
  const s = Math.max(dw / sw, dh / sh) * zoom;
  const w = dw / s, h = dh / s;
  const x = Math.min(Math.max(sw * cx - w / 2, 0), sw - w);
  const y = Math.min(Math.max(sh * cy - h / 2, 0), sh - h);
  return { x, y, w, h };
}

/**
 * One mark over a screen-space `r`, fully drawn: a 3px outline with a faint tint, and the label as a small pill
 * inside the mark's lower-left corner. Blue marks what is there; ink marks what is not.
 */
export function drawMark(ctx: Ctx, mark: Mark, r: Rect) {
  const color = mark.tone === "ink" ? C.ink : mark.tone === "grey" ? C.grey : C.blue;
  const box = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 };
  ctx.save();
  if (mark.strike) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h / 2);
    ctx.lineTo(r.x + r.w, r.y + r.h / 2);
    ctx.stroke();
  } else {
    roundRectPath(ctx, box, 8);
    ctx.fillStyle = mark.tone === "blue" || !mark.tone ? C.tint : "rgba(11,13,18,0.035)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (mark.label) {
    font(ctx, 600, 18, 0);
    const w = measure(ctx, mark.label) + 24, h = 32;
    const x = box.x + 10, y = box.y + box.h - h - 10;
    roundRectPath(ctx, { x, y, w, h }, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
    text(ctx, mark.label, x + 12, y + h / 2 + 6.5, C.white);
  }
  ctx.restore();
}

/**
 * The Batatis mark, as the app draws it: a soft, slightly irregular rounded square with the brand's radial fill.
 * `size` is the box edge.
 */
export function drawMarkBlob(ctx: Ctx, cx: number, cy: number, size: number) {
  if (size <= 0.5) return;
  const k = size / 24;
  const x = cx - size / 2, y = cy - size / 2;
  const g = ctx.createRadialGradient(x + size * 0.35, y + size * 0.3, 0, x + size * 0.35, y + size * 0.3, size * 0.955);
  g.addColorStop(0, "#9aa6ff");
  g.addColorStop(0.55, "#5266eb");
  g.addColorStop(1, "#3a49b8");
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, [8 * k, 12 * k, 9 * k, 13 * k]);
  ctx.fillStyle = g;
  ctx.fill();
}

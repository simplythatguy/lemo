// One painter per slide kind. Slides are stills: every painter draws its slide fully formed, with no clock.
// Only the intro and outro cards take elapsed time, for their logo reveal. The stage owns transitions.

import type { Bar, Mark, Panel, Rect, Slide } from "../types";
import { image, inkBounds } from "./assets";
import { C, L, containRect, drawMark, drawMarkBlob, font, frame, measure, text, wrap, type Ctx } from "./draw";
import { outCubic, outQuint, span } from "./ease";

export interface Env {
  /** The clip's video element, when the slide is a clip. */
  video?: HTMLVideoElement;
}

export type Titled = Exclude<Slide, { kind: "statement" } | { kind: "logo" }>;
export const hasTitle = (s: Slide): s is Titled & { title: string } => "title" in s && !!s.title;

/** Inter's cap height, as a fraction of the font size. */
const CAP = 0.727;

export function paintSlide(ctx: Ctx, s: Slide, env: Env) {
  switch (s.kind) {
    case "statement": return paintStatement(ctx, s);
    case "logo": return paintLogo(ctx, s.line);
    case "clip": return paintClip(ctx, env.video);
    case "image": return paintImage(ctx, s);
    case "compare": return paintCompare(ctx, s.left, s.right);
    case "bars": return paintBars(ctx, s);
    case "count": return paintCount(ctx, s);
    case "dots": return paintDots(ctx, s);
    case "flow": return paintFlow(ctx, s);
  }
}

/** The title: Inter 600 60px at the top left. `rise` lifts it into place during a transition. */
export function paintTitle(ctx: Ctx, title: string, rise = 0) {
  font(ctx, 600, 60, -0.025);
  text(ctx, title, L.margin, L.titleBaseline + rise, C.ink);
}

/** Lines of `size` type stacked from `top` (the first line's cap top); returns each baseline. */
const baselines = (n: number, top: number, size: number, lh: number) => Array.from({ length: n }, (_, i) => top + size * CAP + i * lh);

// ── statement ────────────────────────────────────────────────────────────────

const STATEMENT = { maxSize: 150, maxW: 1290, centre: 516 };

function paintStatement(ctx: Ctx, s: Extract<Slide, { kind: "statement" }>) {
  // Shrink until the author's own line breaks hold, so no line wraps into an orphan.
  const breaks = s.text.split("\n").length;
  let size = STATEMENT.maxSize, lines: string[] = [];
  for (; size >= 72; size -= 2) {
    font(ctx, 600, size, -0.04);
    lines = wrap(ctx, s.text, STATEMENT.maxW);
    if (lines.length <= breaks) break;
  }
  const lh = size * 1.04;
  const sub = 40;
  const subGap = size * 0.5;
  const height = (lines.length - 1) * lh + size * CAP + (s.sub ? subGap + sub * CAP : 0);
  const ys = baselines(lines.length, STATEMENT.centre - height / 2, size, lh);
  const accent = locate(s.text, lines, s.accent);
  font(ctx, 600, size, -0.04);
  lines.forEach((line, i) => {
    // Hang an opening quote in the margin so the letters, not the mark, align.
    let x = L.margin - (/^[“"‘']/.test(line) ? measure(ctx, line[0]) : 0);
    for (const [seg, blue] of segments(line, accent[i])) {
      text(ctx, seg, x, ys[i], blue ? C.blue : C.ink);
      x += ctx.measureText(seg).width;
    }
  });
  if (s.sub) {
    font(ctx, 500, sub, -0.01);
    text(ctx, s.sub, L.margin, ys[ys.length - 1] + subGap + sub * CAP, C.grey);
  }
}

/** Where the accent sits on each wrapped line, as [start, end) character ranges. */
function locate(full: string, lines: string[], accent?: string): ([number, number] | null)[] {
  const out: ([number, number] | null)[] = lines.map(() => null);
  if (!accent) return out;
  const flat = full.replace(/\s+/g, " ");
  const at = flat.indexOf(accent.replace(/\s+/g, " "));
  if (at < 0) return out;
  const end = at + accent.length;
  let offset = 0;
  lines.forEach((line, i) => {
    const a = Math.max(at, offset), b = Math.min(end, offset + line.length);
    if (a < b) out[i] = [a - offset, b - offset];
    offset += line.length + 1;
  });
  return out;
}

function segments(line: string, r: [number, number] | null): [string, boolean][] {
  if (!r) return [[line, false]];
  return ([[line.slice(0, r[0]), false], [line.slice(r[0], r[1]), true], [line.slice(r[1]), false]] as [string, boolean][]).filter(([s]) => s);
}

// ── logo: the slide (still) and the intro and outro cards (the only animated slides) ─────────

const LOCKUP = { mark: 118, gap: 30, size: 112, cy: 500 };

/** The mark and name side by side, centred on the canvas. `mark` and `word` are 0..1 reveal progress. */
function lockup(ctx: Ctx, cy: number, mark = 1, word = 1) {
  font(ctx, 600, LOCKUP.size, -0.035);
  const w = measure(ctx, "Batatis");
  const left = 960 - (LOCKUP.mark + LOCKUP.gap + w) / 2;
  if (mark > 0) {
    ctx.save();
    ctx.globalAlpha *= outCubic(Math.min(1, mark * 1.6));
    drawMarkBlob(ctx, left + LOCKUP.mark / 2, cy, LOCKUP.mark * (0.9 + 0.1 * outQuint(mark)));
    ctx.restore();
  }
  if (word > 0) {
    ctx.save();
    ctx.globalAlpha *= outCubic(word);
    font(ctx, 600, LOCKUP.size, -0.035);
    text(ctx, "Batatis", left + LOCKUP.mark + LOCKUP.gap + 16 * (1 - outQuint(word)), cy + (LOCKUP.size * CAP) / 2, C.ink);
    ctx.restore();
  }
}

function paintLogo(ctx: Ctx, line?: string) {
  lockup(ctx, line ? LOCKUP.cy - 40 : LOCKUP.cy);
  if (line) {
    font(ctx, 500, 44, -0.015);
    text(ctx, line, 960, LOCKUP.cy + 130, C.grey, "center");
  }
}

/** Intro: the mark settles in place, the name follows it in, then the team fades in. Outro: mark and name only. */
export function paintCard(ctx: Ctx, which: "intro" | "outro", t: number, team: string[]) {
  const names = which === "intro" ? team : [];
  const cy = names.length ? LOCKUP.cy - 30 : LOCKUP.cy;
  lockup(ctx, cy, span(t, 0, 1100), span(t, 420, 1000));
  if (!names.length) return;
  font(ctx, 500, 32, -0.005);
  const sep = "  ·  ";
  const widths = names.map((n) => measure(ctx, n));
  const sepW = measure(ctx, sep);
  let x = 960 - (widths.reduce((a, b) => a + b, 0) + sepW * (names.length - 1)) / 2;
  const y = cy + 150;
  names.forEach((n, i) => {
    ctx.save();
    ctx.globalAlpha *= outCubic(span(t, 1350 + i * 170, 700));
    text(ctx, n, x, y, C.grey);
    if (i < names.length - 1) text(ctx, sep, x + widths[i], y, C.faint);
    ctx.restore();
    x += widths[i] + sepW;
  });
}

// ── clip, image, compare ────────────────────────────────────────────────────

function paintClip(ctx: Ctx, video?: HTMLVideoElement) {
  frame(ctx, L.frame, (c) => {
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    const r = containRect(video.videoWidth, video.videoHeight, L.frame);
    c.drawImage(video, r.x, r.y, r.w, r.h);
  });
}

/**
 * Where a still sits in `box`: contain-fit, or cropped to `focus` (with a little room) and kept inside the page's
 * printed area, so the crop shows more of the form rather than its blank margin.
 */
function placement(img: HTMLImageElement, box: Rect, focus?: Rect) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!focus) {
    const r = containRect(iw, ih, box);
    return { s: r.w / iw, ox: r.x, oy: r.y };
  }
  const room = 48;
  const ink = inkBounds(img);
  const s = Math.min(box.w / (focus.w + room * 2), box.h / (focus.h + room * 2));
  const place = (lo: number, hi: number, start: number, boxLen: number, centre: number) => {
    lo = Math.max(0, lo - room);
    hi += room;
    const scaled = (hi - lo) * s;
    if (scaled <= boxLen) return start + (boxLen - scaled) / 2 - lo * s;
    return Math.min(start - lo * s, Math.max(start + boxLen - hi * s, start + boxLen / 2 - centre * s));
  };
  return {
    s,
    ox: place(ink.x, ink.x + ink.w, box.x, box.w, focus.x + focus.w / 2),
    oy: place(ink.y, ink.y + ink.h, box.y, box.h, focus.y + focus.h / 2),
  };
}

function drawMarks(ctx: Ctx, marks: Mark[] | undefined, map: (r: Rect) => Rect) {
  for (const m of marks ?? []) drawMark(ctx, m, map(m.rect));
}

function paintImage(ctx: Ctx, s: Extract<Slide, { kind: "image" }>) {
  const img = image(s.src);
  frame(ctx, L.frame, (c) => {
    if (!img) return;
    const p = placement(img, L.frame, s.focus);
    c.drawImage(img, p.ox, p.oy, img.naturalWidth * p.s, img.naturalHeight * p.s);
    drawMarks(c, s.marks, (r) => ({ x: p.ox + r.x * p.s, y: p.oy + r.y * p.s, w: r.w * p.s, h: r.h * p.s }));
  });
}

const COMPARE = { gap: 48, margin: 28, label: 52, radius: 20 };

/** Two pages side by side, trimmed to the printed area they share, at one scale, labels under. */
function paintCompare(ctx: Ctx, left: Panel, right: Panel) {
  const imgs = [image(left.src), image(right.src)];
  if (!imgs[0] || !imgs[1]) return;
  // One crop for both, so the pages line up row for row and the frames match.
  const bs = imgs.map((img) => inkBounds(img!));
  const m = COMPARE.margin;
  const x = Math.max(0, Math.min(...bs.map((b) => b.x)) - m), y = Math.max(0, Math.min(...bs.map((b) => b.y)) - m);
  const src = {
    x, y,
    w: Math.min(...imgs.map((i) => i!.naturalWidth), Math.max(...bs.map((b) => b.x + b.w)) + m) - x,
    h: Math.min(...imgs.map((i) => i!.naturalHeight), Math.max(...bs.map((b) => b.y + b.h)) + m) - y,
  };
  const colW = (L.frame.w - COMPARE.gap) / 2;
  const s = Math.min(colW / src.w, (L.frame.h - COMPARE.label) / src.h);
  [left, right].forEach((panel, i) => {
    const r = { x: L.frame.x + i * (colW + COMPARE.gap), y: L.frame.y, w: src.w * s, h: src.h * s };
    frame(ctx, r, (c) => {
      c.drawImage(imgs[i]!, src.x, src.y, src.w, src.h, r.x, r.y, r.w, r.h);
      drawMarks(c, panel.marks, (m) => ({ x: r.x + (m.x - src.x) * s, y: r.y + (m.y - src.y) * s, w: m.w * s, h: m.h * s }));
    }, COMPARE.radius);
    font(ctx, 500, 28, -0.01);
    text(ctx, panel.label, r.x, r.y + r.h + COMPARE.label - 8, C.grey);
  });
}

// ── data: count, bars, dots, flow ───────────────────────────────────────────

function formatNumber(v: number, decimals = 0) {
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A block of `height` px, centred in the space under the title (or the whole canvas when untitled). Returns its top. */
const centreTop = (height: number, titled: boolean) => (titled ? L.frame.y + (L.frame.h - height) / 2 - 20 : 516 - height / 2);

function paintCount(ctx: Ctx, s: Extract<Slide, { kind: "count" }>) {
  const size = 280, label = 40, lh = 54, gap = 72;
  font(ctx, 500, label, -0.01);
  const lines = wrap(ctx, s.label, 1120);
  const height = size * CAP + gap + label * CAP + (lines.length - 1) * lh;
  const top = centreTop(height, !!s.title);
  const base = top + size * CAP;
  font(ctx, 600, size, -0.045);
  const value = `${s.prefix ?? ""}${formatNumber(s.value, s.decimals)}${s.suffix ?? ""}`;
  // Optical margin: big figures sit a few pixels right of the text edge, so pull them back.
  const x = L.margin - size * 0.03;
  text(ctx, value, x, base, C.ink);
  if (s.of !== undefined) text(ctx, ` / ${formatNumber(s.of)}`, x + measure(ctx, value), base, C.faint);
  font(ctx, 500, label, -0.01);
  lines.forEach((line, i) => text(ctx, line, L.margin, base + gap + label * CAP + i * lh, C.grey));
}

/** "54" plus a quieter unit: "of 64", "/ 10", "%". */
function splitUnit(value: string, unit?: string): [string, string] {
  if (!unit) return [value, ""];
  return [value, /^[%×x]/.test(unit) ? unit : ` ${unit}`];
}

function paintBars(ctx: Ctx, s: Extract<Slide, { kind: "bars" }>) {
  const decimals = s.bars.some((b) => !Number.isInteger(b.value)) ? 1 : 0;
  const thick = 76, labelSize = 32, valueSize = 56, rowGap = 72, labelGap = 22;
  const row = labelSize * CAP + labelGap + thick;
  const chartH = s.bars.length * row + (s.bars.length - 1) * rowGap;
  const top = L.frame.y + (L.frame.h - chartH) / 2 - (s.note ? 40 : 0);
  font(ctx, 600, valueSize, -0.03);
  const valueRoom = Math.max(...s.bars.map((b) => measure(ctx, formatNumber(b.value, decimals)))) + 200;
  const barMax = L.frame.w - valueRoom;
  s.bars.forEach((b: Bar, i) => {
    const y = top + i * (row + rowGap);
    font(ctx, 500, labelSize, -0.01);
    text(ctx, b.label, L.margin, y + labelSize * CAP, b.highlight ? C.ink : C.grey);
    const barY = y + labelSize * CAP + labelGap;
    const w = Math.max(6, (barMax * Math.min(b.value, s.max)) / s.max);
    ctx.beginPath();
    ctx.roundRect(L.margin, barY, w, thick, 6);
    ctx.fillStyle = b.highlight ? C.blue : C.bar;
    ctx.fill();
    const [v, unit] = splitUnit(formatNumber(b.value, decimals), s.unit);
    const vx = L.margin + w + 28, vy = barY + thick / 2 + (valueSize * CAP) / 2;
    font(ctx, 600, valueSize, -0.03);
    text(ctx, v, vx, vy, b.highlight ? C.blue : C.ink);
    const vw = measure(ctx, v);
    font(ctx, 500, 30, -0.01);
    if (unit) text(ctx, unit, vx + vw + 4, vy, C.grey);
    if (b.note) text(ctx, b.note, vx + vw + 4 + (unit ? measure(ctx, unit) + 20 : 16), vy, C.faint);
  });
  if (s.note) paintNote(ctx, s.note);
}

/** A source line at the foot of the frame, under a hairline. */
function paintNote(ctx: Ctx, note: string) {
  font(ctx, 400, 24, 0);
  const lines = wrap(ctx, note, L.frame.w);
  const last = L.frame.y + L.frame.h - 6;
  const first = last - (lines.length - 1) * 34;
  ctx.fillStyle = C.hairline;
  ctx.fillRect(L.margin, first - 24 - 30, L.frame.w, 1);
  lines.forEach((line, i) => text(ctx, line, L.margin, first + i * 34, C.grey));
}

function gridFor(total: number, w: number, h: number) {
  let best = { cols: total, score: 0 };
  for (let cols = 1; cols <= total; cols++) {
    const rows = Math.ceil(total / cols);
    // Prefer full rows: a ragged last row costs a little.
    const score = Math.min(w / cols, h / rows) * (total % cols === 0 ? 1 : 0.8);
    if (score > best.score) best = { cols, score };
  }
  const rows = Math.ceil(total / best.cols);
  return { cols: best.cols, rows, cell: Math.min(w / best.cols, h / rows, 120) };
}

function paintDots(ctx: Ctx, s: Extract<Slide, { kind: "dots" }>) {
  const legendGap = 96;
  const g = gridFor(s.total, L.frame.w, L.frame.h - 200);
  const d = Math.min(g.cell * 0.4, 40);
  const gh = (g.rows - 1) * g.cell + d;
  const height = gh + legendGap;
  const top = L.frame.y + (L.frame.h - height) / 2 - 10;
  for (let i = 0; i < s.total; i++) {
    ctx.beginPath();
    ctx.arc(L.margin + d / 2 + (i % g.cols) * g.cell, top + d / 2 + Math.floor(i / g.cols) * g.cell, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = i < s.lit ? C.blue : C.bar;
    ctx.fill();
  }
  // Legend, one line: ● lit label, then ● everything else.
  const y = top + gh + legendGap;
  font(ctx, 500, 30, -0.01);
  let x = L.margin;
  const item = (label: string, dot: string, ink: string) => {
    ctx.beginPath();
    ctx.arc(x + 8, y - 11, 8, 0, Math.PI * 2);
    ctx.fillStyle = dot;
    ctx.fill();
    text(ctx, label, x + 28, y, ink);
    x += 28 + measure(ctx, label) + 56;
  };
  if (s.litLabel) item(s.litLabel, C.blue, C.ink);
  item(s.label, C.bar, C.grey);
}

function paintFlow(ctx: Ctx, s: Extract<Slide, { kind: "flow" }>) {
  const active = new Set(s.active ?? []);
  const n = s.steps.length;
  const pitch = L.frame.w / n;
  const colW = pitch - 48;
  const xs = s.steps.map((_, i) => L.margin + i * pitch);
  // One size for every label, the largest that keeps each on one line; wrap only below 40px.
  let labelSize = 52;
  for (; labelSize > 40; labelSize -= 2) {
    font(ctx, 600, labelSize, -0.025);
    if (s.steps.every((st) => measure(ctx, st.label) <= colW)) break;
  }
  const labelLh = labelSize * 1.12, subSize = 31, subLh = subSize * 1.35, dotGap = 88, subGap = 32;
  font(ctx, 600, labelSize, -0.025);
  const labels = s.steps.map((st) => wrap(ctx, st.label, colW));
  font(ctx, 500, subSize, -0.01);
  const subs = s.steps.map((st) => (st.sub ? wrap(ctx, st.sub, colW) : []));
  // Subs share one line under the tallest label, so the columns read across.
  const labelRows = Math.max(...labels.map((l) => l.length));
  const subRows = Math.max(...subs.map((l) => l.length));
  const height = dotGap + labelSize * CAP + (labelRows - 1) * labelLh + (subRows ? subGap + subSize * CAP + (subRows - 1) * subLh : 0);
  const y = L.frame.y + (L.frame.h - height) / 2 - 20;
  const labelBase = y + dotGap + labelSize * CAP;
  const subBase = labelBase + (labelRows - 1) * labelLh + subGap + subSize * CAP;
  ctx.fillStyle = C.bar;
  ctx.fillRect(xs[0], y - 1, xs[n - 1] - xs[0], 2);
  s.steps.forEach((_, i) => {
    const on = active.has(i);
    ctx.beginPath();
    ctx.arc(xs[i] + 11, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = on ? C.blue : C.white;
    ctx.fill();
    if (!on) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.faint;
      ctx.stroke();
    }
    font(ctx, 600, labelSize, -0.025);
    labels[i].forEach((line, k) => text(ctx, line, xs[i], labelBase + k * labelLh, on ? C.ink : C.grey));
    font(ctx, 500, subSize, -0.01);
    subs[i].forEach((line, k) => text(ctx, line, xs[i], subBase + k * subLh, C.grey));
  });
}

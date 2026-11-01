// The stage's scene machine: the slide on screen, the one it is dissolving from, the camera tile, and the rAF loop.
// Slides are stills. The only motion is the dissolve between slides, app clips playing, the camera, and the logo cards.

import type { Deck, Rect, Slide } from "../types";
import { clipUrl, loadFonts } from "./assets";
import { C, L, coverSource, font, frame, text, type Ctx } from "./draw";
import { clamp01, inOutSine, outCubic } from "./ease";
import { hasTitle, paintCard, paintSlide, paintTitle } from "./slides";

export const STAGE_W = 1920, STAGE_H = 1080;

export interface Stage {
  show(group: number, slide: number, opts?: { instant?: boolean }): void;
  /** The camera tile: `src` when it has frames, otherwise `initials` on a soft grey tile. Neither: no tile. */
  setCamera(src: HTMLVideoElement | null, initials?: string): void;
  showCard(card: "intro" | "outro"): void;
  destroy(): void;
}

const T = {
  slide: 450, // dissolve between slides of one group
  group: 700, // dissolve between groups and into or out of a card
  rise: 10, // a changed title lifts this far into place in the second half of the dissolve
  camera: 650,
  cameraOut: 420,
};

type Content =
  | { kind: "slide"; group: number; index: number; slide: Slide }
  | { kind: "card"; card: "intro" | "outro" };

interface Layer {
  content: Content;
  /** Time zero for a card's logo reveal. */
  at: number;
  clip?: Clip;
}

interface Dissolve { from: Layer; start: number; dur: number; titleChanges: boolean }

/** A clip slide's own muted video: parked at `from`, played from there when its slide enters, held on its last frame. */
class Clip {
  readonly el = document.createElement("video");
  private wanted = false;
  private readonly from: number;
  private readonly to?: number;
  private readonly rate: number;

  constructor(slide: Extract<Slide, { kind: "clip" }>) {
    this.from = slide.from ?? 0;
    this.to = slide.to;
    this.rate = slide.rate ?? 1;
    this.el.muted = true;
    this.el.playsInline = true;
    this.el.preload = "auto";
    this.el.addEventListener("loadeddata", () => (this.wanted ? this.start() : this.park()), { once: true });
    void clipUrl(slide.src).then((url) => (this.el.src = url), () => {});
  }

  start() {
    this.wanted = true;
    if (this.el.readyState < 1) return;
    this.el.currentTime = this.from;
    this.el.playbackRate = this.rate;
    void this.el.play().catch(() => {});
  }

  /** Stop where it is: the outgoing frame of a dissolve. */
  freeze() {
    this.wanted = false;
    this.el.pause();
  }

  /** Pause and seek back to `from`, ready for the next entrance. */
  park() {
    this.freeze();
    if (this.el.readyState >= 1 && Math.abs(this.el.currentTime - this.from) > 0.001) this.el.currentTime = this.from;
  }

  tick() {
    if (this.to !== undefined && !this.el.paused && this.el.currentTime >= this.to) this.el.pause();
  }

  dispose() {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }
}

interface Cam { el: HTMLVideoElement | null; initials?: string; at: number; out?: number }

/** A frame to draw, from a camera whose track is still sending (an ended or muted track leaves its last frame behind). */
function hasPicture(v: HTMLVideoElement): boolean {
  if (v.readyState < 2 || !v.videoWidth) return false;
  const src = v.srcObject;
  return !(src instanceof MediaStream) || src.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
}

/** A camera with no picture: the presenter's initials in a white circle on the soft grey tile. */
function paintInitials(c: Ctx, r: Rect, initials: string) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, d = 132;
  c.fillStyle = C.white;
  c.beginPath();
  c.arc(cx, cy, d / 2, 0, Math.PI * 2);
  c.fill();
  font(c, 500, 46, -0.01);
  text(c, initials, cx, cy + 16, C.grey, "center");
}

export function makeStage(canvas: HTMLCanvasElement, deck: Deck, hooks: { beforePaint?: (now: number) => void } = {}): Stage {
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  // The incoming slide is painted here and laid over the outgoing one, so a dissolve is a true cross-dissolve
  // and anything the two slides share (the frame, an unchanged title) holds perfectly still.
  const buffer = document.createElement("canvas");
  buffer.width = STAGE_W;
  buffer.height = STAGE_H;
  const bctx = buffer.getContext("2d", { alpha: false })!;
  let fontsReady = false;
  void loadFonts().then(() => (fontsReady = true));

  const clips = new Map<string, Clip>();
  deck.groups.forEach((g, gi) =>
    g.slides.forEach((s, si) => {
      if (s.kind === "clip") clips.set(`${gi}:${si}`, new Clip(s));
    }),
  );

  let cur: Layer | null = null;
  let dissolve: Dissolve | null = null;
  let cams: Cam[] = [];
  let raf = 0;
  let dead = false;

  const titleOf = (c: Content | undefined) => (c?.kind === "slide" && hasTitle(c.slide) ? c.slide.title : null);

  function enter(content: Content, move: "slide" | "group" | "instant") {
    const now = performance.now();
    if (dissolve) dissolve.from.clip?.park();
    dissolve = null;
    if (cur && move !== "instant") {
      const dur = move === "slide" ? T.slide : T.group;
      dissolve = { from: cur, start: now, dur, titleChanges: titleOf(cur.content) !== titleOf(content) };
      cur.clip?.freeze();
    } else cur?.clip?.park();
    const clip = content.kind === "slide" ? clips.get(`${content.group}:${content.index}`) : undefined;
    clip?.start();
    // A card's reveal waits until the dissolve into it is half done.
    cur = { content, at: now + (dissolve ? dissolve.dur / 2 : 0), clip };
  }

  function paintLayer(c: Ctx, l: Layer, now: number, withTitle = true) {
    const content = l.content;
    if (content.kind === "card") return paintCard(c, content.card, now - l.at, deck.team);
    l.clip?.tick();
    const title = titleOf(content);
    if (title && withTitle) paintTitle(c, title);
    paintSlide(c, content.slide, { video: l.clip?.el });
  }

  /** A changed title never double-exposes: the old one fades out over the first half, the new one rises in over the second. */
  function paintTitles(d: Dissolve, p: number) {
    const out = titleOf(d.from.content), inn = cur && titleOf(cur.content);
    if (out && p < 0.5) {
      ctx.globalAlpha = 1 - inOutSine(p * 2);
      paintTitle(ctx, out);
    }
    if (inn && p > 0.5) {
      const q = outCubic((p - 0.5) * 2);
      ctx.globalAlpha = q;
      paintTitle(ctx, inn, T.rise * (1 - q));
    }
    ctx.globalAlpha = 1;
  }

  function paintCamera(now: number) {
    const live = cams.filter((c, i) => {
      const newer = cams[i + 1];
      if (newer && now - newer.at >= T.camera) return false;
      return !(c.out !== undefined && !newer && now - c.out >= T.cameraOut);
    });
    cams = live;
    if (!cams.length) return;
    const alphas = cams.map((c, i) => {
      const inP = c.at === -Infinity ? 1 : inOutSine(clamp01((now - c.at) / T.camera));
      const outP = c.out !== undefined && !cams[i + 1] ? 1 - inOutSine(clamp01((now - c.out) / T.cameraOut)) : 1;
      return inP * outP;
    });
    const tile = Math.max(...alphas);
    if (tile <= 0) return;
    const r = L.camera;
    ctx.save();
    ctx.globalAlpha = tile;
    frame(ctx, r, (c) => {
      c.fillStyle = C.camera;
      c.fillRect(r.x, r.y, r.w, r.h);
      cams.forEach((cam, i) => {
        const v = cam.el;
        const live = !!v && hasPicture(v);
        if (!live && !cam.initials) return;
        c.save();
        c.globalAlpha = alphas[i] / tile;
        if (live) {
          const s = coverSource(v.videoWidth, v.videoHeight, r.w, r.h, 0.5, 0.42, 1.12);
          c.drawImage(v, s.x, s.y, s.w, s.h, r.x, r.y, r.w, r.h);
        } else paintInitials(c, r, cam.initials!);
        c.restore();
      });
    });
    ctx.restore();
  }

  function paint(now: number) {
    if (dead) return;
    hooks.beforePaint?.(now);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.white;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    if (dissolve && now - dissolve.start >= dissolve.dur) {
      dissolve.from.clip?.park();
      dissolve = null;
    }
    if (fontsReady && cur) {
      if (dissolve) {
        const p = clamp01((now - dissolve.start) / dissolve.dur);
        const keep = !dissolve.titleChanges;
        paintLayer(ctx, dissolve.from, now, keep);
        bctx.globalAlpha = 1;
        bctx.fillStyle = C.white;
        bctx.fillRect(0, 0, STAGE_W, STAGE_H);
        paintLayer(bctx, cur, now, keep);
        ctx.globalAlpha = inOutSine(p);
        ctx.drawImage(buffer, 0, 0);
        ctx.globalAlpha = 1;
        if (!keep) paintTitles(dissolve, p);
      } else paintLayer(ctx, cur, now);
    }
    paintCamera(now);
    raf = requestAnimationFrame(paint);
  }
  raf = requestAnimationFrame(paint);

  return {
    show(group, index, opts) {
      const slide = deck.groups[group]?.slides[index];
      if (!slide) return;
      const sameGroup = cur?.content.kind === "slide" && cur.content.group === group;
      enter({ kind: "slide", group, index, slide }, opts?.instant ? "instant" : sameGroup ? "slide" : "group");
    },
    showCard(which) {
      enter({ kind: "card", card: which }, "group");
    },
    setCamera(el, initials) {
      const now = performance.now();
      const top = cams[cams.length - 1];
      if (top && top.el === el && top.initials === initials && top.out === undefined) return;
      for (const c of cams) c.out ??= now;
      if (el || initials) cams.push({ el, initials, at: cams.length || cur ? now : -Infinity });
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      for (const c of clips.values()) c.dispose();
      cams = [];
    },
  };
}

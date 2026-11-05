export interface FrameSize { width: number; height: number }
export const LANDSCAPE: FrameSize = { width: 1920, height: 1080 };
const EDGE = 1920;

export const validFormat = (f: FrameSize) => Number.isFinite(f.width) && Number.isFinite(f.height)
  && f.width > 0 && f.height > 0 && Math.max(f.width / f.height, f.height / f.width) <= EDGE / 2;

/** Even encoding dimensions, keeping simple document ratios exact and the longest edge at most 1920px. */
export function frameSize(deck: { format?: FrameSize }): FrameSize {
  const f = deck.format;
  if (!f || !validFormat(f)) return LANDSCAPE;
  if (Number.isSafeInteger(f.width) && Number.isSafeInteger(f.height)) {
    let a = f.width, b = f.height;
    while (b) [a, b] = [b, a % b];
    const w = f.width / a, h = f.height / a;
    const scale = Math.floor(EDGE / Math.max(w, h) / 2) * 2;
    if (scale >= 2) return { width: w * scale, height: h * scale };
  }
  const ratio = f.width / f.height;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1 ? { width: EDGE, height: even(EDGE / ratio) } : { width: even(EDGE * ratio), height: EDGE };
}

export const frameRatio = (deck: { format?: FrameSize }) => {
  const f = frameSize(deck);
  return f.width / f.height;
};

/** Small canvases stay bounded even for very tall or wide source pages. */
export function thumbSize(deck: { format?: FrameSize }, edge = 256): FrameSize {
  const { width, height } = frameSize(deck);
  const scale = edge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

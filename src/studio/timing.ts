import { type Deck, type Group, WORDS_PER_MINUTE } from "./types";

/** Logo intro and outro around the recorded groups, in ms. */
export const INTRO_MS = 4200;
export const OUTRO_MS = 4000;

/** Spoken words only: reading cues (emoji) are not words. */
export function words(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** A ⏸️ in a script is a half-second beat; each "..." is a shorter one between stressed words. */
export const BEAT_MS = 500;
export const ELLIPSIS_MS = 300;
/** A slide with nothing to say still stays on screen this long. */
export const EMPTY_SEGMENT_MS = 4000;

/** How long one script segment takes at the studio pace, in ms. */
export function segmentMs(text: string): number {
  const spoken = words(text);
  const beats = text.match(/⏸/g)?.length ?? 0;
  const dots = text.match(/\.\.\./g)?.length ?? 0;
  const ms = Math.round((spoken / WORDS_PER_MINUTE) * 60_000) + beats * BEAT_MS + dots * ELLIPSIS_MS;
  return spoken ? ms : Math.max(EMPTY_SEGMENT_MS, ms);
}

/** A group's recording length: its own `seconds` when set, else its words at 120 wpm plus a one-second breath. */
export function targetMs(group: Group): number {
  if (typeof group.seconds === "number" && Number.isFinite(group.seconds) && group.seconds > 0) return Math.round(group.seconds * 1000);
  const n = Math.max(group.slides.length, group.script.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += segmentMs(group.script[i] ?? "");
  return sum + 1000;
}

export function deckMs(deck: Deck): number {
  return INTRO_MS + OUTRO_MS + deck.groups.reduce((sum, g) => sum + targetMs(g), 0);
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

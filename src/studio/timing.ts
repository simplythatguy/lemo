/** Logo intro and outro around the recorded groups, in ms. */
export const INTRO_MS = 4200;
export const OUTRO_MS = 4000;

export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Easing for the only things that move: slide transitions, the camera tile and the logo cards.

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Progress of an animation that starts at `delay` ms and lasts `dur` ms, at elapsed time `t`. */
export const span = (t: number, delay: number, dur: number) => clamp01((t - delay) / dur);

export const outCubic = (x: number) => 1 - (1 - x) ** 3;
export const outQuint = (x: number) => 1 - (1 - x) ** 5;
export const inOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

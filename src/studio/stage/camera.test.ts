import assert from "node:assert/strict";
import { test } from "node:test";
import { boxAt, cameraAt, deckBox, GLIDE_MS, glideBox, glides, isSpot, mixBox, moveCamera, PLACES, shapeBox, SHAPES, SPOTS, spotBox } from "./camera.ts";

const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const STAGE = { x: 48, y: 48, w: 1920 - 96, h: 1080 - 96 };

test("every spot sits inside the stage's inset", () => {
  assert.equal(SPOTS.length, 30);
  for (const s of SPOTS) assert.ok(inside(spotBox(s), STAGE), s);
});

test("at every place the upright tile sits inside the wide one, and the sizes scale both", () => {
  for (const p of PLACES) {
    for (const z of ["s", "m", "l"] as const) {
      const h = spotBox(`${p}-h-${z}`), v = spotBox(`${p}-v-${z}`);
      assert.ok(inside(v, h) && v.h === h.h && h.w > h.h && v.h > v.w, `${p} ${z}`);
    }
    for (const k of SHAPES) assert.ok(inside(spotBox(`${p}-${k}-s`), spotBox(`${p}-${k}-m`)) && inside(spotBox(`${p}-${k}-m`), spotBox(`${p}-${k}-l`)), `${p} ${k}`);
  }
});

test("the five wide rectangles never overlap", () => {
  const ls = PLACES.map((p) => spotBox(`${p}-h-l`));
  for (const [i, a] of ls.entries()) {
    for (const b of ls.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
});

test("a take's camera is at its latest spot, and a take from before spots sits where the deck said", () => {
  const cues = [{ slide: 0, atMs: 0, spot: "br-v-m" as const }, { slide: 1, atMs: 900 }, { slide: 1, atMs: 2000, spot: "c-h-l" as const }];
  assert.deepEqual(boxAt(cues, 1500, {}), spotBox("br-v-m"));
  assert.deepEqual(boxAt(cues, 2000, {}), spotBox("c-h-l"));
  const placed = { camera: { x: 100, y: 100, w: 300, h: 300 } };
  assert.deepEqual(boxAt([{ slide: 0, atMs: 0 }], 500, placed), deckBox(placed));
  assert.deepEqual(deckBox({}), { x: 1920 - 48 - 344, y: 1080 - 48 - 430, w: 344, h: 430, r: 28 });
});

test("a broken old placement is kept on the stage", () => {
  const off = deckBox({ camera: { x: 1900, y: -50, w: 5000, h: 10 } });
  assert.ok(inside(off, { x: 0, y: 0, w: 1920, h: 1080 }) && off.w === 1920 && off.h === 120);
});

test("only the thirty spots are spots", () => {
  assert.ok(isSpot("tl-v-s") && isSpot("c-h-l"));
  assert.ok(!isSpot("tl-s") && !isSpot("c-x-l") && !isSpot(null));
});

test("a glide runs from one size to the other", () => {
  const a = spotBox("br-v-s"), b = spotBox("br-h-l");
  assert.deepEqual(mixBox(a, b, 0), a);
  assert.deepEqual(mixBox(a, b, 1), b);
});

test("a new size or shape in the same place glides; a new place, or an old take's placement, cuts", () => {
  assert.ok(glides(spotBox("br-v-m"), spotBox("br-v-l")));
  assert.ok(glides(spotBox("br-v-m"), spotBox("br-h-m")));
  assert.ok(!glides(spotBox("br-v-m"), spotBox("tl-v-m")));
  assert.ok(!glides(deckBox({}), spotBox("br-v-m")));
});

test("camera geometry has one clamped 420ms cubic glide", () => {
  const from = spotBox("br-v-s"), to = spotBox("br-h-l");
  assert.equal(GLIDE_MS, 420);
  assert.deepEqual(glideBox(from, to, -20), from);
  assert.deepEqual(glideBox(from, to, 210), mixBox(from, to, 0.875));
  assert.deepEqual(glideBox(from, to, 420), to);
  assert.deepEqual(glideBox(from, to, 10_000), to);
});

test("rapid reversals and shape changes start at the actual in-flight box", () => {
  for (const p of PLACES) {
    const start = spotBox(`${p}-v-l`);
    let motion = { from: start, to: start, at: -Infinity };
    let now = 1000;
    for (const spot of [`${p}-v-s`, `${p}-h-m`, `${p}-v-l`, `${p}-h-s`] as const) {
      const before = cameraAt(motion, now);
      const next = spotBox(spot);
      motion = moveCamera(motion, next, now);
      assert.deepEqual(cameraAt(motion, now), before, `${spot} must not jump`);
      assert.deepEqual(cameraAt(motion, now + GLIDE_MS), next, `${spot} must finish exactly`);
      now += 55;
    }
  }
});

test("place changes cut mid-glide; instant placement also settles an unchanged destination", () => {
  const start = spotBox("br-v-l"), small = spotBox("br-v-s"), other = spotBox("tl-h-m");
  const moving = moveCamera({ from: start, to: start, at: -Infinity }, small, 500);
  const cut = moveCamera(moving, other, 555);
  assert.deepEqual(cameraAt(cut, 555), other);
  assert.deepEqual(cameraAt(cut, 700), other);
  assert.equal(moveCamera(moving, small, 555), moving, "duplicate targets must not restart the clock");
  const instant = moveCamera(moving, small, 555, true);
  assert.deepEqual(cameraAt(instant, 555), small, "reduced motion and seeking must settle immediately");
});

test("the alternate picker shape stays anchored to every sampled camera height", () => {
  for (const p of PLACES) for (let ms = 0; ms <= GLIDE_MS; ms += 7) {
    const box = glideBox(spotBox(`${p}-h-l`), spotBox(`${p}-h-s`), ms);
    const wide = shapeBox(p, "h", box.h), upright = shapeBox(p, "v", box.h);
    assert.equal(upright.h, wide.h);
    assert.ok(inside(upright, wide), `${p} at ${ms}ms`);
  }
});

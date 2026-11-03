import assert from "node:assert/strict";
import { test } from "node:test";
import { boxAt, deckBox, glides, isSpot, mixBox, PLACES, SHAPES, SPOTS, spotBox } from "./camera.ts";

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

import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMERA, cameraOf, moveCamera, resizeCamera } from "./camera.ts";

const inStage = (r: { x: number; y: number; w: number; h: number }) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 1080;

test("a deck without a placement, or with a broken one, gets the default", () => {
  assert.deepEqual(cameraOf({}), CAMERA);
  assert.deepEqual(cameraOf({ camera: { x: NaN, y: 0, w: 300, h: 300 } }), CAMERA);
  const off = cameraOf({ camera: { x: 1900, y: -50, w: 5000, h: 10 } });
  assert.ok(inStage(off) && off.w === 1920 && off.h === 120);
});

test("moving stays on the stage and snaps to the default inset", () => {
  assert.deepEqual(moveCamera(CAMERA, -10_000, -10_000), { ...CAMERA, x: 0, y: 0 });
  assert.deepEqual(moveCamera(CAMERA, -(CAMERA.x - 48) - 5, 0), { ...CAMERA, x: 48 });
  assert.deepEqual(moveCamera(CAMERA, 7, -9), CAMERA);
  assert.deepEqual(moveCamera(CAMERA, -300, 0), { ...CAMERA, x: CAMERA.x - 300 });
});

test("a corner keeps the shape and holds the opposite corner still", () => {
  const r = resizeCamera(CAMERA, { x: -1, y: -1 }, -172, 0);
  assert.equal(r.w, CAMERA.w * 1.5);
  assert.equal(r.h, CAMERA.h * 1.5);
  assert.equal(r.x + r.w, CAMERA.x + CAMERA.w);
  assert.equal(r.y + r.h, CAMERA.y + CAMERA.h);
});

test("a corner stops at the stage edge and at the smallest size, keeping the shape", () => {
  const big = resizeCamera(CAMERA, { x: -1, y: -1 }, -10_000, -10_000);
  assert.ok(inStage(big));
  assert.equal(big.y, 0);
  assert.ok(Math.abs(big.w / big.h - CAMERA.w / CAMERA.h) < 1e-9);
  const small = resizeCamera(CAMERA, { x: 1, y: 1 }, -10_000, 0);
  assert.equal(Math.min(small.w, small.h), 120);
  assert.equal(small.x, CAMERA.x);
  assert.equal(small.y, CAMERA.y);
});

test("an edge stretches one side only", () => {
  const r = resizeCamera(CAMERA, { x: 0, y: -1 }, 500, -100);
  assert.deepEqual(r, { ...CAMERA, y: CAMERA.y - 100, h: CAMERA.h + 100 });
  const wide = resizeCamera(CAMERA, { x: 1, y: 0 }, 10_000, 0);
  assert.equal(wide.x + wide.w, 1920);
  assert.equal(wide.h, CAMERA.h);
});

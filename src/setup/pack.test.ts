import assert from "node:assert/strict";
import { test } from "node:test";
import { pack, type Place } from "./pack.ts";

const m = { width: 1000, cols: 5, tight: 12, apart: 32 };
const rows = (ps: Place[]) => ps.reduce<number[]>((n, p) => ((n[p.row] = (n[p.row] ?? 0) + 1), n), []);
const right = (ps: Place[], r: number) => Math.max(...ps.filter((p) => p.row === r).map((p) => p.x + p.w));

test("groups that fit share a row, each slide of a group closer to the next than groups are", () => {
  const ps = pack([2, 3, 3], m);
  assert.deepEqual(rows(ps), [5, 3]);
  assert.equal(ps[0].after, 12);
  assert.equal(ps[1].after, 32);
  assert.equal(ps[2].before, 32);
  assert.equal(ps[2].x - (ps[1].x + ps[1].w), 32);
  assert.deepEqual(ps.map((p) => p.head), [true, false, true, false, false, true, false, false]);
});

test("a full row spans the grid; a shorter row keeps the slide size above it", () => {
  const ps = pack([2, 3, 3], m);
  assert.ok(Math.abs(right(ps, 0) - 1000) < 1e-9);
  assert.equal(ps[5].w, ps[0].w);
  assert.ok(right(ps, 1) < 1000);
});

test("a group moves to the next row rather than leave one slot of it at a row's end", () => {
  assert.deepEqual(rows(pack([4, 2], m)), [4, 2]);
  assert.deepEqual(rows(pack([1, 7], { ...m, cols: 2 })), [1, 2, 2, 2, 1]);
});

test("a group longer than a row carries on, named again where each row starts", () => {
  const ps = pack([2, 8, 2], m);
  assert.deepEqual(rows(ps), [5, 5, 2]);
  assert.equal(ps[5].head, true);
  assert.equal(ps[5].x, 0);
  assert.ok(ps.slice(5, 10).every((p) => p.row === 1));
  assert.ok(Math.abs(right(ps, 1) - 1000) < 1e-9);
});

test("slides on their own fill even columns", () => {
  const ps = pack([1, 1, 1, 1, 1, 1, 1], m);
  assert.deepEqual(rows(ps), [5, 2]);
  assert.deepEqual(ps.slice(5).map((p) => p.x), ps.slice(0, 2).map((p) => p.x));
});

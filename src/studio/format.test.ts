import assert from "node:assert/strict";
import { test } from "node:test";
import { frameSize, thumbSize, validFormat } from "./format.ts";
import { boxAt, SPOTS, spotBox } from "./stage/camera.ts";
import { limitOf, liveElapsed } from "./types.ts";

test("legacy landscape and native Letter, square and 4:3 videos keep their aspect ratios", () => {
  assert.deepEqual(frameSize({}), { width: 1920, height: 1080 });
  assert.deepEqual(frameSize({ format: { width: 612, height: 792 } }), { width: 1462, height: 1892 });
  for (const format of [{ width: 4, height: 3 }, { width: 1, height: 1 }, { width: 9, height: 16 }, { width: 792, height: 612 }]) {
    const result = frameSize({ format });
    assert.equal(result.width / result.height, format.width / format.height);
  }
});

test("fractional and extreme but valid page sizes produce bounded even canvases and bounded thumbnails", () => {
  for (const format of [{ width: 595.28, height: 841.89 }, { width: 960, height: 1 }, { width: 1, height: 960 }, { width: 1e-308, height: 1e-308 }, { width: 1e308, height: 1e308 }]) {
    assert.ok(validFormat(format));
    const result = frameSize({ format });
    assert.ok(result.width >= 2 && result.height >= 2 && Math.max(result.width, result.height) <= 1920);
    assert.equal(result.width % 2, 0); assert.equal(result.height % 2, 0);
    const thumb = thumbSize({ format });
    assert.ok(thumb.width >= 1 && thumb.height >= 1 && Math.max(thumb.width, thumb.height) <= 256);
  }
  for (const format of [{ width: 0, height: 1 }, { width: Infinity, height: 1 }, { width: 1, height: -1 }]) assert.equal(validFormat(format), false);
});

test("every camera place, shape and size remains inside document-shaped videos and replays its original cue", () => {
  for (const format of [{ width: 612, height: 792 }, { width: 4, height: 3 }, { width: 1, height: 1 }, { width: 16, height: 9 }]) {
    const frame = frameSize({ format });
    for (const spot of SPOTS) {
      const box = spotBox(spot, { format });
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= frame.width && box.y + box.h <= frame.height, spot);
      assert.deepEqual(boxAt([{ slide: 0, atMs: 0, spot }], 1000, { format }), box);
    }
  }
});

test("scripts never create a time limit; an explicitly entered limit and actual live duration are retained", () => {
  assert.equal(limitOf({}), null);
  assert.equal(limitOf({ limitMs: null }), null);
  assert.equal(limitOf({ limitMs: 123_000 }), 123_000);
  assert.equal(liveElapsed({ presenterId: "p", groupId: "g", slide: 0, recording: true, targetMs: 0, remainingMs: 0, elapsedMs: 12_345, at: 0, seen: 1000 }, 1500), 12_845);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDraft, fromDeck, isCut, moveSlide, order, removeSlide, replaceSlides, toDeck, toggleCut } from "./draft.ts";

const pics = (n: number) => Array.from({ length: n }, (_, i) => ({ src: `blob:${i}` }));
const sizes = (d: ReturnType<typeof emptyDraft>) => d.groups.map((g) => g.slides.length);

test("new slides are cut every 3", () => {
  const d = replaceSlides(emptyDraft(), pics(7));
  assert.deepEqual(sizes(d), [3, 3, 1]);
  assert.ok(isCut(d, 2) && !isCut(d, 1) && !isCut(d, 6));
  for (const g of d.groups) assert.match(g.id, /^[a-z0-9-]{1,40}$/);
});

test("splitting keeps the id on the first half; joining keeps the id with a take", () => {
  let d = replaceSlides(emptyDraft(), pics(6));
  const [a, b] = d.groups.map((g) => g.id);
  d = toggleCut(d, 0);
  assert.deepEqual(sizes(d), [1, 2, 3]);
  assert.equal(d.groups[0].id, a);
  d = toggleCut(d, 0);
  assert.deepEqual(sizes(d), [3, 3]);
  assert.equal(d.groups[0].id, a);
  d = toggleCut(d, 2, new Set([b]));
  assert.deepEqual(sizes(d), [6]);
  assert.equal(d.groups[0].id, b);
});

test("moving and removing slides keeps scripts and drops empty groups", () => {
  let d = replaceSlides(emptyDraft(), pics(4));
  const ids = order(d);
  d = { ...d, script: { [ids[0]]: "hello" } };
  d = moveSlide(d, 0, 3);
  assert.deepEqual(order(d), [ids[1], ids[2], ids[3], ids[0]]);
  assert.deepEqual(sizes(d), [3, 1]);
  d = removeSlide(d, ids[3]);
  d = removeSlide(d, ids[0]);
  assert.deepEqual(sizes(d), [2]);
  assert.equal(toDeck(d).groups[0].name, "Slides 1–2");
});

test("a replaced file keeps scripts and group ids by position", () => {
  let d = replaceSlides(emptyDraft(), pics(3));
  const first = order(d)[0];
  const id = d.groups[0].id;
  d = { ...d, script: { [first]: "intro" } };
  d = replaceSlides(d, pics(5));
  assert.equal(d.groups[0].id, id);
  assert.equal(d.script[order(d)[0]], "intro");
  assert.deepEqual(sizes(d), [3, 2]);
});

test("a stored deck round-trips with its ids", () => {
  const d0 = replaceSlides({ ...emptyDraft(), title: "T", team: ["Ana", " ", "Bo"] }, pics(4));
  const deck = toDeck(d0);
  assert.deepEqual(deck.team, ["Ana", "Bo"]);
  assert.ok(deck.groups.every((g) => g.speaker === 0 && g.script.length === g.slides.length));
  const d1 = fromDeck(deck);
  assert.deepEqual(toDeck(d1), deck);
});

test("editing a deck keeps where the room put the camera", () => {
  const deck = { ...toDeck(replaceSlides({ ...emptyDraft(), title: "T", team: ["Ana"] }, pics(2))), camera: { x: 48, y: 48, w: 300, h: 300 } };
  assert.deepEqual(toDeck(fromDeck(deck)).camera, deck.camera);
});

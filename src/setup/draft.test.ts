import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDraft, fromDeck, groupSlides, moveSlide, order, removeSlide, renewChangedGroups, replaceSlides, toDeck, ungroupSlides } from "./draft.ts";

const pics = (n: number) => Array.from({ length: n }, (_, i) => ({ src: `blob:${i}` }));
const sizes = (d: ReturnType<typeof emptyDraft>) => d.groups.map((g) => g.slides.length);

test("every new slide is its own group", () => {
  const d = replaceSlides(emptyDraft(), pics(4));
  assert.deepEqual(sizes(d), [1, 1, 1, 1]);
  assert.equal(new Set(d.groups.map((g) => g.id)).size, 4);
  for (const g of d.groups) assert.match(g.id, /^[a-z0-9-]{1,40}$/);
});

test("grouping puts the chosen slides together where the first one is", () => {
  let d = replaceSlides(emptyDraft(), pics(5));
  const [a, b, c, e, f] = order(d);
  const ids = d.groups.map((g) => g.id);
  d = groupSlides(d, [e, b], new Set([ids[3]]));
  assert.deepEqual(order(d), [a, b, e, c, f]);
  assert.deepEqual(sizes(d), [1, 2, 1, 1]);
  assert.equal(d.groups[1].id, ids[3], "the swallowed group with a take lends its id");
  assert.equal(groupSlides(d, [a]), d, "one slide is not a group");
});

test("grouping part of a group leaves the rest with its id", () => {
  let d = replaceSlides(emptyDraft(), pics(4));
  const [a, b, c, e] = order(d);
  d = groupSlides(d, [a, b, c]);
  const g = d.groups[0].id;
  d = groupSlides(d, [b, e]);
  assert.deepEqual(d.groups.map((x) => x.slides), [[a], [b, e], [c]]);
  assert.equal(d.groups[0].id, g);
  assert.notEqual(d.groups[2].id, g);
});

test("ungrouping splits the whole group back into single slides", () => {
  let d = replaceSlides(emptyDraft(), pics(4));
  const [a, b, c] = order(d);
  d = groupSlides(d, [a, b, c]);
  const g = d.groups[0].id;
  d = ungroupSlides(d, [b]);
  assert.deepEqual(sizes(d), [1, 1, 1, 1]);
  assert.equal(d.groups[0].id, g);
  assert.equal(new Set(d.groups.map((x) => x.id)).size, 4);
});

test("a moved slide stays in its group, joins the group it lands in, or stands alone", () => {
  let d = replaceSlides(emptyDraft(), pics(5));
  const [a, b, c, e, f] = order(d);
  d = groupSlides(d, [b, c, e]);
  const lone = d.groups[2].id;
  d = moveSlide(d, 0, 2);
  assert.deepEqual(d.groups.map((x) => x.slides), [[b, c, a, e], [f]], "dropped inside a group, it joins");
  d = moveSlide(d, 0, 3);
  assert.deepEqual(d.groups.map((x) => x.slides), [[c, a, e, b], [f]], "next to its own group's slides, it stays");
  d = moveSlide(d, 4, 0);
  assert.deepEqual(d.groups.map((x) => x.slides), [[f], [c, a, e, b]]);
  assert.equal(d.groups[0].id, lone, "a slide on its own moves with its group id");
  d = moveSlide(d, 2, 0);
  assert.deepEqual(d.groups.map((x) => x.slides), [[a], [f], [c, e, b]], "away from its group, it stands alone");
});

test("removing slides keeps scripts and drops empty groups", () => {
  let d = replaceSlides(emptyDraft(), pics(4));
  const ids = order(d);
  d = groupSlides({ ...d, script: { [ids[1]]: "hello" } }, ids.slice(0, 3));
  d = removeSlide(d, ids[3]);
  d = removeSlide(d, ids[0]);
  assert.deepEqual(sizes(d), [2]);
  assert.equal(toDeck(d).groups[0].name, "Slides 1–2");
  assert.deepEqual(toDeck(d).groups[0].script, ["hello", ""]);
});

test("a replaced file keeps scripts and group ids by position", () => {
  let d = replaceSlides(emptyDraft(), pics(3));
  const first = order(d)[0];
  const id = d.groups[0].id;
  d = { ...d, script: { [first]: "intro" } };
  d = replaceSlides(d, pics(5));
  assert.equal(d.groups[0].id, id);
  assert.equal(d.script[order(d)[0]], "intro");
  assert.deepEqual(sizes(d), [1, 1, 1, 1, 1]);
});

test("a replaced file with the same count keeps the groups", () => {
  let d = replaceSlides(emptyDraft(), pics(3));
  d = groupSlides(d, order(d).slice(0, 2));
  assert.deepEqual(sizes(replaceSlides(d, pics(3))), [2, 1]);
});

test("a stored deck round-trips with its ids", () => {
  const d0 = replaceSlides({ ...emptyDraft(), title: "T", team: ["Ana", " ", "Bo"] }, pics(4));
  const deck = toDeck(groupSlides(d0, order(d0).slice(1, 3)));
  assert.deepEqual(deck.team, ["Ana", "Bo"]);
  assert.ok(deck.groups.every((g) => g.speaker === 0 && g.script.length === g.slides.length));
  const d1 = fromDeck(deck);
  assert.deepEqual(toDeck(d1), deck);
  assert.deepEqual(sizes(d1), [1, 2, 1]);
});

test("editing a deck keeps where the room put the camera", () => {
  const deck = { ...toDeck(replaceSlides({ ...emptyDraft(), title: "T", team: ["Ana"] }, pics(2))), camera: { x: 48, y: 48, w: 300, h: 300 } };
  assert.deepEqual(toDeck(fromDeck(deck)).camera, deck.camera);
});

test("a group keeps its id, and so its take, only while its recorded slides still open it", () => {
  let before = replaceSlides(emptyDraft(), pics(4));
  const [a, b, c, e] = order(before);
  before = groupSlides(before, [a, b]);
  const ids = before.groups.map((g) => g.id);
  const kept = (d: typeof before) => d.groups.map((g) => ids.includes(g.id) ? ids.indexOf(g.id) : null);

  assert.deepEqual(kept(renewChangedGroups(moveSlide(before, 3, 0), before)), [2, 0, 1], "moved whole groups keep their takes");
  assert.deepEqual(kept(renewChangedGroups(groupSlides(before, [c, e]), before)), [0, 1], "a slide added after the recorded one keeps it");
  assert.deepEqual(kept(renewChangedGroups(ungroupSlides(before, [a]), before)), [null, null, 1, 2], "ungrouping drops the take");
  assert.deepEqual(kept(renewChangedGroups(removeSlide(before, a), before)), [null, 1, 2], "a slide gone from the group drops it");
  assert.deepEqual(kept(renewChangedGroups(groupSlides(before, [b, c], new Set([ids[1]])), before)), [null, null, 2], "a recorded slide that is no longer first drops it");
  assert.deepEqual(kept(renewChangedGroups(replaceSlides(before, pics(4)), before)), [0, 1, 2], "new slides in the same layout keep every take");
  assert.deepEqual(kept(renewChangedGroups(replaceSlides(before, pics(5)), before)), [null, null, null, null, null], "a different count moves every slide, so no take fits");
  const same = renewChangedGroups(before, before);
  assert.equal(same, before);
});

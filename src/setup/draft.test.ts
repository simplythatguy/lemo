import assert from "node:assert/strict";
import { test } from "node:test";
import type { Deck } from "../studio/types.ts";
import { carriedSpeakers } from "../studio/groups.ts";
import { emptyDraft, fromDeck, groupSlides, lostTakes, moveSlide, order, recordingMode, regroup, removeSlide, renewChangedGroups, replaceSlides, toDeck, ungroupSlides } from "./draft.ts";

const pics = (n: number) => Array.from({ length: n }, (_, i) => ({ src: `blob:${i}` }));
const partsDraft = () => ({ ...emptyDraft(), recording: "groups" as const });
const sizes = (d: ReturnType<typeof emptyDraft>) => d.groups.map((g) => g.slides.length);

test("new uploads are one continuous take with all pages in order", () => {
  const draft = replaceSlides(emptyDraft(), pics(109));
  assert.deepEqual(sizes(draft), [109]);
  assert.equal(toDeck(draft).recording, "continuous");
  assert.equal(toDeck(draft).limitMs, undefined);
});

test("switching to one take never reuses a partial recording; script, format and camera survive", () => {
  const before = { ...roomDeck, format: { width: 612, height: 792 } };
  const after = toDeck(recordingMode(fromDeck(before), "continuous"));
  assert.deepEqual(after.groups.flatMap((g) => g.slides), before.groups.flatMap((g) => g.slides));
  assert.deepEqual(after.groups[0].script, before.groups.flatMap((g) => g.script));
  assert.deepEqual(after.format, before.format);
  assert.deepEqual(after.camera, before.camera);
  assert.equal(before.groups.some((g) => g.id === after.groups[0].id), false);
  assert.deepEqual(lostTakes(before, after, new Set(["intro", "demo"])).map((g) => g.id), ["intro", "demo"]);
  const parts = toDeck(recordingMode(fromDeck(after), "groups"));
  assert.deepEqual(parts.groups.map((g) => g.slides.length), [1, 1, 1, 1]);
  assert.equal(parts.groups.some((g) => g.id === after.groups[0].id), false);
});

test("splitting a continuous take explicitly returns to recording in parts", () => {
  const draft = replaceSlides(emptyDraft(), pics(4));
  const deck = toDeck(draft);
  const next = regroup(deck, { kind: "split", slide: order(draft)[2] }, new Set());
  assert.equal(next.recording, "groups");
  assert.deepEqual(next.groups.map((g) => g.slides.length), [2, 2]);
});

test("every new slide is its own group", () => {
  const d = replaceSlides(partsDraft(), pics(4));
  assert.deepEqual(sizes(d), [1, 1, 1, 1]);
  assert.equal(new Set(d.groups.map((g) => g.id)).size, 4);
  for (const g of d.groups) assert.match(g.id, /^[a-z0-9-]{1,40}$/);
});

test("grouping puts the chosen slides together where the first one is", () => {
  let d = replaceSlides(partsDraft(), pics(5));
  const [a, b, c, e, f] = order(d);
  const ids = d.groups.map((g) => g.id);
  d = groupSlides(d, [e, b], new Set([ids[3]]));
  assert.deepEqual(order(d), [a, b, e, c, f]);
  assert.deepEqual(sizes(d), [1, 2, 1, 1]);
  assert.equal(d.groups[1].id, ids[3], "the swallowed group with a take lends its id");
  assert.equal(groupSlides(d, [a]), d, "one slide is not a group");
});

test("grouping part of a group leaves the rest with its id", () => {
  let d = replaceSlides(partsDraft(), pics(4));
  const [a, b, c, e] = order(d);
  d = groupSlides(d, [a, b, c]);
  const g = d.groups[0].id;
  d = groupSlides(d, [b, e]);
  assert.deepEqual(d.groups.map((x) => x.slides), [[a], [b, e], [c]]);
  assert.equal(d.groups[0].id, g);
  assert.notEqual(d.groups[2].id, g);
});

test("ungrouping splits the whole group back into single slides", () => {
  let d = replaceSlides(partsDraft(), pics(4));
  const [a, b, c] = order(d);
  d = groupSlides(d, [a, b, c]);
  const g = d.groups[0].id;
  d = ungroupSlides(d, [b]);
  assert.deepEqual(sizes(d), [1, 1, 1, 1]);
  assert.equal(d.groups[0].id, g);
  assert.equal(new Set(d.groups.map((x) => x.id)).size, 4);
});

test("a moved slide stays in its group, joins the group it lands in, or stands alone", () => {
  let d = replaceSlides(partsDraft(), pics(5));
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
  let d = replaceSlides(partsDraft(), pics(4));
  const ids = order(d);
  d = groupSlides({ ...d, script: { [ids[1]]: "hello" } }, ids.slice(0, 3));
  d = removeSlide(d, ids[3]);
  d = removeSlide(d, ids[0]);
  assert.deepEqual(sizes(d), [2]);
  assert.equal(toDeck(d).groups[0].name, "Slides 1–2");
  assert.deepEqual(toDeck(d).groups[0].script, ["hello", ""]);
});

test("a replaced file keeps scripts and group ids by position", () => {
  let d = replaceSlides(partsDraft(), pics(3));
  const first = order(d)[0];
  const id = d.groups[0].id;
  d = { ...d, script: { [first]: "intro" } };
  d = replaceSlides(d, pics(5));
  assert.equal(d.groups[0].id, id);
  assert.equal(d.script[order(d)[0]], "intro");
  assert.deepEqual(sizes(d), [1, 1, 1, 1, 1]);
});

test("a replaced file with the same count keeps the groups", () => {
  let d = replaceSlides(partsDraft(), pics(3));
  d = groupSlides(d, order(d).slice(0, 2));
  assert.deepEqual(sizes(replaceSlides(d, pics(3))), [2, 1]);
});

test("a stored deck round-trips with its ids", () => {
  const d0 = replaceSlides({ ...partsDraft(), title: "T", team: ["Ana", " ", "Bo"] }, pics(4));
  const deck = toDeck(groupSlides(d0, order(d0).slice(1, 3)));
  assert.deepEqual(deck.team, ["Ana", "Bo"]);
  assert.ok(deck.groups.every((g) => g.speaker === 0 && g.script.length === g.slides.length));
  const d1 = fromDeck(deck);
  assert.deepEqual(toDeck(d1), deck);
  assert.deepEqual(sizes(d1), [1, 2, 1]);
});

test("a deck keeps its length limit, a number or none, and has none set until one is picked", () => {
  const base = toDeck(replaceSlides({ ...partsDraft(), title: "T", team: ["Ana"] }, pics(1)));
  assert.equal("limitMs" in base, false);
  for (const limitMs of [90_000, null]) assert.equal(toDeck(fromDeck({ ...base, limitMs })).limitMs, limitMs);
});

test("editing a deck keeps where the room put the camera", () => {
  const deck = { ...toDeck(replaceSlides({ ...partsDraft(), title: "T", team: ["Ana"] }, pics(2))), camera: { x: 48, y: 48, w: 300, h: 300 } };
  assert.deepEqual(toDeck(fromDeck(deck)).camera, deck.camera);
});

test("a group keeps its id, and so its take, only while its recorded slides still open it", () => {
  let before = replaceSlides(partsDraft(), pics(4));
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

const page2 = (id: string) => ({ kind: "page" as const, id, src: `/f/${id}` });
const roomDeck: Deck = {
  title: "Harbor",
  team: ["Maya"],
  groups: [
    { id: "intro", name: "Slides 1–2", speaker: 0, slides: [page2("a"), page2("b")], script: ["hi", "problem"] },
    { id: "demo", name: "Slides 3–4", speaker: 0, slides: [page2("c"), page2("d")], script: ["", "demo"] },
  ],
  camera: { x: 1, y: 2, w: 300, h: 300 },
};
const ids = (d: Deck) => d.groups.map((g) => [g.id, g.slides.map((s) => s.id).join("")]);

test("splitting makes the rest of the group its own group and drops the take recorded on the whole", () => {
  const taken = new Set(["intro"]);
  const after = regroup(roomDeck, { kind: "split", slide: "b" }, taken);
  assert.deepEqual(after.groups.map((g) => g.slides.map((s) => s.id).join("")), ["a", "b", "cd"]);
  assert.deepEqual(after.groups.map((g) => g.name), ["Slide 1", "Slide 2", "Slides 3–4"]);
  assert.equal(after.groups[2].id, "demo");
  assert.deepEqual(lostTakes(roomDeck, after, taken).map((g) => g.id), ["intro"]);
  assert.deepEqual(after.groups.flatMap((g) => g.script), ["hi", "problem", "", "demo"]);
  assert.deepEqual(after.camera, roomDeck.camera);
});

test("splitting an apparently unrecorded group also fences delayed recordings", () => {
  const after = regroup(roomDeck, { kind: "split", slide: "b" }, new Set());
  assert.notEqual(after.groups[0].id, "intro");
  assert.notEqual(after.groups[1].id, "intro");
  assert.deepEqual(carriedSpeakers(roomDeck.groups, after.groups, { intro: "ana" }), { [after.groups[0].id]: "ana", [after.groups[1].id]: "ana" });
});

test("joining keeps a take recorded on the first group, and drops the one recorded on the second", () => {
  const taken = new Set(["intro", "demo"]);
  const after = regroup(roomDeck, { kind: "join", group: "intro" }, taken);
  assert.deepEqual(ids(after), [["intro", "abcd"]]);
  assert.deepEqual(lostTakes(roomDeck, after, taken).map((g) => g.id), ["demo"]);
});

test("nothing to split or join leaves the deck as it is", () => {
  assert.equal(regroup(roomDeck, { kind: "split", slide: "a" }, new Set()), roomDeck);
  assert.equal(regroup(roomDeck, { kind: "join", group: "demo" }, new Set()), roomDeck);
});

test("a split keeps the speaker on both parts, even when the take it drops gives the first part a new id", () => {
  const after = regroup(roomDeck, { kind: "split", slide: "b" }, new Set(["intro"]));
  const carried = carriedSpeakers(roomDeck.groups, after.groups, { intro: "ana", demo: "ben" });
  assert.deepEqual(after.groups.slice(0, 2).map((g) => carried[g.id]), ["ana", "ana"]);
  assert.equal(carried.demo, undefined);
});

test("a join keeps the first part's speaker, or takes the second's when the first had none", () => {
  const joined = regroup(roomDeck, { kind: "join", group: "intro" }, new Set());
  assert.deepEqual(carriedSpeakers(roomDeck.groups, joined.groups, { intro: "ana", demo: "ben" }), {});
  assert.deepEqual(carriedSpeakers(roomDeck.groups, joined.groups, { demo: "ben" }), { intro: "ben" });
  assert.deepEqual(carriedSpeakers(roomDeck.groups, joined.groups, {}), {});
});

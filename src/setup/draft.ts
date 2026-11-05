// The presentation while it is being set up: slides in order, in groups, a script line per slide. A continuous take
// uses one group; parts mode starts with one group per slide.
// Groups own their slide ids, so the flat order is the groups read in turn. Group ids survive edits
// wherever a group survives, because recorded takes are keyed by group id.
import type { Deck, Group, Rect, Slide } from "../studio/types";

/** An image the draft shows. `blob` is set until it is uploaded; `src` is then the room's file URL. */
export interface Pic {
  src: string;
  blob?: Blob;
}

export interface DraftSlide extends Pic {
  id: string;
  /** A slide that is not an uploaded page (an older deck's statement, clip...). Kept as it is. */
  kept?: Exclude<Slide, { kind: "page" }>;
}

export interface DraftGroup {
  id: string;
  slides: string[];
  seconds?: number;
}

export interface Draft {
  format?: Deck["format"];
  recording?: Deck["recording"];
  title: string;
  team: string[];
  logo: Pic | null;
  slides: Record<string, DraftSlide>;
  groups: DraftGroup[];
  /** slide id → what is said on it. */
  script: Record<string, string>;
  /** The source file's name, when this session uploaded one. */
  file?: string;
  /** Where the room put the camera tile; setup leaves it alone. */
  camera?: Rect;
  /** An optional manual take limit, as on the deck. */
  limitMs?: number | null;
}

export const emptyDraft = (): Draft => ({ title: "", team: [""], logo: null, slides: {}, groups: [], script: {}, recording: "continuous" });

const rand = (n: number) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
};
export const newSlideId = () => `p-${rand(8)}`;
export const newGroupId = () => `g-${rand(6)}`;
const GROUP_ID = /^[a-z0-9-]{1,40}$/;

/** Slide ids in deck order. */
export const order = (d: Draft): string[] => d.groups.flatMap((g) => g.slides);

/** "Slide 4" or "Slides 3–5", from 1-based positions. */
export function groupName(first: number, count: number): string {
  return count === 1 ? `Slide ${first}` : `Slides ${first}–${first + count - 1}`;
}

/** One group per slide, reusing `reuse` ids by position. */
function singles(ids: string[], reuse: string[] = []): DraftGroup[] {
  return ids.map((id, i) => ({ id: reuse[i] ?? newGroupId(), slides: [id] }));
}

/** A new set of slides replaces the old one: scripts carry over by position, group ids by position. When the count is
 *  unchanged the groups stay as they were too. */
export function replaceSlides(d: Draft, pics: Pic[], file?: string): Draft {
  const before = order(d);
  const ids = pics.map(() => newSlideId());
  const slides: Record<string, DraftSlide> = {};
  const script: Record<string, string> = {};
  ids.forEach((id, i) => {
    slides[id] = { id, ...pics[i] };
    const said = before[i] ? d.script[before[i]] : undefined;
    if (said) script[id] = said;
  });
  let groups: DraftGroup[];
  if (d.recording === "continuous") {
    groups = ids.length ? [{ id: d.groups[0]?.id ?? newGroupId(), slides: ids }] : [];
  } else if (before.length === ids.length && d.groups.length) {
    let i = 0;
    groups = d.groups.map((g) => ({ ...g, slides: g.slides.map(() => ids[i++]) }));
  } else {
    groups = singles(ids, d.groups.map((g) => g.id));
  }
  return { ...d, slides, script, groups, file };
}

/** A full take is one actual group, so its camera stream and cue timeline never restart at page boundaries. */
export function recordingMode(d: Draft, recording: NonNullable<Deck["recording"]>): Draft {
  if ((d.recording ?? "groups") === recording) return d;
  const ids = order(d);
  const groups = ids.length < 2 ? d.groups : recording === "continuous"
    ? [{ id: d.groups.length === 1 ? d.groups[0].id : newGroupId(), slides: ids }]
    : singles(ids);
  return { ...d, recording, groups };
}

function grouped(d: Draft, groups: DraftGroup[]): Draft {
  return { ...d, groups, recording: d.recording === "continuous" && groups.length > 1 ? "groups" : d.recording };
}

/** Puts the slides `ids` together, in deck order, as one group where the first of them is. Groups they leave keep their
 *  ids; the new group takes the id of a group it swallows whole, one with a recorded take (`taken`) first. */
export function groupSlides(d: Draft, ids: Iterable<string>, taken: ReadonlySet<string> = new Set()): Draft {
  const pick = new Set(ids);
  const slides = order(d).filter((s) => pick.has(s));
  if (slides.length < 2) return d;
  const whole = d.groups.filter((g) => g.slides.every((s) => pick.has(s)));
  const id = (whole.find((g) => taken.has(g.id)) ?? whole[0])?.id ?? newGroupId();
  const groups: DraftGroup[] = [];
  for (const g of d.groups) {
    const at = g.slides.indexOf(slides[0]);
    const before = (at < 0 ? g.slides : g.slides.slice(0, at)).filter((s) => !pick.has(s));
    const after = at < 0 ? [] : g.slides.slice(at).filter((s) => !pick.has(s));
    if (before.length) groups.push(before.length === g.slides.length ? g : { id: g.id, slides: before });
    if (at >= 0) groups.push({ id, slides });
    if (after.length) groups.push({ id: before.length ? newGroupId() : g.id, slides: after });
  }
  return grouped(d, groups);
}

/** Splits every group holding one of `ids` back into one group per slide. The first slide keeps the group's id. */
export function ungroupSlides(d: Draft, ids: Iterable<string>): Draft {
  const pick = new Set(ids);
  const groups = d.groups.flatMap((g) =>
    g.slides.length > 1 && g.slides.some((s) => pick.has(s)) ? g.slides.map((s, k) => ({ id: k ? newGroupId() : g.id, slides: [s] })) : [g],
  );
  return grouped(d, groups);
}

/** Splits the group holding `id` so that `id` and the slides after it make a group of their own. The first part keeps
 *  the group's id; a group's own recording length no longer fits either part. */
export function splitBefore(d: Draft, id: string): Draft {
  const groups = d.groups.flatMap((g) => {
    const k = g.slides.indexOf(id);
    return k > 0 ? [{ id: g.id, slides: g.slides.slice(0, k) }, { id: newGroupId(), slides: g.slides.slice(k) }] : [g];
  });
  return groups.length === d.groups.length ? d : grouped(d, groups);
}

/** Joins group `group` with the group after it, keeping the id `groupSlides` would. */
export function joinNext(d: Draft, group: string, taken: ReadonlySet<string> = new Set()): Draft {
  const i = d.groups.findIndex((g) => g.id === group);
  const [a, b] = [d.groups[i], d.groups[i + 1]];
  return i >= 0 && b ? groupSlides(d, [...a.slides, ...b.slides], taken) : d;
}

export function removeSlide(d: Draft, id: string): Draft {
  const groups = d.groups
    .map((g) => (g.slides.includes(id) ? { id: g.id, slides: g.slides.filter((s) => s !== id) } : g))
    .filter((g) => g.slides.length > 0);
  const slides = { ...d.slides };
  delete slides[id];
  const script = { ...d.script };
  delete script[id];
  return { ...d, groups, slides, script };
}

/** Moves the slide at flat position `from` to flat position `to`. It stays in its group while it lands next to one of
 *  that group's slides, joins a group it lands inside, and is otherwise a group of its own. */
export function moveSlide(d: Draft, from: number, to: number): Draft {
  const flat = order(d);
  if (from === to || from < 0 || from >= flat.length || to < 0 || to >= flat.length) return d;
  const id = flat[from];
  const rest = flat.filter((s) => s !== id);
  const prev = rest[to - 1];
  const next = rest[to];
  const home = d.groups.find((g) => g.slides.includes(id))!;
  const groups = d.groups.flatMap((g) => (g !== home ? [g] : g.slides.length > 1 ? [{ id: g.id, slides: g.slides.filter((s) => s !== id) }] : []));
  const of = (s: string | undefined) => (s === undefined ? -1 : groups.findIndex((g) => g.slides.includes(s)));
  const homeAt = groups.findIndex((g) => g.id === home.id);
  const into = homeAt >= 0 && (of(prev) === homeAt || of(next) === homeAt) ? homeAt : of(prev) >= 0 && of(prev) === of(next) ? of(prev) : -1;
  if (into >= 0) {
    const g = groups[into];
    const k = g.slides.indexOf(prev) + 1 || g.slides.indexOf(next);
    groups[into] = { ...g, slides: [...g.slides.slice(0, k), id, ...g.slides.slice(k)] };
  } else {
    groups.splice(of(prev) + 1, 0, homeAt >= 0 ? { id: newGroupId(), slides: [id] } : home);
  }
  return { ...d, groups };
}

/** `d` with a fresh id for every group whose recording, made when the room had `before`, no longer fits it: a take is
 *  kept while the slides it was recorded on still open its group in the same order, or, after new slides replaced
 *  them all, while the group has as many slides in the same place. */
export function renewChangedGroups(d: Draft, before: Draft): Draft {
  const was = new Map<string, { slides: string[]; start: number }>();
  let at = 0;
  for (const g of before.groups) {
    was.set(g.id, { slides: g.slides, start: at });
    at += g.slides.length;
  }
  const old = new Set(order(before));
  at = 0;
  let changed = false;
  const groups = d.groups.map((g) => {
    const start = at;
    at += g.slides.length;
    const prev = was.get(g.id);
    if (!prev) return g;
    const fits = prev.slides.every((s, i) => g.slides[i] === s)
      || (g.slides.every((s) => !old.has(s)) && g.slides.length === prev.slides.length && start === prev.start);
    if (fits) return g;
    changed = true;
    return { ...g, id: newGroupId() };
  });
  return changed ? { ...d, groups } : d;
}

// Splitting and joining groups from the room, with the rules above: a group keeps its id, and so its take and its
// speaker, only while the slides its take was recorded on still open it.
export type Regroup =
  /** Slide `slide` and the ones after it in its group become a group of their own. */
  | { kind: "split"; slide: string }
  /** Group `group` and the group after it become one. */
  | { kind: "join"; group: string };

/** `deck` after `op`; the same deck when there is nothing to do. `taken`: groups with a take, whose ids a join keeps first. */
export function regroup(deck: Deck, op: Regroup, taken: ReadonlySet<string>): Deck {
  const before = fromDeck(deck);
  const after = op.kind === "split" ? splitBefore(before, op.slide) : joinNext(before, op.group, taken);
  if (after === before) return deck;
  // Another browser may have kept a recording that has not reached the room yet.
  return toDeck(renewChangedGroups(after, before));
}

/** Groups of `before` with a take that `after` no longer has: their takes are lost. */
export const lostTakes = (before: Deck, after: Deck, taken: ReadonlySet<string>) =>
  before.groups.filter((g) => taken.has(g.id) && !after.groups.some((n) => n.id === g.id));

/** Removes team member `i`. Every group's speaker is 0 (the room assigns people), so nothing else moves. */
export function removeMember(d: Draft, i: number): Draft {
  if (d.team.length <= 1) return d;
  return { ...d, team: d.team.filter((_, j) => j !== i) };
}

/** The deck as the room stores it. `src` maps a draft slide to the URL it is saved under. */
export function toDeck(d: Draft, src: (s: DraftSlide) => string = (s) => s.src, logo = d.logo?.src): Deck {
  let at = 1;
  const groups: Group[] = d.groups.map((g) => {
    const name = groupName(at, g.slides.length);
    at += g.slides.length;
    const group: Group = {
      id: g.id,
      name,
      speaker: 0,
      slides: g.slides.map((id) => {
        const s = d.slides[id];
        return s.kept ?? { kind: "page", id, src: src(s) };
      }),
      script: g.slides.map((id) => d.script[id] ?? ""),
    };
    if (g.seconds !== undefined) group.seconds = g.seconds;
    return group;
  });
  const team = d.team.map((t) => t.trim()).filter(Boolean);
  const deck: Deck = { title: d.title.trim(), team, groups };
  if (d.format) deck.format = d.format;
  if (d.recording) deck.recording = d.recording;
  if (logo) deck.logo = logo;
  if (d.camera) deck.camera = d.camera;
  if (d.limitMs !== undefined) deck.limitMs = d.limitMs;
  return deck;
}

/** A stored deck, ready to edit. Ids are kept; a repeated or malformed id gets a fresh one. */
export function fromDeck(deck: Deck): Draft {
  const slides: Record<string, DraftSlide> = {};
  const script: Record<string, string> = {};
  const seenGroups = new Set<string>();
  const groups: DraftGroup[] = [];
  for (const g of deck.groups) {
    const ids: string[] = [];
    g.slides.forEach((s, i) => {
      const id = s.id && !slides[s.id] ? s.id : newSlideId();
      slides[id] = s.kind === "page" ? { id, src: s.src } : { id, src: "", kept: { ...s, id } };
      if (g.script[i]) script[id] = g.script[i];
      ids.push(id);
    });
    if (!ids.length) continue;
    const id = GROUP_ID.test(g.id) && !seenGroups.has(g.id) ? g.id : newGroupId();
    seenGroups.add(id);
    const group: DraftGroup = { id, slides: ids };
    if (g.seconds !== undefined) group.seconds = g.seconds;
    groups.push(group);
  }
  const draft: Draft = {
    title: deck.title,
    team: deck.team.length ? deck.team.slice() : [""],
    logo: deck.logo ? { src: deck.logo } : null,
    slides,
    groups,
    script,
  };
  if (deck.camera) draft.camera = deck.camera;
  if (deck.format) draft.format = deck.format;
  if (deck.recording) draft.recording = deck.recording;
  if (deck.limitMs !== undefined) draft.limitMs = deck.limitMs;
  return draft;
}

/** What still blocks saving, by step. */
export const slidesMissing = (d: Draft) => d.groups.length === 0;
export const titleMissing = (d: Draft) => !d.title.trim();
export const teamMissing = (d: Draft) => !d.team.some((t) => t.trim());
export const limitInvalid = (d: Draft) => d.limitMs != null && (!Number.isSafeInteger(d.limitMs) || d.limitMs < 1000);

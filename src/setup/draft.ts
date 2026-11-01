// The presentation while it is being set up: slides in order, in groups, a script line per slide. Every slide is its own
// group until someone groups slides together.
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
}

export const emptyDraft = (): Draft => ({ title: "", team: [""], logo: null, slides: {}, groups: [], script: {} });

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
  if (before.length === ids.length && d.groups.length) {
    let i = 0;
    groups = d.groups.map((g) => ({ ...g, slides: g.slides.map(() => ids[i++]) }));
  } else {
    groups = singles(ids, d.groups.map((g) => g.id));
  }
  return { ...d, slides, script, groups, file };
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
  return { ...d, groups };
}

/** Splits every group holding one of `ids` back into one group per slide. The first slide keeps the group's id. */
export function ungroupSlides(d: Draft, ids: Iterable<string>): Draft {
  const pick = new Set(ids);
  const groups = d.groups.flatMap((g) =>
    g.slides.length > 1 && g.slides.some((s) => pick.has(s)) ? g.slides.map((s, k) => ({ id: k ? newGroupId() : g.id, slides: [s] })) : [g],
  );
  return { ...d, groups };
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
  if (logo) deck.logo = logo;
  if (d.camera) deck.camera = d.camera;
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
  return draft;
}

/** What still blocks saving, by step. */
export const slidesMissing = (d: Draft) => d.groups.length === 0;
export const titleMissing = (d: Draft) => !d.title.trim();
export const teamMissing = (d: Draft) => !d.team.some((t) => t.trim());

// The presentation while it is being set up: slides in order, cut into groups, a script line per slide.
// Groups own their slide ids, so the flat order is the groups read in turn. Group ids survive edits
// wherever a group survives, because recorded takes are keyed by group id.
import type { Deck, Group, Slide } from "../studio/types";

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
}

/** A new group every this many slides until someone moves the cuts. */
export const DEFAULT_GROUP = 3;

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

/** Cuts `ids` into runs of DEFAULT_GROUP, reusing `ids` of earlier groups by position. */
function defaultGroups(ids: string[], reuse: string[] = []): DraftGroup[] {
  const groups: DraftGroup[] = [];
  for (let i = 0; i < ids.length; i += DEFAULT_GROUP) {
    groups.push({ id: reuse[groups.length] ?? newGroupId(), slides: ids.slice(i, i + DEFAULT_GROUP) });
  }
  return groups;
}

/** A new set of slides replaces the old one: scripts carry over by position, group ids by position. When the count is
 *  unchanged the cuts stay where they were too. */
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
    groups = defaultGroups(ids, d.groups.map((g) => g.id));
  }
  return { ...d, slides, script, groups, file };
}

/** Which group holds flat position `at`, and where in it. */
function locate(groups: DraftGroup[], at: number): { g: number; k: number } {
  let n = at;
  for (let g = 0; g < groups.length; g++) {
    if (n < groups[g].slides.length) return { g, k: n };
    n -= groups[g].slides.length;
  }
  return { g: groups.length - 1, k: groups[groups.length - 1]?.slides.length ?? 0 };
}

/** Is there a cut between flat positions `at` and `at + 1`? */
export function isCut(d: Draft, at: number): boolean {
  const { g, k } = locate(d.groups, at);
  return k === d.groups[g].slides.length - 1 && g < d.groups.length - 1;
}

/** Toggles the cut between flat positions `at` and `at + 1`. Splitting keeps the id on the first half; joining keeps the
 *  id that has a recorded take (`taken`), else the first group's. */
export function toggleCut(d: Draft, at: number, taken: ReadonlySet<string> = new Set()): Draft {
  const { g, k } = locate(d.groups, at);
  const cur = d.groups[g];
  const groups = d.groups.slice();
  if (k === cur.slides.length - 1) {
    const next = groups[g + 1];
    if (!next) return d;
    const id = !taken.has(cur.id) && taken.has(next.id) ? next.id : cur.id;
    groups.splice(g, 2, { id, slides: [...cur.slides, ...next.slides] });
  } else {
    groups.splice(g, 1, { id: cur.id, slides: cur.slides.slice(0, k + 1) }, { id: newGroupId(), slides: cur.slides.slice(k + 1) });
  }
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

/** Moves the slide at flat position `from` to flat position `to`. The cuts stay where they are (every group keeps its
 *  size), since the slides step does not show groups. */
export function moveSlide(d: Draft, from: number, to: number): Draft {
  const flat = order(d);
  if (from === to || from < 0 || from >= flat.length || to < 0 || to >= flat.length) return d;
  const [id] = flat.splice(from, 1);
  flat.splice(to, 0, id);
  let i = 0;
  const groups = d.groups.map((g) => {
    const slides = flat.slice(i, (i += g.slides.length));
    return slides.every((s, k) => s === g.slides[k]) ? g : { id: g.id, slides };
  });
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
  return {
    title: deck.title,
    team: deck.team.length ? deck.team.slice() : [""],
    logo: deck.logo ? { src: deck.logo } : null,
    slides,
    groups,
    script,
  };
}

/** What still blocks saving, by step. */
export const slidesMissing = (d: Draft) => d.groups.length === 0;
export const titleMissing = (d: Draft) => !d.title.trim();
export const teamMissing = (d: Draft) => !d.team.some((t) => t.trim());

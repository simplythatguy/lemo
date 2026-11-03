// Every slide in deck order, grouped: spacing separates the groups, and one quiet row above each says who records it,
// Saving… while a kept take is on its way, and then how long it is. That row is also the way to change the group's speaker
// and to fold the group away, for this person only. The gap between two groups joins them; right-clicking or holding a
// slide splits its group there. Each change glides the strip to its new shape.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { firstName, initials, Menu } from "./parts";
import { renderThumb } from "./stage";
import { clock } from "./timing";
import { lostTakes, regroup, type Regroup } from "../setup/draft";
import type { Deck, Person, RoomState } from "./types";

/** Right-click, the menu key, or a held touch on a thumb (iOS sends no contextmenu for one) opens its menu. */
export function usePress(open: (anchor: HTMLElement) => void) {
  const t = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const stop = () => t.current && window.clearTimeout(t.current.timer);
  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      stop();
      t.current = null;
      if (e.pointerType !== "touch") return;
      const el = e.currentTarget;
      const press = { x: e.clientX, y: e.clientY, fired: false, timer: 0 };
      press.timer = window.setTimeout(() => {
        press.fired = true;
        navigator.vibrate?.(8);
        open(el);
      }, 450);
      t.current = press;
    },
    onPointerMove(e: React.PointerEvent) {
      if (t.current && Math.hypot(e.clientX - t.current.x, e.clientY - t.current.y) > 8) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onClickCapture(e: React.MouseEvent) {
      if (!t.current?.fired) return;
      e.preventDefault();
      e.stopPropagation();
      t.current = null;
    },
    onContextMenu(e: React.MouseEvent<HTMLElement>) {
      e.preventDefault();
      if (!t.current?.fired) open(e.currentTarget);
    },
    onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      e.preventDefault();
      open(e.currentTarget);
    },
  };
}

/** Thumbs, labels and folded tiles move to their new places instead of jumping there; ones that are new fade in. */
function useGlide(strip: React.RefObject<HTMLDivElement | null>) {
  const places = useRef(new Map<string, number>());
  const measure = (animate: boolean) => {
    const box = strip.current;
    if (!box) return;
    const base = box.getBoundingClientRect().left - box.scrollLeft;
    const still = !animate || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ease = getComputedStyle(box).getPropertyValue("--ease").trim();
    const next = new Map<string, number>();
    box.querySelectorAll<HTMLElement>("[data-glide]").forEach((el) => {
      const key = el.dataset.glide!;
      const seen = el.getBoundingClientRect().left - base;
      const x = seen - (parseFloat(getComputedStyle(el).translate) || 0);
      next.set(key, x);
      const was = places.current.get(key);
      if (still || places.current.size === 0) return;
      if (was === undefined) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: ease });
      } else if (Math.abs(was - x) > 0.5) {
        el.getAnimations().forEach((a) => a.cancel());
        // A longer way takes a little longer, so a long move never reads as a jump.
        el.animate([{ translate: `${was - x}px 0` }, { translate: "0 0" }], { duration: Math.min(480, 220 + Math.abs(was - x) * 0.6), easing: ease });
      }
    });
    places.current = next;
  };
  useLayoutEffect(() => measure(true));
  useEffect(() => {
    const ro = new ResizeObserver(() => measure(false));
    if (strip.current) ro.observe(strip.current);
    return () => ro.disconnect();
  }, []);
}

/** The groups this person folded away in room `code`, kept in this browser. */
export function useFolded(code: string): [ReadonlySet<string>, (group: string) => void] {
  const key = `lemo.folded.${code}`;
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback((group: string) => {
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(group)) next.add(group);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* storage blocked: folded for this visit */
      }
      return next;
    });
  }, [key]);
  return [folded, toggle];
}

export function Filmstrip({ deck, room, me, group, slide, locked, assignLocked, upload, saving, folded, onFold, onPick, onAssign, onRegroup }: {
  deck: Deck;
  room: RoomState;
  me: Person;
  /** The group and slide on stage. */
  group: number;
  slide: number;
  /** No picking another slide (a take is running here or being followed). */
  locked: boolean;
  /** No changing speakers (my own take is running). */
  assignLocked: boolean;
  upload: Record<string, number>;
  /** Groups this device kept a take of that the room has not shown yet. */
  saving: Set<string>;
  folded: ReadonlySet<string>;
  onFold(group: string): void;
  onPick(group: number, slide: number): void;
  onAssign(group: number, personId: string | null): void;
  onRegroup(op: Regroup): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ group: number; anchor: HTMLElement } | null>(null);
  const [cut, setCut] = useState<{ slide: string; anchor: HTMLElement } | null>(null);
  /** A split or join that would lose a take, waiting for a yes beside the control that asked for it. */
  const [ask, setAsk] = useState<{ op: Regroup; whose: string; anchor: HTMLElement } | null>(null);
  useGlide(strip);
  const press = usePress((el) => {
    if (!locked && el.dataset.split) setCut({ slide: el.dataset.split, anchor: el });
  });

  /** Regroups at once, or first asks when it would remove a recorded take. */
  const change = (op: Regroup, anchor: HTMLElement) => {
    const taken = new Set([...Object.keys(room.takes), ...saving, ...Object.keys(upload)]);
    const lost = lostTakes(deck, regroup(deck, op, taken), taken);
    if (!lost.length) return onRegroup(op);
    const names = lost.map((g) => room.people.find((p) => p.id === room.takes[g.id]?.personId)?.name);
    // Above the group's own row, so it covers no other label and its yes is never under the pointer that asked.
    const row = anchor.closest(".st-strip-g")?.querySelector<HTMLElement>(".st-strip-who") ?? anchor;
    setAsk({ op, anchor: row, whose: lost.length > 1 ? `${lost.length} takes` : names[0] ? `${firstName(names[0])}’s take` : "a take" });
  };

  // Keep the slide on stage in view. Only the strip scrolls, never the page.
  useLayoutEffect(() => {
    const box = strip.current;
    const el = box?.querySelector<HTMLElement>(".st-thumb.is-now");
    if (!box || !el) return;
    const left = el.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
    if (left < box.scrollLeft + 24 || left + el.offsetWidth > box.scrollLeft + box.clientWidth - 24) {
      box.scrollTo({ left: Math.max(0, left - box.clientWidth / 2 + el.offsetWidth / 2), behavior: "smooth" });
    }
  }, [group, slide]);

  useEffect(() => {
    if (assignLocked) setMenu(null);
  }, [assignLocked]);
  useEffect(() => {
    if (locked) setAsk(null);
  }, [locked]);

  return (
    <>
      <div ref={strip} className={`st-strip${locked ? " is-locked" : ""}`} aria-label="Slides">
        {deck.groups.map((g, gi) => {
          const who = room.people.find((p) => p.id === room.assignments[g.id]);
          const take = room.takes[g.id];
          const up = upload[g.id] ?? (take && take.received < take.chunks ? take.received / take.chunks : undefined);
          const pending = up !== undefined || saving.has(g.id);
          const done = !!take && !pending;
          const note = pending ? (up ? `Saving ${Math.round(up * 100)}%` : "Saving…") : done ? clock(take.durationMs) : null;
          const status = done ? `recorded ${clock(take.durationMs)}` : note?.toLowerCase() ?? "not recorded";
          return (
            <div key={g.id} className={`st-strip-g${folded.has(g.id) ? " is-folded" : ""}`} role="group" aria-label={g.name}>
              <button
                type="button"
                data-glide={`who-${g.id}`}
                className={`btn is-quiet is-sm st-strip-who${who ? "" : " is-none"}${done ? " is-done" : ""}`}
                disabled={assignLocked}
                aria-haspopup="menu"
                aria-expanded={menu?.group === gi}
                aria-label={who ? `${g.name}: ${who.name}, ${status}. Change speaker` : `${g.name}: ${status}, choose a speaker`}
                onClick={(e) => {
                  const anchor = e.currentTarget;
                  setMenu((m) => (m?.anchor === anchor ? null : { group: gi, anchor }));
                }}
              >
                {done && <Icon name="check" size={12} />}
                <span className="st-strip-name">{who ? firstName(who.name) : "Nobody"}</span>
                {note && <span className="st-strip-n">{note}</span>}
                <span className="st-strip-caret" aria-hidden="true" />
              </button>
              {folded.has(g.id) ? (
                <button type="button" data-glide={`fold-${g.id}`} className="st-strip-folded" aria-label={`Show ${g.name}`} data-tip="Show slides" onClick={() => onFold(g.id)}>
                  <Icon name="eye-off" size={16} />
                </button>
              ) : (
                <div className="st-strip-slides">
                  {g.slides.map((s, si) => {
                    const now = gi === group && si === slide;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        data-glide={s.id}
                        data-split={si > 0 ? s.id : undefined}
                        className={`st-thumb${now ? " is-now" : ""}`}
                        onClick={() => onPick(gi, si)}
                        {...press}
                        disabled={locked}
                        aria-label={`${g.name}, slide ${si + 1}`}
                        aria-current={now || undefined}
                      >
                        <Thumb deck={deck} group={gi} slide={si} />
                      </button>
                    );
                  })}
                </div>
              )}
              {gi < deck.groups.length - 1 && !locked && (
                <button
                  type="button"
                  className={`st-strip-join${!room.takes[g.id] && room.takes[deck.groups[gi + 1].id] ? " is-keep-next" : ""}`}
                  aria-label={`Join ${g.name} with ${deck.groups[gi + 1].name}`}
                  data-tip="Join"
                  aria-expanded={ask?.op.kind === "join" && ask.op.group === g.id}
                  onClick={(e) => change({ kind: "join", group: g.id }, e.currentTarget)}
                >
                  <Icon name="fold" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Menu label="Speaker" anchor={menu?.anchor ?? null} above onClose={() => setMenu(null)}>
        {/* You first: the likeliest pick. */}
        {menu && [...room.people.filter((p) => p.id === me.id), ...room.people.filter((p) => p.id !== me.id), { id: null, name: "Nobody" }].map((o) => {
          const current = (room.assignments[deck.groups[menu.group].id] ?? null) === o.id;
          return (
            <button
              key={o.id ?? "none"}
              type="button"
              role="menuitemradio"
              aria-checked={current}
              className="st-menu-item"
              onClick={() => {
                onAssign(menu.group, o.id);
                setMenu(null);
              }}
            >
              <span className={`st-menu-dot${o.id ? "" : " is-none"}${o.id === me.id ? " is-me" : ""}`}>{o.id ? initials(o.name) : ""}</span>
              <span className="st-menu-name">{o.id === me.id ? `${o.name} (you)` : o.name}</span>
              {current && <Icon name="check" size={14} />}
            </button>
          );
        })}
        {menu && !folded.has(deck.groups[menu.group].id) && (
          <>
            <div className="st-menu-sep" role="separator" />
            <button type="button" role="menuitem" className="st-menu-item" onClick={() => { onFold(deck.groups[menu.group].id); setMenu(null); }}>
              <Icon name="eye-off" size={14} />
              <span className="st-menu-name">Hide slides</span>
            </button>
          </>
        )}
      </Menu>
      <Menu label="Slide" anchor={cut?.anchor ?? null} above onClose={() => setCut(null)}>
        <button
          type="button"
          role="menuitem"
          className="st-menu-item"
          onClick={() => {
            if (cut) change({ kind: "split", slide: cut.slide }, cut.anchor);
            setCut(null);
          }}
        >
          <Icon name="unfold" size={14} />
          <span className="st-menu-name">Split here</span>
        </button>
      </Menu>
      <Menu label="Remove a take?" role="dialog" anchor={ask?.anchor ?? null} above onClose={() => setAsk(null)}>
        <p className="st-strip-ask">This removes {ask?.whose}.</p>
        <button
          type="button"
          className="st-menu-item"
          onClick={() => {
            if (ask) onRegroup(ask.op);
            setAsk(null);
          }}
        >
          <Icon name={ask?.op.kind === "split" ? "unfold" : "fold"} size={14} />
          <span className="st-menu-name">{ask?.op.kind === "split" ? "Split" : "Join"}</span>
        </button>
      </Menu>
    </>
  );
}

/** The last paint of each slide, so a thumb that moves to another group shows its picture at once. */
const painted = new Map<string, HTMLCanvasElement>();

function Thumb({ deck, group, slide }: { deck: Deck; group: number; slide: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const id = deck.groups[group].slides[slide].id;
  const [shown, setShown] = useState(() => painted.has(id));
  useLayoutEffect(() => {
    const c = canvas.current!;
    c.width = 256;
    c.height = 144;
    const last = painted.get(id);
    if (last && last !== c) c.getContext("2d")?.drawImage(last, 0, 0);
    void renderThumb(c, deck, group, slide).then(() => {
      painted.set(id, c);
      setShown(true);
    }, () => undefined);
  }, [deck, group, slide, id]);
  // The first paint fades in rather than popping into an empty frame.
  return <canvas ref={canvas} className={shown ? "is-painted" : undefined} aria-hidden="true" />;
}

// Every slide in deck order, grouped: spacing separates the groups, and one quiet row above each says who records it,
// Saving… while a kept take is on its way, and then how long it is. That row is also the way to change the group's speaker.
// Right-clicking a slide splits its group there; hovering the gap between two groups offers to join them, and the row's
// menu does too. A group can be folded away, for this person only.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { firstName, initials, Menu } from "./parts";
import { renderThumb } from "./stage";
import { clock } from "./timing";
import type { Regroup } from "../setup/draft";
import type { Deck, Person, RoomState } from "./types";

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
            <div key={g.id} className="st-strip-g" role="group" aria-label={g.name}>
              <button
                type="button"
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
                // The keyboard's way back is Show slides in the menu above.
                <button type="button" className="st-strip-folded" tabIndex={-1} aria-hidden="true" onClick={() => onFold(g.id)}>
                  {g.slides.length}
                </button>
              ) : (
                <div className="st-strip-slides">
                  {g.slides.map((s, si) => {
                    const now = gi === group && si === slide;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`st-thumb${now ? " is-now" : ""}`}
                        onClick={() => onPick(gi, si)}
                        onContextMenu={si > 0 && !locked ? (e) => {
                          e.preventDefault();
                          setCut({ slide: s.id, anchor: e.currentTarget });
                        } : undefined}
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
                <button type="button" className="st-strip-join" tabIndex={-1} aria-label={`Join ${g.name} with ${deck.groups[gi + 1].name}`} data-tip="Join" onClick={() => onRegroup({ kind: "join", group: g.id })}>
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
        {menu && (() => {
          const g = deck.groups[menu.group];
          const hasNext = menu.group < deck.groups.length - 1;
          return (
            <>
              <div className="st-menu-sep" role="separator" />
              <button type="button" role="menuitem" className="st-menu-item" onClick={() => { onFold(g.id); setMenu(null); }}>
                <Icon name={folded.has(g.id) ? "eye" : "eye-off"} size={14} />
                <span className="st-menu-name">{folded.has(g.id) ? "Show slides" : "Hide slides"}</span>
              </button>
              {hasNext && !locked && (
                <button type="button" role="menuitem" className="st-menu-item" onClick={() => { onRegroup({ kind: "join", group: g.id }); setMenu(null); }}>
                  <Icon name="fold" size={14} />
                  <span className="st-menu-name">Join with the next group</span>
                </button>
              )}
            </>
          );
        })()}
      </Menu>
      <Menu label="Slide" anchor={cut?.anchor ?? null} above onClose={() => setCut(null)}>
        <button type="button" role="menuitem" className="st-menu-item" onClick={() => { if (cut) onRegroup({ kind: "split", slide: cut.slide }); setCut(null); }}>
          <Icon name="unfold" size={14} />
          <span className="st-menu-name">Split here</span>
        </button>
      </Menu>
    </>
  );
}

function Thumb({ deck, group, slide }: { deck: Deck; group: number; slide: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
    c.width = 256;
    c.height = 144;
    void renderThumb(c, deck, group, slide).then(() => setPainted(true), () => undefined);
  }, [deck, group, slide]);
  // The first paint fades in rather than popping into an empty frame.
  return <canvas ref={canvas} className={painted ? "is-painted" : undefined} aria-hidden="true" />;
}

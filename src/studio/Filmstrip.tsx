// Every slide in deck order, grouped: spacing separates the groups, and one quiet row above each says who records it,
// Saving… while a kept take is on its way, and then how long it is. That row is also the way to change the group's speaker.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { firstName, initials, Menu } from "./parts";
import { renderThumb } from "./stage";
import { clock } from "./timing";
import type { Deck, Person, RoomState } from "./types";

export function Filmstrip({ deck, room, me, group, slide, locked, assignLocked, upload, saving, onPick, onAssign }: {
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
  onPick(group: number, slide: number): void;
  onAssign(group: number, personId: string | null): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ group: number; anchor: HTMLElement } | null>(null);

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
              <div className="st-strip-slides">
                {g.slides.map((s, si) => {
                  const now = gi === group && si === slide;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`st-thumb${now ? " is-now" : ""}`}
                      onClick={() => onPick(gi, si)}
                      disabled={locked}
                      aria-label={`${g.name}, slide ${si + 1}`}
                      aria-current={now || undefined}
                    >
                      <Thumb deck={deck} group={gi} slide={si} />
                    </button>
                  );
                })}
              </div>
              {/* After the slides in the DOM, so a group's first button picks its first slide; CSS puts it on top. */}
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
              </button>
            </div>
          );
        })}
      </div>
      {menu && (
        <Menu label="Speaker" anchor={menu.anchor} above onClose={() => setMenu(null)}>
          {[...room.people.map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: "Nobody" }].map((o) => {
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
        </Menu>
      )}
    </>
  );
}

function Thumb({ deck, group, slide }: { deck: Deck; group: number; slide: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    c.width = 256;
    c.height = 144;
    void renderThumb(c, deck, group, slide).catch(() => undefined);
  }, [deck, group, slide]);
  return <canvas ref={canvas} aria-hidden="true" />;
}

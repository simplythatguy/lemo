// Every slide in deck order, each its own tile. A thin ring in the group's colour ties a group's slides together; the speaker's initials sit on each slide.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { initials } from "./parts";
import { renderThumb } from "./stage";
import { clock, targetMs } from "./timing";
import type { Deck, Person, RoomState } from "./types";

/** One muted colour per group: it only tells the groups apart. Neighbours never share a family. */
const GROUP_COLORS = ["#8495c9", "#6fa8a0", "#c4a06a", "#a88cc4", "#8fab7c", "#c98f86", "#6f9fc6", "#b8a46e", "#c38aa6"];
export const groupColor = (i: number) => GROUP_COLORS[i % GROUP_COLORS.length];

export function Filmstrip({ deck, room, me, group, slide, locked, assignLocked, upload, onPick, onAssign }: {
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
  onPick(group: number, slide: number): void;
  onAssign(group: number, personId: string | null): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ group: number; anchor: HTMLElement } | null>(null);
  // The menu hangs off its circle and moves with it when the strip scrolls.
  const [, setScrolled] = useState(0);

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
      <div ref={strip} className="st-strip" aria-label="Slides" onScroll={() => menu && setScrolled((n) => n + 1)}>
        {deck.groups.map((g, gi) => {
          const who = room.people.find((p) => p.id === room.assignments[g.id]);
          const take = room.takes[g.id];
          const up = upload[g.id] ?? (take && take.received < take.chunks ? take.received / take.chunks : undefined);
          return (
            <div
              key={g.id}
              className="st-strip-g"
              style={{ "--g": groupColor(gi) } as React.CSSProperties}
              title={`${g.name} · ${clock(targetMs(g))}`}
              role="group"
              aria-label={g.name}
            >
              {up !== undefined ? (
                <span className="st-thumb-tag is-up" aria-label={`Uploading, ${Math.round(up * 100)}%`}>{Math.round(up * 100)}%</span>
              ) : take ? (
                <span className="st-thumb-tag" aria-label={`Recorded, ${clock(take.durationMs)}`}>
                  <Icon name="check" size={12} stroke={2.4} />{clock(take.durationMs)}
                </span>
              ) : null}
              {g.slides.map((s, si) => {
                const now = gi === group && si === slide;
                return (
                  <div key={s.id} className={`st-thumb${now ? " is-now" : ""}`}>
                    <button
                      type="button"
                      className="st-thumb-hit"
                      onClick={() => onPick(gi, si)}
                      disabled={locked}
                      aria-label={`${g.name}, slide ${si + 1}`}
                      aria-current={now || undefined}
                    >
                      <Thumb deck={deck} group={gi} slide={si} />
                    </button>
                    <button
                      type="button"
                      className={`st-who-dot${who ? "" : " is-none"}${who?.id === me.id ? " is-me" : ""}`}
                      disabled={assignLocked}
                      aria-label={who ? `${g.name}: ${who.name}. Change speaker` : `${g.name}: choose a speaker`}
                      aria-haspopup="menu"
                      title={who?.name ?? "Choose a speaker"}
                      onClick={(e) => {
                        const anchor = e.currentTarget;
                        setMenu((m) => (m?.anchor === anchor ? null : { group: gi, anchor }));
                      }}
                    >
                      {who ? initials(who.name) : ""}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {menu && (
        <AssignMenu
          people={room.people}
          me={me}
          current={room.assignments[deck.groups[menu.group].id] ?? null}
          anchor={menu.anchor.getBoundingClientRect()}
          onPick={(id) => {
            onAssign(menu.group, id);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
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

function AssignMenu({ people, me, current, anchor, onPick, onClose }: {
  people: Person[];
  me: Person;
  current: string | null;
  anchor: DOMRect;
  onPick(id: string | null): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[aria-checked=true], button")?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest?.(".st-who-dot")) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close.current();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, []);
  const options = [...people.map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: "Nobody" }];
  return (
    <div ref={ref} className="st-menu" role="menu" aria-label="Speaker" style={{ left: anchor.right, top: anchor.top }}>
      {options.map((o) => (
        <button key={o.id ?? "none"} type="button" role="menuitemradio" aria-checked={o.id === current} className="st-menu-item" onClick={() => onPick(o.id)}>
          <span className={`st-menu-dot${o.id ? "" : " is-none"}${o.id === me.id ? " is-me" : ""}`}>{o.id ? initials(o.name) : ""}</span>
          <span className="st-menu-name">{o.id === me.id ? `${o.name} (you)` : o.name}</span>
          {o.id === current && <Icon name="check" size={14} stroke={2.2} />}
        </button>
      ))}
    </div>
  );
}

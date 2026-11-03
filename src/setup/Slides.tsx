// Step 1: the slides. Drop a PDF or PowerPoint anywhere (or choose one); a grid of the rendered slides to reorder, prune
// and group. A line under a group's slides holds it together; the gap after a group joins it to the next, as in the
// room's strip, and right-clicking or holding a slide splits its group there. A click selects slides; selected slides
// become one group or are removed.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { groupName, order, type Draft } from "./draft";
import { glide } from "./glide";
import { Thumb } from "./Thumb";
import { usePress } from "../studio/Filmstrip";
import { Menu } from "../studio/parts";
// The slide menu is the room's menu, styled with the room.
import "../studio/studio.css";

export const ACCEPT = ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** A file being rendered: its slides so far, out of `total` once known. */
export interface Importing {
  name: string;
  total: number | null;
  done: string[];
}

export function Slides({ draft, importing, error, fileOver, onFile, onRemove, onMove, onGroup, onUngroup, onJoin, onSplit }: {
  draft: Draft;
  importing: Importing | null;
  error: string | null;
  /** A file is being dragged over the page; dropping it adds or replaces the slides. */
  fileOver: boolean;
  onFile(file: File): void;
  onRemove(id: string): void;
  onMove(from: number, to: number): void;
  onGroup(ids: string[]): void;
  onUngroup(ids: string[]): void;
  onJoin(group: string): void;
  onSplit(slide: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const ids = order(draft);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selected = ids.filter((id) => picked.has(id));
  const touched = draft.groups.filter((g) => g.slides.some((s) => picked.has(s)));
  const canGroup = selected.length > 1 && !(touched.length === 1 && touched[0].slides.length === selected.length);
  const canUngroup = touched.some((g) => g.slides.length > 1);
  const clear = () => setPicked(new Set());
  /** Slides of the file being read that are on screen: the count never runs ahead of the pictures. */
  const [painted, setPainted] = useState(0);
  const counting = !!importing?.total;
  useEffect(() => {
    if (!counting) setPainted(0);
  }, [counting]);

  /** Removes the selected slides; focus lands on the slide that took the first one's place. */
  const remove = () => {
    const at = Math.min(ids.indexOf(selected[0]), ids.length - selected.length - 1);
    void glide(() => {
      selected.forEach(onRemove);
      clear();
    }).then(() => at >= 0 && cellAt(at)?.focus());
  };
  /** Groups or ungroups the selection; focus stays in the grid, on its first slide, as the button it was on goes. */
  const regroup = (change: (ids: string[]) => void) => {
    const first = selected[0];
    change(selected);
    clear();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.su-grid [data-vt="${first}"]`)?.focus());
  };
  const keys = useRef({ clear, remove });
  keys.current = { clear, remove };

  useEffect(() => {
    if (!selected.length || importing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") keys.current.clear();
      else if ((e.key === "Delete" || e.key === "Backspace") && !(e.target as HTMLElement).closest("input, textarea, [contenteditable]")) {
        e.preventDefault();
        keys.current.remove();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected.length, importing]);

  const pick = () => input.current?.click();
  const picker = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={(e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (f) onFile(f);
      }}
    />
  );

  /** A file being opened before its page count is known: nothing changes yet, so a file it refuses never flashes a grid. */
  const reading = !!importing && !importing.total;
  if (!ids.length && (!importing || reading)) {
    return (
      <div className="su-empty">
        {picker}
        <h1 className="su-title">Add your slides</h1>
        <button type="button" className="btn is-primary is-lg" onClick={pick} aria-busy={reading || undefined}>
          <Icon name="upload" size={16} />Choose a file
        </button>
        {error ? <p className="su-error" role="alert">{error}</p> : <p className="su-quiet">16:9 PDF or PowerPoint</p>}
        <Drop label="Drop to add" on={fileOver} />
      </div>
    );
  }

  const shown = importing?.total ? importing : null;
  const name = shown?.name ?? draft.file ?? (draft.title.trim() || "Slides");
  const slides = `${ids.length} ${ids.length === 1 ? "slide" : "slides"}`;
  const grouped = draft.groups.length < ids.length ? `${draft.groups.length} ${draft.groups.length === 1 ? "group" : "groups"}` : "";
  return (
    <div className="su-slides">
      {picker}
      {selected.length > 0 && !importing ? (
        <div className="su-head">
          <span className="su-head-name">
            <h1 className="su-title is-sm su-picked">
              {selected.length}
              <span className="su-picked-word"> selected</span>
            </h1>
          </span>
          <span className="su-grow" />
          {canUngroup && (
            <button type="button" className="btn is-quiet is-sm" onClick={() => regroup(onUngroup)}>
              Ungroup
            </button>
          )}
          <button type="button" className="btn is-quiet is-sm" onClick={remove} aria-keyshortcuts="Delete Backspace">
            Remove
          </button>
          {canGroup && (
            <button type="button" className="btn is-quiet is-sm" onClick={() => regroup(onGroup)}>
              Group
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Clear selection" data-tip="Clear selection" onClick={clear}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ) : (
        <div className="su-head">
          <span className="su-head-name">
            <h1 className="su-title is-sm">{name}</h1>
            {error ? (
              <span className="su-error" role="alert">{error}</span>
            ) : shown ? (
              <span className="su-quiet" role="progressbar" aria-label="Reading slides" aria-valuemin={0} aria-valuemax={shown.total!} aria-valuenow={painted}>
                {painted} of {shown.total}
              </span>
            ) : (
              <span className="su-quiet">{[slides, grouped].filter(Boolean).join(" · ")}</span>
            )}
          </span>
          <span className="su-grow" />
          <button type="button" className="btn is-quiet is-sm" onClick={pick} disabled={!!shown} aria-busy={reading || undefined}>
            <Icon name="upload" size={16} />Replace
          </button>
        </div>
      )}
      {shown ? <Progress importing={shown} onPainted={() => setPainted((n) => n + 1)} /> : <Grid draft={draft} ids={ids} picked={picked} setPicked={setPicked} onMove={onMove} onJoin={onJoin} onSplit={onSplit} onRemove={onRemove} />}
      <Drop label="Drop to replace" on={fileOver} />
    </div>
  );
}

const cellAt = (i: number) => document.querySelectorAll<HTMLElement>(".su-grid .su-cell")[i];

/** While a file is dragged over the step: where it lands. Kept mounted so it fades out as it faded in. */
function Drop({ label, on }: { label: string; on: boolean }) {
  return (
    <div className={`su-drop${on ? " is-on" : ""}`} aria-hidden="true">
      <div className="su-target">
        <Icon name="upload" size={28} />
        {label}
      </div>
    </div>
  );
}

/** The file's whole grid from the moment its page count is known; each slide fades in over its own place. */
function Progress({ importing, onPainted }: { importing: Importing; onPainted(): void }) {
  const grid = useRef<HTMLOListElement>(null);
  return (
    <ol className="su-grid" ref={grid} style={useRow(grid).style} aria-busy="true">
      {Array.from({ length: importing.total ?? 0 }, (_, i) => (
        <li key={i} className="su-cell" data-at="solo">
          <div className="su-thumb is-wait">{importing.done[i] && <img className="su-thumb-img is-new" src={importing.done[i]} alt="" onLoad={onPainted} />}</div>
          <span className="su-n">{i + 1}</span>
        </li>
      ))}
    </ol>
  );
}

/** "4" or "3–5", from a 0-based start. */
const range = (first: number, n: number) => (n > 1 ? `${first + 1}–${first + n}` : String(first + 1));

/** How many slides a row holds at the grid's width, how wide each is so that a row of them fills it, and the gap. */
function useRow(grid: React.RefObject<HTMLOListElement | null>): { cols: number; style: React.CSSProperties } {
  const [row, setRow] = useState({ cols: 4, cell: 0, gap: 0 });
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const cols = width > 900 ? 4 : width > 560 ? 3 : 2;
      setRow({ cols, cell: Math.floor((width - (cols - 1) * gap) / cols), gap });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid]);
  return { cols: row.cols, style: { "--cols": row.cols, "--cell": `${row.cell}px`, "--gap": `${row.gap}px` } as React.CSSProperties };
}

function Grid({ draft, ids, picked, setPicked, onMove, onJoin, onSplit, onRemove }: {
  draft: Draft;
  ids: string[];
  picked: ReadonlySet<string>;
  setPicked(next: ReadonlySet<string>): void;
  onMove(from: number, to: number): void;
  onJoin(group: string): void;
  onSplit(slide: string): void;
  onRemove(id: string): void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  /** Insertion point while dragging: the slide lands before position `at` (0…n). */
  const [at, setAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  /** Where the last plain click was, for shift-click ranges. */
  const anchor = useRef<number | null>(null);
  const grid = useRef<HTMLOListElement>(null);
  const { cols, style } = useRow(grid);
  const press = usePress((el) => setMenu({ id: el.dataset.vt!, anchor: el }));
  const end = () => {
    setDrag(null);
    setAt(null);
  };
  const toggle = (i: number, range: boolean) => {
    const next = new Set(picked);
    if (range && anchor.current !== null) {
      const [lo, hi] = anchor.current < i ? [anchor.current, i] : [i, anchor.current];
      ids.slice(lo, hi + 1).forEach((id) => next.add(id));
    } else {
      if (!next.delete(ids[i])) next.add(ids[i]);
      anchor.current = i;
    }
    setPicked(next);
  };

  /** Each group with where it starts. */
  let first = 0;
  const groups = draft.groups.map((g, gi) => {
    const out = { g, gi, first, label: range(first, g.slides.length), name: groupName(first + 1, g.slides.length) };
    first += g.slides.length;
    return out;
  });
  const home = new Map(groups.flatMap((x) => x.g.slides.map((s) => [s, x] as const)));
  const shown = menu && home.get(menu.id);

  const slide = (id: string, i: number) => {
    const { g, gi, first, label, name } = home.get(id)!;
    const grouped = g.slides.length > 1;
    const k = i - first;
    const next = groups[gi + 1];
    return (
      <li
        key={id}
        data-at={!grouped ? "solo" : k === 0 ? "first" : k === g.slides.length - 1 ? "last" : "mid"}
        data-row-end={i % cols === cols - 1 || undefined}
        className={`su-cell${drag === i ? " is-dragging" : ""}${at === i && drag !== null ? " is-before" : ""}${at === i + 1 && drag !== null && i === ids.length - 1 ? " is-after" : ""}${picked.has(id) ? " is-picked" : ""}`}
        draggable
        {...press}
        onClick={(e) => toggle(i, e.shiftKey)}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/x-lemo-slide", id);
          setDrag(i);
        }}
        onDragEnd={end}
        onDragOver={(e) => {
          if (drag === null) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
        }}
        onDrop={(e) => {
          if (drag === null || at === null) return;
          e.preventDefault();
          e.stopPropagation();
          const [from, to] = [drag, at > drag ? at - 1 : at];
          void glide(() => {
            onMove(from, to);
            end();
          });
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          press.onKeyDown(e);
          if (e.defaultPrevented) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle(i, e.shiftKey);
            return;
          }
          if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
          e.preventDefault();
          const to = e.key === "ArrowLeft" ? i - 1 : i + 1;
          if (to >= 0 && to < ids.length) void glide(() => onMove(i, to)).then(() => cellAt(to)?.focus());
        }}
        tabIndex={0}
        data-vt={id}
        aria-label={`Slide ${i + 1}${grouped ? `, in ${name}` : ""}${picked.has(id) ? ", selected" : ""}`}
        aria-haspopup="menu"
        aria-keyshortcuts="Space Alt+ArrowLeft Alt+ArrowRight Delete Shift+F10"
      >
        <div className="su-thumb">
          <Thumb slide={draft.slides[id]} />
        </div>
        <span className="su-band" aria-hidden="true" />
        <span className="su-n" aria-hidden="true">{k === 0 ? label : ""}</span>
        {next && k === g.slides.length - 1 && (
          <button type="button" className="su-join" aria-label={`Join ${name} with ${next.name}`} data-tip="Join" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); pick(() => onJoin(g.id)); }}>
            <Icon name="fold" size={14} />
          </button>
        )}
      </li>
    );
  };

  const pick = (act: () => void) => {
    setMenu(null);
    void glide(act);
  };
  return (
    <>
      <ol className={`su-grid${picked.size ? " is-picking" : ""}`} ref={grid} style={style}>
        {ids.map(slide)}
      </ol>
      <Menu label={shown ? `Slide ${ids.indexOf(menu.id) + 1}` : "Slide"} anchor={menu?.anchor ?? null} onClose={() => setMenu(null)}>
        {shown && shown.g.slides[0] !== menu.id && (
          <button type="button" role="menuitem" className="st-menu-item" onClick={() => pick(() => onSplit(menu.id))}>
            <Icon name="unfold" size={14} />
            <span className="st-menu-name">Split here</span>
          </button>
        )}
        {shown && (
          <button type="button" role="menuitem" className="st-menu-item" onClick={() => pick(() => onRemove(menu.id))}>
            <Icon name="trash" size={14} />
            <span className="st-menu-name">Remove</span>
          </button>
        )}
      </Menu>
    </>
  );
}

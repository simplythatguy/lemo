// Step 1: the slides. Drop a PDF or PowerPoint anywhere (or choose one); a grid of the rendered slides to reorder, prune
// and group. A click selects a slide; selected slides become one group. A bar under the slides ties a group together,
// starting at the group's range.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { order, type Draft } from "./draft";
import { Thumb } from "./Thumb";

export const ACCEPT = ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** A file being rendered: its slides so far, out of `total` once known. */
export interface Importing {
  name: string;
  total: number | null;
  done: string[];
}

export function Slides({ draft, importing, error, fileOver, onFile, onRemove, onMove, onGroup, onUngroup }: {
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
}) {
  const input = useRef<HTMLInputElement>(null);
  const ids = order(draft);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selected = ids.filter((id) => picked.has(id));
  const touched = draft.groups.filter((g) => g.slides.some((s) => picked.has(s)));
  const canGroup = selected.length > 1 && !(touched.length === 1 && touched[0].slides.length === selected.length);
  const canUngroup = touched.some((g) => g.slides.length > 1);
  const clear = () => setPicked(new Set());

  useEffect(() => {
    if (!selected.length) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPicked(new Set());
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [selected.length]);

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

  if (!ids.length && !importing) {
    return (
      <div className={`su-empty${fileOver ? " is-over" : ""}`}>
        {picker}
        <h1 className="su-title">{fileOver ? "Drop to add" : "Add your slides"}</h1>
        <span className="blank-deck" aria-hidden="true"><i /><i /><i><Icon name="upload" size={28} /></i></span>
        <button type="button" className="btn is-primary is-lg" onClick={pick}>
          <Icon name="upload" size={16} />Choose a file
        </button>
        {error ? <p className="su-error" role="alert">{error}</p> : <p className="su-quiet">16:9 PDF or PowerPoint</p>}
      </div>
    );
  }

  const name = importing?.name ?? draft.file;
  const slides = `${ids.length} ${ids.length === 1 ? "slide" : "slides"}`;
  const grouped = draft.groups.length < ids.length ? `${draft.groups.length} ${draft.groups.length === 1 ? "group" : "groups"}` : "";
  return (
    <div className="su-slides">
      {picker}
      <div className="su-head">
        <span className="su-head-name">
          <h1 className="su-title is-sm">{name ?? slides}</h1>
          {importing ? (
            importing.total ? (
              <span className="su-quiet" role="progressbar" aria-label="Reading slides" aria-valuemin={0} aria-valuemax={importing.total} aria-valuenow={importing.done.length}>
                {importing.done.length} of {importing.total}
              </span>
            ) : null
          ) : (
            <span className="su-quiet">{[name && slides, grouped].filter(Boolean).join(" · ")}</span>
          )}
        </span>
        <span className="su-grow" />
        {selected.length > 0 && !importing ? (
          <>
            {canUngroup && (
              <button type="button" className="btn is-quiet is-sm" onClick={() => (onUngroup(selected), clear())}>
                Ungroup
              </button>
            )}
            {canGroup && (
              <button type="button" className="btn is-quiet is-sm" onClick={() => (onGroup(selected), clear())}>
                <Icon name="link" size={16} />Group {selected.length}
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Clear selection" data-tip="Clear selection" onClick={clear}>
              <Icon name="x" size={16} />
            </button>
          </>
        ) : (
          <button type="button" className="btn is-quiet is-sm" onClick={pick} disabled={!!importing}>
            <Icon name="upload" size={16} />Replace
          </button>
        )}
      </div>
      {error && <p className="su-error" role="alert">{error}</p>}
      {importing ? <Progress importing={importing} /> : <Grid draft={draft} ids={ids} picked={picked} setPicked={setPicked} onRemove={onRemove} onMove={onMove} />}
      {fileOver && (
        <div className="su-drop" aria-hidden="true">
          <div className="su-target">
            <Icon name="upload" size={28} />Drop to replace
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ importing }: { importing: Importing }) {
  const total = importing.total ?? 0;
  const left = Math.max(0, total - importing.done.length);
  return (
    <ol className="su-grid" aria-busy="true">
      {importing.done.map((src, i) => (
        <li key={i} className="su-cell is-new">
          <div className="su-thumb"><img className="su-thumb-img" src={src} alt="" /></div>
          <span className="su-label"><span className="su-n">{i + 1}</span></span>
        </li>
      ))}
      {Array.from({ length: left || (total ? 0 : 4) }, (_, i) => (
        <li key={`w${i}`} className="su-cell">
          <div className="su-thumb is-wait" />
          <span className="su-label"><span className="su-n">{total ? importing.done.length + i + 1 : ""}</span></span>
        </li>
      ))}
    </ol>
  );
}

/** How many columns the grid lays out right now, so a group's bar never runs past the end of a row. */
function useColumns(grid: React.RefObject<HTMLOListElement | null>): number {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setCols(getComputedStyle(el).gridTemplateColumns.split(" ").length);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid]);
  return cols;
}

function Grid({ draft, ids, picked, setPicked, onRemove, onMove }: {
  draft: Draft;
  ids: string[];
  picked: ReadonlySet<string>;
  setPicked(next: ReadonlySet<string>): void;
  onRemove(id: string): void;
  onMove(from: number, to: number): void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  /** Insertion point while dragging: the slide lands before position `at` (0…n). */
  const [at, setAt] = useState<number | null>(null);
  /** Where the last plain click was, for shift-click ranges. */
  const anchor = useRef<number | null>(null);
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
  const grid = useRef<HTMLOListElement>(null);
  const cols = useColumns(grid);
  /** slide id → its group's slides, for groups of more than one slide. */
  const group = new Map<string, string[]>();
  draft.groups.forEach((g) => g.slides.length > 1 && g.slides.forEach((s) => group.set(s, g.slides)));
  /** The bar reaches across the gap to the next slide when that slide is in the same group and on the same row. */
  const joined = (i: number) => (i + 1) % cols !== 0 && !!group.get(ids[i])?.includes(ids[i + 1]);
  /** A group's slides read as one range ("3–5"), named again where the group wraps onto the next row. */
  const label = (i: number) => {
    const g = group.get(ids[i]);
    if (!g) return String(i + 1);
    const first = i - g.indexOf(ids[i]);
    return first === i || i % cols === 0 ? `${first + 1}–${first + g.length}` : "";
  };
  return (
    <ol className="su-grid" ref={grid}>
      {ids.map((id, i) => (
        <li
          key={id}
          className={`su-cell${drag === i ? " is-dragging" : ""}${at === i && drag !== null ? " is-before" : ""}${at === i + 1 && drag !== null && i === ids.length - 1 ? " is-after" : ""}${picked.has(id) ? " is-picked" : ""}${group.has(id) ? " is-grouped" : ""}${joined(i) ? " is-joined" : ""}`}
          draggable
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
            onMove(drag, at > drag ? at - 1 : at);
            end();
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              toggle(i, e.shiftKey);
              return;
            }
            if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
            e.preventDefault();
            const to = e.key === "ArrowLeft" ? i - 1 : i + 1;
            if (to >= 0 && to < ids.length) {
              onMove(i, to);
              requestAnimationFrame(() => document.querySelectorAll<HTMLElement>(".su-grid .su-cell")[to]?.focus());
            }
          }}
          tabIndex={0}
          aria-label={`Slide ${i + 1}${group.has(id) ? ", grouped" : ""}${picked.has(id) ? ", selected" : ""}`}
          aria-keyshortcuts="Space Alt+ArrowLeft Alt+ArrowRight"
        >
          <div className="su-thumb">
            <Thumb slide={draft.slides[id]} />
            <button
              type="button"
              className="su-remove"
              aria-label={`Remove slide ${i + 1}`}
              data-tip="Remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(id);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
          <span className="su-label">{label(i) && <span className="su-n">{label(i)}</span>}</span>
        </li>
      ))}
    </ol>
  );
}

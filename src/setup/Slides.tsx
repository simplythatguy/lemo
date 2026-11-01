// Step 1: the slides. Drop a PDF or PowerPoint anywhere (or choose one); a grid of the rendered slides to reorder and prune.
import { useRef, useState } from "react";
import { Icon } from "./icons";
import { order, type Draft } from "./draft";
import { Thumb } from "./Thumb";

export const ACCEPT = ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** A file being rendered: its slides so far, out of `total` once known. */
export interface Importing {
  name: string;
  total: number | null;
  done: string[];
}

export function Slides({ draft, importing, error, onFile, onRemove, onMove }: {
  draft: Draft;
  importing: Importing | null;
  error: string | null;
  onFile(file: File): void;
  onRemove(id: string): void;
  onMove(from: number, to: number): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const ids = order(draft);
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
      <div className="su-empty">
        {picker}
        <span className="su-empty-icon"><Icon name="upload" size={28} stroke={1.6} /></span>
        <h1 className="su-title">Add your slides</h1>
        <button type="button" className="cf-btn is-primary is-lg" onClick={pick}>Choose a file</button>
        {error ? <p className="su-error" role="alert">{error}</p> : <p className="su-quiet">PDF or PowerPoint · 16:9</p>}
      </div>
    );
  }

  const count = importing ? importing.total ?? 0 : ids.length;
  const name = importing?.name ?? draft.file;
  const label = `${count} ${count === 1 ? "slide" : "slides"}`;
  return (
    <div className="su-slides">
      {picker}
      <div className="su-head">
        {name ? <h1 className="su-title is-sm">{name}</h1> : <h1 className="su-title is-sm">{label}</h1>}
        {name && count > 0 && <span className="su-quiet">{label}</span>}
        <span className="su-grow" />
        <button type="button" className="cf-btn is-ghost is-sm" onClick={pick} disabled={!!importing}>
          <Icon name="upload" size={15} />Replace
        </button>
      </div>
      {error && <p className="su-error" role="alert">{error}</p>}
      {importing ? <Progress importing={importing} /> : <Grid draft={draft} ids={ids} onRemove={onRemove} onMove={onMove} />}
    </div>
  );
}

function Progress({ importing }: { importing: Importing }) {
  const total = importing.total ?? 0;
  const left = Math.max(0, total - importing.done.length);
  return (
    <>
      <div className="su-meter" role="progressbar" aria-label="Reading slides" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={importing.done.length}>
        <span style={{ transform: `scaleX(${total ? importing.done.length / total : 0})` }} />
      </div>
      <ol className="su-grid" aria-busy="true">
        {importing.done.map((src, i) => (
          <li key={i} className="su-cell">
            <div className="su-thumb"><img className="su-thumb-img" src={src} alt="" /></div>
            <span className="su-n">{i + 1}</span>
          </li>
        ))}
        {Array.from({ length: left || (total ? 0 : 3) }, (_, i) => (
          <li key={`w${i}`} className="su-cell">
            <div className="su-thumb is-wait" />
            <span className="su-n">{total ? importing.done.length + i + 1 : ""}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Grid({ draft, ids, onRemove, onMove }: { draft: Draft; ids: string[]; onRemove(id: string): void; onMove(from: number, to: number): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  /** Insertion point while dragging: the slide lands before position `at` (0…n). */
  const [at, setAt] = useState<number | null>(null);
  const end = () => {
    setDrag(null);
    setAt(null);
  };
  return (
    <ol className="su-grid">
      {ids.map((id, i) => (
        <li
          key={id}
          className={`su-cell${drag === i ? " is-dragging" : ""}${at === i && drag !== null ? " is-before" : ""}${at === i + 1 && drag !== null && i === ids.length - 1 ? " is-after" : ""}`}
          draggable
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
            if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
            e.preventDefault();
            const to = e.key === "ArrowLeft" ? i - 1 : i + 1;
            if (to >= 0 && to < ids.length) {
              onMove(i, to);
              requestAnimationFrame(() => document.querySelectorAll<HTMLElement>(".su-grid .su-cell")[to]?.focus());
            }
          }}
          tabIndex={0}
          aria-label={`Slide ${i + 1}`}
          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        >
          <div className="su-thumb">
            <Thumb slide={draft.slides[id]} />
            <button type="button" className="su-remove" aria-label={`Remove slide ${i + 1}`} title="Remove" onClick={() => onRemove(id)}>
              <Icon name="x" size={14} stroke={2.2} />
            </button>
          </div>
          <span className="su-n">{i + 1}</span>
        </li>
      ))}
    </ol>
  );
}

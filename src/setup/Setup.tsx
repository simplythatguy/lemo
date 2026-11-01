// Set up a presentation (/new) or edit a room's (/r/CODE/edit): slides, then the project, then the transcript; saving
// makes the room, uploads the images and stores the deck, then opens the room.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { roomApi, RoomError } from "../studio/room";
import { clock, deckMs } from "../studio/timing";
import { VIDEO_LIMIT_MS } from "../studio/types";
import { emptyDraft, fromDeck, moveSlide, removeSlide, replaceSlides, slidesMissing, teamMissing, titleMissing, toDeck, toggleCut, type Draft } from "./draft";
import { Icon } from "./icons";
import { importSlides, SlideFileError } from "./importSlides";
import { Project } from "./Project";
import { saveDraft } from "./save";
import { Script } from "./Script";
import { Slides, type Importing } from "./Slides";
import "./setup.css";

const STEPS = [
  { key: "slides", label: "Slides" },
  { key: "project", label: "Project" },
  { key: "script", label: "Script" },
] as const;
type Step = (typeof STEPS)[number]["key"];

type Load = { kind: "loading" } | { kind: "ready" } | { kind: "missing" } | { kind: "failed"; message: string };
type Saving = { done: number; total: number; error?: string } | null;

export function Setup({ code: editCode }: { code?: string }) {
  const editing = !!editCode;
  const [load, setLoad] = useState<Load>(editing ? { kind: "loading" } : { kind: "ready" });
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState<Step>("slides");
  const [importing, setImporting] = useState<Importing | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [show, setShow] = useState({ title: false, team: false });
  const [saving, setSaving] = useState<Saving>(null);
  const [fileOver, setFileOver] = useState(false);
  const [dirty, setDirty] = useState(false);
  const taken = useRef<Set<string>>(new Set());
  const room = useRef<string | null>(editCode ?? null);
  const urls = useRef<string[]>([]);
  const job = useRef<AbortController | null>(null);

  const setDraft = useCallback((update: (d: Draft) => Draft) => {
    setDraftState(update);
    setDirty(true);
  }, []);
  const makeUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  }, []);

  useEffect(() => () => {
    job.current?.abort();
    urls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // Edit: start from the room's deck, on the transcript when there is one.
  useEffect(() => {
    if (!editCode) return;
    const ctl = new AbortController();
    roomApi.get(editCode, ctl.signal).then(
      (r) => {
        taken.current = new Set(Object.keys(r.takes));
        if (r.deck) {
          setDraftState(fromDeck(r.deck));
          setStep("script");
        }
        setLoad({ kind: "ready" });
      },
      (e) => {
        if (ctl.signal.aborted) return;
        setLoad(e instanceof RoomError && e.status === 404 ? { kind: "missing" } : { kind: "failed", message: (e as Error).message });
      },
    );
    return () => ctl.abort();
  }, [editCode]);

  // Leaving with unsaved work asks first.
  useEffect(() => {
    if (!dirty || saving) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  const onFile = useCallback(
    async (file: File) => {
      job.current?.abort();
      const ctl = new AbortController();
      job.current = ctl;
      setFileError(null);
      const pics: { src: string; blob: Blob }[] = [];
      setImporting({ name: file.name, total: null, done: [] });
      try {
        await importSlides(file, {
          signal: ctl.signal,
          onCount: (n) => setImporting((s) => (s ? { ...s, total: n } : s)),
          onSlide: (i, blob) => {
            pics[i] = { src: makeUrl(blob), blob };
            setImporting((s) => (s ? { ...s, done: [...s.done, pics[i].src] } : s));
          },
        });
        if (ctl.signal.aborted) return;
        setDraft((d) => replaceSlides(d, pics, file.name));
      } catch (e) {
        if (ctl.signal.aborted) return;
        if (!(e instanceof SlideFileError)) console.error(e);
        setFileError(e instanceof SlideFileError ? e.message : "This file can't be read");
      } finally {
        if (job.current === ctl) {
          job.current = null;
          setImporting(null);
        }
      }
    },
    [makeUrl, setDraft],
  );

  // A file dropped anywhere on the slides step replaces the slides. Elsewhere a stray drop never opens the file.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      if (step === "slides" && !saving) setFileOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setFileOver(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = step === "slides" && !saving ? "copy" : "none";
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setFileOver(false);
      const f = e.dataTransfer?.files[0];
      if (f && step === "slides" && !saving) void onFile(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [step, saving, onFile]);

  const deck = useMemo(() => toDeck(draft), [draft]);
  const total = deck.groups.length ? deckMs(deck) : 0;
  const over = total > VIDEO_LIMIT_MS;

  /** The first step that still needs something, before `upTo`. */
  const blocker = (upTo: number): Step | null => {
    if (upTo > 0 && (slidesMissing(draft) || importing)) return "slides";
    if (upTo > 1 && (titleMissing(draft) || teamMissing(draft))) return "project";
    return null;
  };
  const go = (to: Step) => {
    const i = STEPS.findIndex((s) => s.key === to);
    const stop = blocker(i);
    if (stop === "project") setShow({ title: titleMissing(draft), team: teamMissing(draft) });
    if (stop === "slides" && !importing && slidesMissing(draft)) setFileError(null);
    setStep(stop ?? to);
    window.scrollTo({ top: 0 });
  };

  const save = async () => {
    const stop = blocker(STEPS.length);
    if (stop) return go(stop);
    setSaving({ done: 0, total: 0 });
    try {
      const code = await saveDraft({
        draft,
        code: room.current,
        onRoom: (c) => (room.current = c),
        onUploaded: (next) => setDraftState(next),
        onProgress: (done, total) => setSaving({ done, total }),
      });
      location.assign(`/r/${code}`);
    } catch (e) {
      setSaving((s) => ({ done: s?.done ?? 0, total: s?.total ?? 0, error: (e as Error).message || "Couldn't save" }));
    }
  };

  const exit = editCode ? `/r/${editCode}` : "/";
  const index = STEPS.findIndex((s) => s.key === step);
  const last = index === STEPS.length - 1;

  if (load.kind !== "ready") {
    return (
      <div className="su-page">
        <div className="su-center">
          {load.kind === "loading" ? null : (
            <>
              <h1 className="su-title">{load.kind === "missing" ? `No room ${editCode}` : "Can't open this room"}</h1>
              {load.kind === "failed" && <p className="su-error">{load.message}</p>}
              <a className="cf-btn" href="/">Demos</a>
            </>
          )}
        </div>
      </div>
    );
  }

  if (saving) {
    const { done, total: n, error } = saving;
    return (
      <div className="su-page">
        <div className="su-center su-saving">
          <h1 className="su-title">{error ? "Not saved" : editing ? "Saving" : "Creating your room"}</h1>
          <div className="su-meter is-wide" role="progressbar" aria-label="Uploading" aria-valuemin={0} aria-valuemax={n || 1} aria-valuenow={done}>
            <span style={{ transform: `scaleX(${n ? done / n : error ? 0 : 0.04})` }} />
          </div>
          {error ? (
            <>
              <p className="su-error" role="alert">{error}</p>
              <div className="su-row-actions">
                <button type="button" className="cf-btn" onClick={() => setSaving(null)}>Back</button>
                <button type="button" className="cf-btn is-primary" onClick={() => void save()}>Try again</button>
              </div>
            </>
          ) : (
            <p className="su-quiet">{n ? `${done} / ${n}` : " "}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`su-page${fileOver ? " is-file-over" : ""}`}>
      <header className="su-top">
        <a
          className="cf-icon-btn is-plain"
          href={exit}
          aria-label={editing ? "Back to the room" : "Close"}
          title={editing ? "Back to the room" : "Close"}
          onClick={(e) => {
            if (dirty && !confirm(editing ? "Leave without saving?" : "Discard this demo?")) e.preventDefault();
            else setDirty(false);
          }}
        >
          <Icon name={editing ? "back" : "x"} size={18} />
        </a>
        <nav className="su-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s.key} type="button" className={`su-step${i === index ? " is-now" : ""}${i < index ? " is-done" : ""}`} aria-current={i === index ? "step" : undefined} onClick={() => go(s.key)}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="su-top-end">
          {last && total > 0 && (
            <span className={`su-total${over ? " is-over" : ""}`} title={over ? "Longer than 5:00" : "Video length"} aria-label={`Video length ${clock(total)}${over ? ", longer than 5:00" : ""}`}>
              <Icon name="clock" size={14} />
              {clock(total)}
              {over && <span className="su-total-of">/ {clock(VIDEO_LIMIT_MS)}</span>}
            </span>
          )}
          {last || editing ? (
            <button type="button" className="cf-btn is-primary" onClick={() => void save()} disabled={!!importing}>
              {editing ? "Save" : "Create"}
            </button>
          ) : (
            <button type="button" className="cf-btn is-primary" onClick={() => go(STEPS[index + 1].key)} disabled={step === "slides" && (slidesMissing(draft) || !!importing)}>
              Next<Icon name="arrow" size={15} />
            </button>
          )}
        </div>
      </header>

      <main className="su-main">
        {step === "slides" && (
          <Slides
            draft={draft}
            importing={importing}
            error={fileError}
            onFile={(f) => void onFile(f)}
            onRemove={(id) => setDraft((d) => removeSlide(d, id))}
            onMove={(from, to) => setDraft((d) => moveSlide(d, from, to))}
          />
        )}
        {step === "project" && <Project draft={draft} setDraft={setDraft} show={show} makeUrl={makeUrl} />}
        {step === "script" && (
          <Script
            draft={draft}
            deck={deck}
            onCut={(at) => setDraft((d) => toggleCut(d, at, taken.current))}
            onSay={(id, text) => setDraft((d) => ({ ...d, script: { ...d.script, [id]: text } }))}
          />
        )}
      </main>
      {fileOver && (
        <div className="su-drop" aria-hidden="true">
          <span><Icon name="upload" size={28} stroke={1.6} /></span>
        </div>
      )}
    </div>
  );
}

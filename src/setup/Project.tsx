// Step 2: the project's name, logo and team, as the intro and outro cards show them.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { ProjectMark } from "../studio/parts";
import { limitInvalid, removeMember, type Draft, type Pic } from "./draft";
import { squareLogo } from "./logo";

/** The logo's side, in px: the height of the project's label and name beside it. */
const LOGO = 76;
export function Project({ draft, setDraft, show, makeUrl }: {
  draft: Draft;
  setDraft(update: (d: Draft) => Draft): void;
  /** Problems to show, after a Next that could not go on. */
  show: { title: boolean; team: boolean; limit: boolean };
  makeUrl(blob: Blob): string;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const limitInput = useRef<HTMLInputElement>(null);
  const [limitText, setLimitText] = useState(() => draft.limitMs == null ? "" : String(draft.limitMs / 60_000));
  const [logoError, setLogoError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const names = useRef<(HTMLInputElement | null)[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const logoPick = useRef(0);

  useEffect(() => {
    if (focus === null) return;
    names.current[focus]?.focus();
    setFocus(null);
  }, [focus]);
  useEffect(() => {
    if (show.title) titleRef.current?.focus();
    else if (show.team) names.current[0]?.focus();
    else if (show.limit) limitInput.current?.focus();
  }, [show]);

  const named = !!draft.title.trim();
  const setLogo = (logo: Pic | null) => setDraft((d) => ({ ...d, logo }));
  const removeLogo = () => {
    logoPick.current++;
    setLogo(null);
  };
  const addMember = (after: number) => {
    setDraft((d) => ({ ...d, team: [...d.team.slice(0, after + 1), "", ...d.team.slice(after + 1)] }));
    setFocus(after + 1);
  };

  return (
    <div className="su-project">
      <div className="su-name-row">
        <div className="su-logo">
          <button
            type="button"
            className={`su-logo-pick${draft.logo ? " has-logo" : named ? "" : " is-blank"}`}
            onClick={() => logoInput.current?.click()}
            aria-label={draft.logo ? "Change logo" : "Add logo"}
            data-tip={draft.logo ? "Change logo" : "Add logo"}
          >
            <ProjectMark title={draft.title} logo={draft.logo?.src} size={LOGO} />
            {!draft.logo && (
              <span className={`su-logo-add${named ? "" : " is-alone"}`} aria-hidden="true">
                <Icon name="plus" size={named ? 12 : 28} />
              </span>
            )}
          </button>
          {draft.logo && (
            <button type="button" className="su-logo-x" aria-label="Remove logo" data-tip="Remove logo" onClick={removeLogo}>
              <Icon name="x" size={12} />
            </button>
          )}
          <input
            ref={logoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            hidden
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!f) return;
              // Only the last logo picked lands, whichever finishes first.
              const pick = ++logoPick.current;
              try {
                const blob = await squareLogo(f);
                if (pick !== logoPick.current) return;
                setLogoError(null);
                setLogo({ src: makeUrl(blob), blob });
              } catch (err) {
                if (pick === logoPick.current) setLogoError((err as Error).message);
              }
            }}
          />
        </div>
        <label className="su-field is-title">
          <span>Project</span>
          <input
            ref={titleRef}
            value={draft.title}
            maxLength={80}
            placeholder="Name"
            aria-invalid={show.title && !draft.title.trim()}
            onChange={(e) => {
              const title = e.currentTarget.value;
              setDraft((d) => ({ ...d, title }));
            }}
          />
          {show.title && !draft.title.trim() && <em className="su-error">Add a name</em>}
        </label>
      </div>
      {logoError && <p className="su-error" role="alert">{logoError}</p>}

      <fieldset className="su-team">
        <legend>Team</legend>
        <ol>
          {draft.team.map((name, i) => (
            <li key={i}>
              <input
                ref={(el) => {
                  names.current[i] = el;
                }}
                value={name}
                maxLength={60}
                placeholder="Name"
                aria-label={`Team member ${i + 1}`}
                aria-invalid={show.team && i === 0 && !draft.team.some((t) => t.trim())}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setDraft((d) => ({ ...d, team: d.team.map((t, j) => (j === i ? v : t)) }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (name.trim()) addMember(i);
                  } else if (e.key === "Backspace" && !name && draft.team.length > 1) {
                    e.preventDefault();
                    setDraft((d) => removeMember(d, i));
                    setFocus(Math.max(0, i - 1));
                  }
                }}
              />
              {draft.team.length > 1 && (
                <button type="button" className="icon-btn is-sm" aria-label={`Remove ${name || `member ${i + 1}`}`} data-tip="Remove" onClick={() => setDraft((d) => removeMember(d, i))}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </li>
          ))}
        </ol>
        {show.team && !draft.team.some((t) => t.trim()) && <em className="su-error">Add at least one name</em>}
        <button type="button" className="btn is-quiet is-sm su-add" onClick={() => addMember(draft.team.length - 1)} disabled={draft.team.length >= 12}>
          <Icon name="plus" size={16} />Add
        </button>
      </fieldset>

      <label className="su-field">
        <span>Time limit (minutes)</span>
        <input
          ref={limitInput}
          inputMode="decimal"
          aria-label="Time limit in minutes"
          aria-invalid={show.limit && limitInvalid(draft)}
          aria-describedby={show.limit && limitInvalid(draft) ? "su-limit-error" : undefined}
          placeholder="No limit"
          value={limitText}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setLimitText(v);
            const ms = Math.round(Number(v) * 60_000);
            setDraft((d) => ({ ...d, limitMs: !v.trim() ? null : Number.isSafeInteger(ms) && ms >= 1000 ? ms : 0 }));
          }}
        />
        {show.limit && limitInvalid(draft) && <em id="su-limit-error" className="su-error" role="alert">Enter at least one second, or leave blank</em>}
      </label>
    </div>
  );
}

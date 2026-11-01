// Step 2: the project's name, logo and team, as the intro and outro cards show them.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { removeMember, type Draft, type Pic } from "./draft";
import { squareLogo } from "./logo";

export function Project({ draft, setDraft, show, makeUrl }: {
  draft: Draft;
  setDraft(update: (d: Draft) => Draft): void;
  /** Problems to show, after a Next that could not go on. */
  show: { title: boolean; team: boolean };
  makeUrl(blob: Blob): string;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const names = useRef<(HTMLInputElement | null)[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus === null) return;
    names.current[focus]?.focus();
    setFocus(null);
  }, [focus]);
  useEffect(() => {
    if (show.title) titleRef.current?.focus();
    else if (show.team) names.current[0]?.focus();
  }, [show]);

  const setLogo = (logo: Pic | null) => setDraft((d) => ({ ...d, logo }));
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
            className={`su-logo-pick${draft.logo ? " has-logo" : ""}`}
            onClick={() => logoInput.current?.click()}
            aria-label={draft.logo ? "Change logo" : "Add logo"}
            title={draft.logo ? "Change logo" : "Add logo"}
          >
            {draft.logo ? <img src={draft.logo.src} alt="" /> : <Icon name="image" size={24} stroke={1.6} />}
          </button>
          {draft.logo && (
            <button type="button" className="su-logo-x" aria-label="Remove logo" title="Remove logo" onClick={() => setLogo(null)}>
              <Icon name="x" size={12} stroke={2.4} />
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
              try {
                const blob = await squareLogo(f);
                setLogoError(null);
                setLogo({ src: makeUrl(blob), blob });
              } catch (err) {
                setLogoError((err as Error).message);
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
                <button type="button" className="cf-icon-btn is-xs" aria-label={`Remove ${name || `member ${i + 1}`}`} title="Remove" onClick={() => setDraft((d) => removeMember(d, i))}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </li>
          ))}
        </ol>
        {show.team && !draft.team.some((t) => t.trim()) && <em className="su-error">Add at least one name</em>}
        <button type="button" className="cf-btn is-ghost is-sm su-add" onClick={() => addMember(draft.team.length - 1)} disabled={draft.team.length >= 12}>
          <Icon name="plus" size={15} />Add
        </button>
      </fieldset>
    </div>
  );
}

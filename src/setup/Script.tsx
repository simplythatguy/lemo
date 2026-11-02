// Step 3: the transcript. Every group in order, each slide with what is said on it. Groups are made on the slides step.
import type { ReactNode } from "react";
import { clock, targetMs } from "../studio/timing";
import type { Deck } from "../studio/types";
import type { Draft } from "./draft";
import { Thumb } from "./Thumb";

export function Script({ draft, deck, length, onSay }: {
  draft: Draft;
  /** `draft` as a deck, for names and timings. */
  deck: Deck;
  /** The video length readout; on narrow screens it sits here instead of in the top bar. */
  length: ReactNode;
  onSay(slideId: string, text: string): void;
}) {
  let at = 0;
  return (
    <div className="su-script">
      <div className="su-head">
        <h1 className="su-title is-sm">{draft.title.trim() || "Script"}</h1>
        <span className="su-grow" />
        {length}
      </div>
      <ol className="su-groups">
        {draft.groups.map((g, gi) => {
          const group = deck.groups[gi];
          const first = at;
          at += g.slides.length;
          return (
            <li key={g.id} className="su-group" aria-label={group.name}>
              <div className="su-group-head">
                <h2>{group.name}</h2>
                <span className="su-time" aria-label={`About ${clock(targetMs(group))}`}>{clock(targetMs(group))}</span>
              </div>
              {g.slides.map((id, k) => (
                <div key={id} className="su-row">
                  <div className="su-thumb is-sm"><Thumb slide={draft.slides[id]} /></div>
                  <textarea
                    className="su-say"
                    value={draft.script[id] ?? ""}
                    placeholder="What you say on this slide"
                    aria-label={`Slide ${first + k + 1}: what you say`}
                    rows={3}
                    onChange={(e) => onSay(id, e.currentTarget.value)}
                  />
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

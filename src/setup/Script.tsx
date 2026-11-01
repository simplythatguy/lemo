// Step 3: the transcript. Every slide in order with what is said on it; a click between two slides cuts or joins groups.
import { clock, targetMs } from "../studio/timing";
import type { Deck } from "../studio/types";
import { Icon } from "./icons";
import type { Draft } from "./draft";
import { Thumb } from "./Thumb";

export function Script({ draft, deck, onCut, onSay }: {
  draft: Draft;
  /** `draft` as a deck, for names and timings. */
  deck: Deck;
  /** Toggle the cut after flat position `at`. */
  onCut(at: number): void;
  onSay(slideId: string, text: string): void;
}) {
  let at = 0;
  return (
    <ol className="su-script">
      {draft.groups.map((g, gi) => {
        const group = deck.groups[gi];
        const first = at;
        at += g.slides.length;
        return (
          <li key={g.id} className="su-group" aria-label={group.name}>
            {gi > 0 && <Gap cut at={first - 1} onCut={onCut} />}
            <div className="su-group-head">
              <h2>{group.name}</h2>
              <span className="su-time" aria-label={`About ${clock(targetMs(group))}`}>{clock(targetMs(group))}</span>
            </div>
            {g.slides.map((id, k) => (
              <div key={id} className="su-row-wrap">
                {k > 0 && <Gap cut={false} at={first + k - 1} onCut={onCut} />}
                <div className="su-row">
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
              </div>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

/** The space between two slides: a cut there splits the group, on a group's edge it joins the two. */
function Gap({ cut, at, onCut }: { cut: boolean; at: number; onCut(at: number): void }) {
  return (
    <div className={`su-gap${cut ? " is-cut" : ""}`}>
      <button
        type="button"
        className="su-gap-btn"
        onClick={() => onCut(at)}
        aria-label={cut ? `Join slides ${at + 1} and ${at + 2} into one group` : `New group from slide ${at + 2}`}
        title={cut ? "Join" : "Cut here"}
      >
        <Icon name={cut ? "link" : "scissors"} size={14} />
      </button>
    </div>
  );
}

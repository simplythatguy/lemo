// A state change as a view transition: the page cross-fades, and the slides named by `data-vt` glide from their old places
// to their new ones. At once where view transitions are missing or motion is reduced. Resolves once the DOM has changed.
import { flushSync } from "react-dom";

export function glide(change: () => void): Promise<void> {
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    flushSync(change);
    return Promise.resolve();
  }
  // Names only for this transition, so a step change stays one cross-fade.
  const named = () => document.querySelectorAll<HTMLElement>(".su-grid [data-vt]");
  named().forEach((el) => (el.style.viewTransitionName = el.dataset.vt!));
  const t = document.startViewTransition(() => flushSync(change));
  void t.finished.finally(() => named().forEach((el) => (el.style.viewTransitionName = "")));
  return t.updateCallbackDone;
}

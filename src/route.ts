// Page switches without reloading the document: a reload blanks the screen until the next page's code arrives.
// The route changes inside a transition, so the current page stays up until the next one can render.
import { startTransition, useEffect, useLayoutEffect, useState } from "react";

const listeners = new Set<() => void>();
let shown = location.pathname;
let leaveGuard: string | null = null;

function show() {
  shown = location.pathname;
  for (const listener of listeners) listener();
}

export function navigate(to: string) {
  history.pushState(null, "", to);
  show();
}

/** While set, the browser's Back and Forward ask with this message before leaving the page. */
export function setLeaveGuard(message: string | null) {
  leaveGuard = message;
}

function followLink(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
  if (a.pathname.startsWith("/api/")) return;
  e.preventDefault();
  if (a.pathname + a.search !== location.pathname + location.search) navigate(a.pathname + a.search);
}

function traverse() {
  if (location.pathname === shown) return;
  if (leaveGuard && !confirm(leaveGuard)) return history.pushState(null, "", shown);
  leaveGuard = null;
  show();
}

document.addEventListener("click", followLink);
window.addEventListener("popstate", traverse);

export function usePath() {
  const [path, setPath] = useState(shown);
  useEffect(() => {
    const sync = () => startTransition(() => setPath(shown));
    listeners.add(sync);
    return () => void listeners.delete(sync);
  }, []);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return path;
}

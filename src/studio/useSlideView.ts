import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./slideView.css";

export function useSlideView() {
  const host = useRef<HTMLDivElement>(null);
  const native = useRef(false);
  const wanted = useRef(false);
  const launcher = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);
  const [full, setFull] = useState(false);
  const [awake, setAwake] = useState(true);
  const restoreFocus = useCallback(() => {
    if (!wanted.current && launcher.current?.isConnected) launcher.current.focus({ preventScroll: true });
  }, []);

  const wake = useCallback(() => {
    setAwake(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAwake(false), 2500);
  }, []);

  const enter = () => {
    const el = host.current;
    if (!el) return;
    launcher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    native.current = document.fullscreenElement === el;
    wanted.current = true;
    setFull(true);
    // The viewport view remains usable when the browser cannot grant native fullscreen.
    void el.requestFullscreen?.().catch(() => undefined);
  };
  const leave = useCallback(() => {
    wanted.current = false;
    native.current = false;
    setFull(false);
  }, []);

  useEffect(() => {
    const changed = () => {
      if (host.current && document.fullscreenElement === host.current) {
        if (wanted.current) native.current = true;
        else void document.exitFullscreen().catch(() => undefined).then(restoreFocus);
      }
      else if (native.current) {
        native.current = false;
        wanted.current = false;
        setFull(false);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [restoreFocus]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!full || !el) return;
    const outside: { el: HTMLElement; inert: boolean }[] = [];
    for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        outside.push({ el: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
    }
    el.focus({ preventScroll: true });
    wake();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // The camera picker gets the first Escape; leaving the view never discards a take.
        if (el.querySelector(".st-spots")) return;
        e.preventDefault();
        e.stopPropagation();
        leave();
      } else if (e.key === "Tab") {
        wake();
        const buttons = [...el.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex='0']")].filter((b) => b.getClientRects().length);
        const first = buttons[0], last = buttons.at(-1);
        if (!el.contains(document.activeElement) || document.activeElement === el || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => {
      wanted.current = false;
      native.current = false;
      window.removeEventListener("keydown", keys, true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      for (const item of outside) item.el.inert = item.inert;
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => undefined).then(restoreFocus);
      else restoreFocus();
    };
  }, [full, leave, restoreFocus, wake]);

  return { host, full, awake, enter, leave, wake };
}

// One tooltip for every control with a data-tip: it shows on mouse hover and on keyboard focus (a native title
// shows on neither touch nor focus). It sits in the top layer, so no overflow container or modal clips or covers it.
import { useEffect, useRef } from "react";

const HOVER_DELAY_MS = 450;
const GAP = 8;
const EDGE = 8;

export function Tooltip() {
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = tip.current!;
    let target: HTMLElement | null = null;
    let timer = 0;
    // The control just pressed: its tip stays away until the mouse leaves it.
    let pressed: HTMLElement | null = null;
    // Moving from one control to the next while a tip is showing swaps it at once instead of waiting again.
    let warmUntil = 0;

    const place = (t: HTMLElement) => {
      const a = t.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const below = a.bottom + GAP + b.height <= innerHeight - EDGE;
      el.style.top = `${below ? a.bottom + GAP : a.top - GAP - b.height}px`;
      el.style.left = `${Math.min(Math.max(a.left + a.width / 2 - b.width / 2, EDGE), innerWidth - EDGE - b.width)}px`;
    };
    const open = (t: HTMLElement) => {
      const text = t.dataset.tip;
      if (!text || !t.isConnected) return;
      el.textContent = text;
      if (!el.matches(":popover-open")) el.showPopover();
      place(t);
    };
    const show = (t: HTMLElement, delay: number) => {
      clearTimeout(timer);
      target = t;
      if (delay) timer = window.setTimeout(() => open(t), delay);
      else open(t);
    };
    const hide = () => {
      clearTimeout(timer);
      if (el.matches(":popover-open")) {
        el.hidePopover();
        warmUntil = performance.now() + 300;
      }
      target = null;
    };
    const tipOf = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>("[data-tip]") : null);

    // On a move, not on pointerover: a control that slides under a mouse that never moved (the layout changed after a
    // click) gets a pointerover too, and its tip would open for nobody.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const t = tipOf(e.target);
      if (t === target || t === pressed) return;
      pressed = null;
      if (!t) return hide();
      show(t, performance.now() < warmUntil || el.matches(":popover-open") ? 0 : HOVER_DELAY_MS);
    };
    const onOut = (e: PointerEvent) => {
      if (target && !(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))) hide();
    };
    const onDown = (e: PointerEvent) => {
      hide();
      pressed = tipOf(e.target);
    };
    const onFocus = (e: FocusEvent) => {
      const t = tipOf(e.target);
      if (t && t.matches(":focus-visible")) show(t, 0);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", hide, true);
    addEventListener("scroll", hide, true);
    addEventListener("resize", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", hide, true);
      removeEventListener("scroll", hide, true);
      removeEventListener("resize", hide);
    };
  }, []);

  return <div ref={tip} className="tip" popover="manual" aria-hidden="true" />;
}

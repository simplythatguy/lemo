// The one row of playback controls under a video: play or pause, the track, the time, then the caller's own actions.
import type { ReactNode } from "react";
import { Icon } from "../icons";
import { clock } from "./timing";
import "./transport.css";

export function Transport({ length, elapsed, paused, ready, onToggle, onSeek, children }: {
  length: number;
  elapsed: number;
  paused: boolean;
  ready: boolean;
  onToggle(): void;
  onSeek(ms: number): void;
  children?: ReactNode;
}) {
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(length, Math.max(0, ((e.clientX - r.left) / r.width) * length)));
  };
  const at = length ? Math.min(1, elapsed / length) : 0;
  return (
    <div className="st-transport">
      <button type="button" className="icon-btn" onClick={onToggle} disabled={!ready} aria-label={paused ? "Play" : "Pause"} data-tip={paused ? "Play" : "Pause"}>
        <Icon name={paused ? "play" : "pause"} size={16} />
      </button>
      <div
        className="st-transport-track"
        role="slider"
        tabIndex={ready ? 0 : -1}
        aria-label="Seek"
        aria-disabled={!ready}
        aria-valuemin={0}
        aria-valuemax={Math.round(length / 1000)}
        aria-valuenow={Math.round(elapsed / 1000)}
        aria-valuetext={`${clock(elapsed)} of ${clock(length)}`}
        onPointerDown={(e) => {
          if (!ready) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && seek(e)}
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" ? 5000 : e.key === "ArrowLeft" ? -5000 : 0;
          if (!step) return;
          e.preventDefault();
          onSeek(Math.min(length, Math.max(0, elapsed + step)));
        }}
      >
        <span className="st-transport-fill" style={{ transform: `scaleX(${at})` }} />
        <span className="st-transport-thumb" style={{ left: `${at * 100}%` }} />
      </div>
      <span className="st-transport-time">{clock(elapsed)}<span> / {clock(length)}</span></span>
      {children}
    </div>
  );
}

// Home (/): this device's demos, newest first. A row opens its room; a room the server no longer has drops out.
import { useEffect, useState } from "react";
import { forgetRoom, knownRooms, RoomError, roomApi, validCode, type KnownRoom } from "../studio/room";
import { clock, deckMs } from "../studio/timing";
import type { RoomState } from "../studio/types";
import { Icon } from "../setup/icons";
import "./home.css";

type Row = { code: string; seenAt: number; room?: RoomState; offline?: boolean };

export function Home() {
  const [rows, setRows] = useState<Row[]>(() => knownRooms().map((r: KnownRoom) => ({ ...r })));

  useEffect(() => {
    const ctl = new AbortController();
    for (const { code } of knownRooms()) {
      roomApi.get(code, ctl.signal).then(
        (room) => setRows((rs) => rs.map((r) => (r.code === code ? { ...r, room, offline: false } : r))),
        (e) => {
          if (ctl.signal.aborted) return;
          if (e instanceof RoomError && e.status === 404) {
            forgetRoom(code);
            setRows((rs) => rs.filter((r) => r.code !== code));
          } else {
            setRows((rs) => rs.map((r) => (r.code === code ? { ...r, offline: true } : r)));
          }
        },
      );
    }
    return () => ctl.abort();
  }, []);

  const empty = rows.length === 0;
  return (
    <div className="hm-page">
      <header className="hm-top">
        <h1 className="hm-title">Demos</h1>
        <Join />
        {!empty && (
          <a className="cf-btn is-primary is-sm" href="/new">
            <Icon name="plus" size={15} />New
          </a>
        )}
      </header>
      {empty ? (
        <div className="hm-empty">
          <a className="cf-btn is-primary is-lg" href="/new">
            <Icon name="plus" size={17} />New demo
          </a>
        </div>
      ) : (
        <ul className="hm-list">
          {rows.map((r) => (
            <li key={r.code}>
              <RoomRow row={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RoomRow({ row }: { row: Row }) {
  const deck = row.room?.deck ?? null;
  const first = deck?.groups[0]?.slides[0];
  const cover = first && (first.kind === "page" || first.kind === "image") ? first.src : null;
  const slides = deck ? deck.groups.reduce((n, g) => n + g.slides.length, 0) : 0;
  const people = row.room?.people.length ?? 0;
  const title = deck?.title || (row.room ? "Untitled" : row.code);
  const line = row.offline
    ? "Offline"
    : !row.room
      ? " "
      : deck && slides
        ? `${slides} ${slides === 1 ? "slide" : "slides"} · ${clock(deckMs(deck))}`
        : "No slides yet";
  return (
    <a className={`hm-row${row.room ? "" : " is-wait"}`} href={`/r/${row.code}`} aria-label={`${title}${people ? `, ${people} joined` : ""}`}>
      <span className="hm-cover">{cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : deck?.title ? <b>{deck.title.trim().charAt(0).toUpperCase()}</b> : null}</span>
      <span className="hm-text">
        <span className="hm-name">{title}</span>
        <span className="hm-line">{line}</span>
      </span>
      {people > 0 && (
        <span className="hm-count">
          <b>{people}</b>
          <span>joined</span>
        </span>
      )}
    </a>
  );
}

/** A room code typed in opens that room. */
function Join() {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const go = () => {
    const c = code.trim().toUpperCase();
    if (!validCode(c)) return setBad(true);
    location.assign(`/r/${c}`);
  };
  return (
    <form
      className={`hm-join${bad ? " is-bad" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <input
        value={code}
        onChange={(e) => {
          setCode(e.currentTarget.value.replace(/[^a-z0-9]/gi, "").slice(0, 6));
          setBad(false);
        }}
        placeholder="Code"
        aria-label="Room code"
        aria-invalid={bad}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      <button type="submit" className="cf-icon-btn is-xs" aria-label="Join" title="Join" disabled={!code}>
        <Icon name="arrow" size={15} />
      </button>
    </form>
  );
}

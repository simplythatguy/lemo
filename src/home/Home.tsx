// Home (/): this device's demos, newest first, as a grid of their first slides. A cover opens its room; a room the server
// no longer has drops out.
import { useEffect, useRef, useState } from "react";
import { forgetRoom, knownRooms, RoomError, roomApi, validCode } from "../studio/room";
import { clock } from "../studio/timing";
import type { Deck, RoomState, TakeInfo } from "../studio/types";
import { Icon } from "../icons";
import { navigate } from "../route";
import { ProjectMark } from "../studio/parts";
import { thumbSize } from "../studio/format";
import "./home.css";

type Row = { code: string } & ({ state: "loading" } | { state: "offline" } | { state: "ready"; room: RoomState });

export function Home() {
  const [rows, setRows] = useState<Row[]>(() => knownRooms().map(({ code }) => ({ code, state: "loading" })));

  useEffect(() => {
    const ctl = new AbortController();
    const set = (code: string, row: Row | null) =>
      setRows((rs) => (row ? rs.map((r) => (r.code === code ? row : r)) : rs.filter((r) => r.code !== code)));
    for (const { code } of knownRooms()) {
      roomApi.get(code, ctl.signal).then(
        (room) => {
          rememberTitle(code, room.deck?.title.trim() ?? "");
          set(code, { code, state: "ready", room });
        },
        (e) => {
          if (ctl.signal.aborted) return;
          if (e instanceof RoomError && e.status === 404) {
            forgetRoom(code);
            set(code, null);
          } else {
            set(code, { code, state: "offline" });
          }
        },
      );
    }
    return () => ctl.abort();
  }, []);

  if (rows.length === 0) {
    return (
      <div className="hm-page is-empty">
        <h1 className="hm-title">Demos</h1>
        <a className="btn is-primary is-lg" href="/new">
          <Icon name="plus" size={16} />New demo
        </a>
        <Join />
      </div>
    );
  }
  return (
    <div className="hm-page">
      <header className="hm-top">
        <h1 className="hm-title">Demos</h1>
        <Join />
        <a className="btn is-primary hm-new" href="/new">
          <Icon name="plus" size={16} />
          <span>
            New<span className="hm-new-more"> demo</span>
          </span>
        </a>
      </header>
      <ul className="hm-grid">
        {rows.map((r) => (
          <li key={r.code}>
            <Card row={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The last title each demo had here, so one the server can't reach still goes by its name. */
const TITLES_KEY = "lemo.home.titles";
function titles(): Record<string, string> {
  try {
    const t = JSON.parse(localStorage.getItem(TITLES_KEY) ?? "{}");
    return t && typeof t === "object" ? t : {};
  } catch {
    return {};
  }
}
function rememberTitle(code: string, title: string) {
  const t = titles();
  if (t[code] === title) return;
  if (title) t[code] = title;
  else delete t[code];
  localStorage.setItem(TITLES_KEY, JSON.stringify(t));
}

const complete = (t: TakeInfo | undefined) => !!t && t.received >= t.chunks;

/** "8 slides · 1:08 · 2 of 3 recorded": the recorded part only once something is. */
function meta(room: RoomState): string {
  const deck = room.deck;
  const slides = deck ? deck.groups.reduce((n, g) => n + g.slides.length, 0) : 0;
  if (!deck || !slides) return "No slides yet";
  const duration = deck.groups.reduce((n, g) => n + (complete(room.takes[g.id]) ? room.takes[g.id].durationMs : 0), 0);
  const parts = [`${slides} ${slides === 1 ? "slide" : "slides"}`];
  if (duration) parts.push(`${clock(duration)} recorded`);
  const recorded = deck.groups.filter((g) => complete(room.takes[g.id])).length;
  if (recorded === deck.groups.length) parts.push("All recorded");
  else if (recorded) parts.push(`${recorded} of ${deck.groups.length} recorded`);
  return parts.join(" · ");
}

function Card({ row }: { row: Row }) {
  if (row.state === "loading") {
    return (
      <div className="hm-card is-wait" role="status" aria-label="Loading">
        <span className="hm-cover" />
        <span className="hm-name" />
        <span className="hm-line" />
      </div>
    );
  }
  const room = row.state === "ready" ? row.room : null;
  const deck = room?.deck;
  const title = (room ? deck?.title.trim() : titles()[row.code]) || "Untitled";
  return (
    <a className="hm-card" href={`/r/${row.code}`}>
      {deck?.groups[0]?.slides[0] ? (
        <span className="hm-cover">
          <Cover deck={deck} />
        </span>
      ) : (
        <span className="hm-cover is-blank">
          {!room ? (
            <Icon name="offline" size={28} />
          ) : deck?.title.trim() || deck?.logo ? (
            <ProjectMark title={deck.title} logo={deck.logo} size={56} />
          ) : (
            <Icon name="slides" size={28} />
          )}
        </span>
      )}
      <span className="hm-name">{title}</span>
      <span className="hm-line">{room ? meta(room) : "Offline"}</span>
    </a>
  );
}

/** The deck's first slide: the uploaded page itself, or painted by the stage for any other kind. */
function Cover({ deck }: { deck: Deck }) {
  const first = deck.groups[0].slides[0];
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const size = thumbSize(deck, 640);
    c.width = size.width;
    c.height = size.height;
    void import("../studio/stage").then((m) => m.renderThumb(c, deck, 0, 0)).catch(() => undefined);
  }, [deck]);
  if (first.kind === "page") return <img src={first.src} alt="" loading="lazy" decoding="async" />;
  return <canvas ref={canvas} aria-hidden="true" />;
}

/** A room code typed in opens that room. */
function Join() {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const go = () => {
    const c = code.trim().toUpperCase();
    if (!validCode(c)) return setBad(true);
    navigate(`/r/${c}`);
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
        placeholder="Room code"
        aria-label="Room code"
        aria-invalid={bad}
        aria-describedby={bad ? "hm-join-error" : undefined}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      <button type="submit" className="icon-btn is-sm" aria-label="Join" data-tip="Join" disabled={!code}>
        <Icon name="arrow" size={16} />
      </button>
      {bad && (
        <p id="hm-join-error" className="hm-join-error" role="alert">
          {code.length < 6 ? "Codes have 6 characters" : "Not a room code"}
        </p>
      )}
    </form>
  );
}

// Room API client (docs/api.md, server/) and the 2-second room poll.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Cue, Deck, HeardLive, LiveState, Person, RoomState, TakeInfo } from "./types";

export const API = "/api";
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
export const validCode = (code: string) => CODE.test(code);

export const CHUNK_BYTES = 3 * 1024 * 1024;
export const chunkCount = (size: number) => Math.max(1, Math.ceil(size / CHUNK_BYTES));

export class RoomError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}


async function send(method: string, path: string, init: { json?: unknown; body?: BodyInit; type?: string; signal?: AbortSignal } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      signal: init.signal,
      headers: init.json !== undefined ? { "Content-Type": "application/json" } : init.body ? { "Content-Type": init.type ?? "application/octet-stream" } : {},
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new RoomError(0, "No connection");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* keep statusText */
    }
    throw new RoomError(res.status, detail || `Error ${res.status}`);
  }
  return res;
}

const json = async <T>(p: Promise<Response>) => (await (await p).json()) as T;
const enc = encodeURIComponent;
const base = (code: string) => `/rooms/${enc(code)}`;

/** Files a room holds (slide images, the logo) are served from here. */
export const fileUrl = (code: string, id: string) => `${API}${base(code)}/files/${enc(id)}`;

/** Largest file the server takes in one request (slide images, logos). */
export const FILE_MAX_BYTES = 4 * 1024 * 1024;

export const roomApi = {
  /** A new room with a fresh code. */
  create: () => json<RoomState>(send("POST", "/rooms", { json: {} })),
  /** Opens the room called `code`, making it the first time. */
  open: (code: string) => json<RoomState>(send("POST", "/rooms", { json: { code } })),
  /** Replaces the room's presentation. */
  putDeck: (code: string, deck: Deck) => json<RoomState>(send("PUT", `${base(code)}/deck`, { json: deck })),
  /** Stores an image (image/png, image/jpeg or image/webp, at most FILE_MAX_BYTES) and returns its URL. */
  uploadFile: async (code: string, file: Blob) => {
    const { id } = await json<{ id: string }>(send("POST", `${base(code)}/files`, { body: file, type: file.type }));
    return fileUrl(code, id);
  },
  /** Publishes the take I am recording, or null when it ends. */
  live: (code: string, personId: string, live: LiveState | null) =>
    send("PUT", `${base(code)}/live?person=${enc(personId)}`, { json: live }),
  get: (code: string, signal?: AbortSignal) => json<RoomState>(send("GET", base(code), { signal })),
  join: (code: string, name: string) => json<Person>(send("POST", `${base(code)}/people`, { json: { name } })),
  leave: (code: string, personId: string) => json<RoomState>(send("DELETE", `${base(code)}/people/${enc(personId)}`)),
  assign: (code: string, groupId: string, personId: string | null) =>
    json<RoomState>(send("PUT", `${base(code)}/assignments/${enc(groupId)}`, { json: { personId } })),
  startTake: (code: string, body: { groupId: string; personId: string; durationMs: number; cues: Cue[]; mime: string; size: number; chunks: number }) =>
    json<TakeInfo>(send("POST", `${base(code)}/takes`, { json: body })),
  putChunk: (code: string, takeId: string, i: number, data: Blob, signal?: AbortSignal) =>
    json<{ received: number }>(send("PUT", `${base(code)}/takes/${enc(takeId)}/chunks/${i}`, { body: data, signal })),
  getChunk: async (code: string, takeId: string, i: number, signal?: AbortSignal) =>
    (await send("GET", `${base(code)}/takes/${enc(takeId)}/chunks/${i}`, { signal })).blob(),
};

export type RoomStatus = { kind: "loading" } | { kind: "ready" } | { kind: "missing" } | { kind: "offline" };

/** Polls GET /api/rooms/{code} every 2 s, every second while someone records. `apply` takes the RoomState a
 *  mutation returned. `live` is the poll's take in progress, stamped with when this device heard it. */
export function useRoom(code: string | null) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [live, setLive] = useState<HeardLive | null>(null);
  const [status, setStatus] = useState<RoomStatus>({ kind: "loading" });
  const latest = useRef(0);
  const fast = useRef(false);

  const apply = useCallback((next: RoomState) => {
    if (next.updatedAt >= latest.current) {
      latest.current = next.updatedAt;
      setRoom(next);
    }
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!code) return;
    try {
      const next = await roomApi.get(code, signal);
      fast.current = !!next.live;
      setLive(next.live ? { ...next.live, seen: Date.now() } : null);
      latest.current = 0;
      apply(next);
      setStatus({ kind: "ready" });
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof RoomError && e.status === 404) setStatus({ kind: "missing" });
      else setStatus({ kind: "offline" });
    }
  }, [apply, code]);

  useEffect(() => {
    setRoom(null);
    setLive(null);
    setStatus({ kind: "loading" });
    latest.current = 0;
    if (!code) return;
    const ctl = new AbortController();
    let t = 0;
    const loop = async () => {
      await refresh(ctl.signal);
      if (!ctl.signal.aborted) t = window.setTimeout(() => void loop(), fast.current ? 1000 : 2000);
    };
    void loop();
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [code, refresh]);

  return { room, live, status, apply, refresh };
}

/** What this device remembers about a room: who joined here and with which devices. */
export interface Seat {
  personId?: string;
  name?: string;
  camId?: string;
  micId?: string;
}

const seatKey = (code: string) => `lemo.seat.${code}`;

export function loadSeat(code: string): Seat {
  try {
    return JSON.parse(localStorage.getItem(seatKey(code)) ?? "{}") as Seat;
  } catch {
    return {};
  }
}

export function saveSeat(code: string, seat: Seat) {
  localStorage.setItem(seatKey(code), JSON.stringify(seat));
}

/** Remembered across rooms so a new room starts with the same name and devices. */
export const lastSeat = (): Seat => loadSeat("last");
export const saveLastSeat = (seat: Seat) => saveSeat("last", { name: seat.name, camId: seat.camId, micId: seat.micId });

/** Rooms this device created or joined, newest first: the home list. */
export interface KnownRoom { code: string; seenAt: number }
const ROOMS_KEY = "lemo.rooms";

export function knownRooms(): KnownRoom[] {
  try {
    const list = JSON.parse(localStorage.getItem(ROOMS_KEY) ?? "[]") as KnownRoom[];
    return Array.isArray(list) ? list.filter((r) => validCode(r.code)).sort((a, b) => b.seenAt - a.seenAt) : [];
  } catch {
    return [];
  }
}

export function rememberRoom(code: string) {
  const rest = knownRooms().filter((r) => r.code !== code);
  localStorage.setItem(ROOMS_KEY, JSON.stringify([{ code, seenAt: Date.now() }, ...rest].slice(0, 50)));
}

export function forgetRoom(code: string) {
  localStorage.setItem(ROOMS_KEY, JSON.stringify(knownRooms().filter((r) => r.code !== code)));
}

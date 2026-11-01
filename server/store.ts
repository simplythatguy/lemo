// Lemo rooms. A room holds people, who presents each slide group, one recorded take per group, the deck
// and the images the deck shows.
// Takes arrive in fixed-size chunks so each request stays under the host's 4.5 MB body cap.
// Every write locks the room row first and bumps `updated_at`, which clients poll.
// Signals are the WebRTC handshake between two people's browsers: a per-room sequence orders them, readers poll
// by cursor, and nothing outlives ten minutes. They do not touch `updated_at`, so the room poll stays quiet.
// The live row is the take in progress (slide and timer), for people whose WebRTC link is down. The presenter
// refreshes it about once a second; a row older than LIVE_MS reads as nothing.
import { randomInt, randomUUID } from "node:crypto";
import { openDb, type Db, type Target, type Tx, type Value } from "./db.ts";

export const CHUNK_BYTES = 3 * 1024 * 1024;
export const TAKE_MAX_BYTES = 150 * 1024 * 1024;
export const ROOM_MAX_BYTES = 600 * 1024 * 1024;
export const FILE_MAX_BYTES = 4 * 1024 * 1024;
export const DECK_MAX_BYTES = 1024 * 1024;
export const MAX_PEOPLE = 12;
export const ROOM_MS = 14 * 24 * 60 * 60 * 1000;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const SIGNAL_KINDS = ["offer", "answer", "candidate", "bye"] as const;
export const SIGNAL_DATA_BYTES = 64 * 1024;
export const SIGNAL_MS = 10 * 60 * 1000;
export const SIGNAL_PAGE = 200;
export const ROOM_MAX_SIGNALS = 2000;
export const LIVE_MS = 10_000;

export type SignalKind = (typeof SIGNAL_KINDS)[number];
export interface Cue { slide: number; atMs: number }
export interface Person { id: string; name: string }
export interface LiveState { presenterId: string; groupId: string; slide: number; recording: boolean; remainingMs: number; targetMs: number; at: number }
export interface TakeInfo {
  id: string; groupId: string; personId: string; durationMs: number; cues: Cue[];
  mime: string; size: number; chunks: number; received: number; createdAt: number;
}
export interface RoomState {
  code: string; people: Person[]; assignments: Record<string, string>; takes: Record<string, TakeInfo>;
  updatedAt: number; deck: unknown; live: LiveState | null;
}
export interface NewTake { groupId: string; personId: string; durationMs: number; cues: Cue[]; mime: string; size: number; chunks: number }
export interface Signal { seq: number; from: string; kind: SignalKind; data: unknown; at: number }

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS studio_rooms (
    code TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deck_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS studio_people (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES studio_rooms(code) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    joined_at DOUBLE PRECISION NOT NULL,
    UNIQUE(room_code, name_key))`,
  `CREATE TABLE IF NOT EXISTS studio_assignments (
    room_code TEXT NOT NULL REFERENCES studio_rooms(code) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    person_id TEXT NOT NULL REFERENCES studio_people(id) ON DELETE CASCADE,
    PRIMARY KEY(room_code, group_id))`,
  `CREATE TABLE IF NOT EXISTS studio_takes (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES studio_rooms(code) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    duration_ms BIGINT NOT NULL,
    cues_json TEXT NOT NULL,
    mime TEXT NOT NULL,
    size BIGINT NOT NULL,
    chunks INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(room_code, group_id))`,
  `CREATE TABLE IF NOT EXISTS studio_chunks (
    take_id TEXT NOT NULL REFERENCES studio_takes(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    data BYTEA NOT NULL,
    PRIMARY KEY(take_id, idx))`,
  `CREATE TABLE IF NOT EXISTS studio_files (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES studio_rooms(code) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    size BIGINT NOT NULL,
    data BYTEA NOT NULL,
    created_at BIGINT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS studio_files_room ON studio_files(room_code)",
  `CREATE TABLE IF NOT EXISTS studio_signal_heads (
    room_code TEXT PRIMARY KEY REFERENCES studio_rooms(code) ON DELETE CASCADE,
    last BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS studio_signals (
    room_code TEXT NOT NULL REFERENCES studio_rooms(code) ON DELETE CASCADE,
    seq BIGINT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY(room_code, seq))`,
  "CREATE INDEX IF NOT EXISTS studio_signals_to ON studio_signals(room_code, to_id, seq)",
  "CREATE INDEX IF NOT EXISTS studio_signals_at ON studio_signals(at)",
  `CREATE TABLE IF NOT EXISTS studio_live (
    room_code TEXT PRIMARY KEY REFERENCES studio_rooms(code) ON DELETE CASCADE,
    person_id TEXT NOT NULL,
    data TEXT NOT NULL,
    stored_at BIGINT NOT NULL)`,
];

export const normalCode = (code: string) => code.trim().toUpperCase();
export const validCode = (code: string) => code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
export const expectedChunks = (size: number) => Math.ceil(size / CHUNK_BYTES);
const chunkLength = (size: number, chunks: number, index: number) =>
  index === chunks - 1 ? size - CHUNK_BYTES * (chunks - 1) : CHUNK_BYTES;
const hex = () => randomUUID().replaceAll("-", "");

export interface StoreOptions {
  /** Milliseconds since the epoch, fractional; tests move it. */
  now?: () => number;
  roomMaxBytes?: number;
}

export class Store {
  readonly db: Db;
  private readonly now: () => number;
  private readonly roomMaxBytes: number;

  private constructor(db: Db, options: StoreOptions) {
    this.db = db;
    this.now = options.now ?? (() => performance.timeOrigin + performance.now());
    this.roomMaxBytes = options.roomMaxBytes ?? ROOM_MAX_BYTES;
  }

  static async open(target: Target, options: StoreOptions = {}): Promise<Store> {
    const db = await openDb(target);
    await db.tx(async (tx) => {
      if (tx.postgres) await tx.run("SELECT pg_advisory_xact_lock(727276)");
      for (const statement of MIGRATIONS) await tx.run(statement);
    });
    return new Store(db, options);
  }

  close() {
    return this.db.close();
  }

  private ms() {
    return Math.floor(this.now());
  }

  private async stamp(tx: Tx, code: string) {
    const now = this.ms();
    await tx.run("UPDATE studio_rooms SET updated_at=CASE WHEN updated_at>=? THEN updated_at+1 ELSE ? END WHERE code=?", [now, now, code]);
  }

  /** The live room's code (row-locked for writes on Postgres), or 404. An expired room is deleted on sight. */
  private async room(tx: Tx, code: string, lock = true): Promise<string> {
    code = normalCode(code);
    let row = await tx.get(`SELECT created_at FROM studio_rooms WHERE code=?${lock && tx.postgres ? " FOR UPDATE" : ""}`, [code]);
    if (row && Number(row.created_at) < this.ms() - ROOM_MS) {
      await tx.run("DELETE FROM studio_rooms WHERE code=?", [code]);
      row = undefined;
    }
    if (!row) throw new HttpError(404, "Room not found");
    return code;
  }

  private async person(tx: Tx, code: string, personId: string) {
    if (!(await tx.get("SELECT 1 AS x FROM studio_people WHERE room_code=? AND id=?", [code, personId]))) {
      throw new HttpError(404, "Person not found");
    }
  }

  private async state(tx: Tx, code: string): Promise<RoomState> {
    const room = (await tx.get("SELECT updated_at,deck_json FROM studio_rooms WHERE code=?", [code]))!;
    const people = (await tx.all("SELECT id,name FROM studio_people WHERE room_code=? ORDER BY joined_at,id", [code]))
      .map((r) => ({ id: String(r.id), name: String(r.name) }));
    const assignments: Record<string, string> = {};
    for (const r of await tx.all("SELECT group_id,person_id FROM studio_assignments WHERE room_code=?", [code])) {
      assignments[String(r.group_id)] = String(r.person_id);
    }
    const received = new Map<string, number>();
    const counts = await tx.all(
      "SELECT c.take_id,COUNT(*) AS n FROM studio_chunks c JOIN studio_takes t ON t.id=c.take_id WHERE t.room_code=? GROUP BY c.take_id",
      [code],
    );
    for (const r of counts) received.set(String(r.take_id), Number(r.n));
    const takes: Record<string, TakeInfo> = {};
    for (const r of await tx.all(
      "SELECT id,group_id,person_id,duration_ms,cues_json,mime,size,chunks,created_at FROM studio_takes WHERE room_code=?",
      [code],
    )) {
      const take = takeInfo(r, received.get(String(r.id)) ?? 0);
      takes[take.groupId] = take;
    }
    const deck = room.deck_json == null ? null : JSON.parse(String(room.deck_json));
    return { code, people, assignments, takes, updatedAt: Number(room.updated_at), deck, live: await this.live(tx, code) };
  }

  /** The take in progress, its timer moved on to now, or null once the presenter stopped refreshing it. */
  private async live(tx: Tx, code: string): Promise<LiveState | null> {
    const row = await tx.get("SELECT data,stored_at FROM studio_live WHERE room_code=?", [code]);
    const age = row ? this.ms() - Number(row.stored_at) : LIVE_MS + 1;
    if (!row || age > LIVE_MS) return null;
    const live = JSON.parse(String(row.data)) as LiveState;
    live.remainingMs = Math.max(0, live.remainingMs - Math.max(0, age));
    return live;
  }

  /** Bytes the room's takes (except group `exceptGroup`'s) and files hold. */
  private async used(tx: Tx, code: string, exceptGroup: string | null = null) {
    const takes = await tx.get("SELECT COALESCE(SUM(size),0) AS n FROM studio_takes WHERE room_code=? AND group_id<>?", [code, exceptGroup ?? ""]);
    const files = await tx.get("SELECT COALESCE(SUM(size),0) AS n FROM studio_files WHERE room_code=?", [code]);
    return Number(takes!.n) + Number(files!.n);
  }

  /** A new room, or with `code` the room by that name, made if it does not exist yet. `created` when it is new. */
  async createRoom(code: string | null): Promise<{ state: RoomState; created: boolean }> {
    if (code !== null) {
      code = normalCode(code);
      if (!validCode(code)) throw new HttpError(400, `A room code is ${CODE_LENGTH} of ${CODE_ALPHABET}`);
    }
    return this.db.tx(async (tx) => {
      const now = this.ms();
      await tx.run("DELETE FROM studio_rooms WHERE created_at<?", [now - ROOM_MS]);
      if (code !== null) {
        const created = (await tx.run("INSERT INTO studio_rooms(code,created_at,updated_at) VALUES (?,?,?) ON CONFLICT(code) DO NOTHING", [code, now, now])) === 1;
        return { state: await this.state(tx, code), created };
      }
      let fresh: string;
      do {
        fresh = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      } while (await tx.get("SELECT 1 AS x FROM studio_rooms WHERE code=?", [fresh]));
      await tx.run("INSERT INTO studio_rooms(code,created_at,updated_at) VALUES (?,?,?)", [fresh, now, now]);
      return { state: await this.state(tx, fresh), created: true };
    });
  }

  getRoom(code: string): Promise<RoomState> {
    return this.db.tx(async (tx) => this.state(tx, await this.room(tx, code, false)));
  }

  putDeck(code: string, deckJson: string): Promise<RoomState> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code);
      await tx.run("UPDATE studio_rooms SET deck_json=? WHERE code=?", [deckJson, code]);
      await this.stamp(tx, code);
      return this.state(tx, code);
    });
  }

  putFile(code: string, mime: string, data: Uint8Array): Promise<string> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code);
      if ((await this.used(tx, code)) + data.length > this.roomMaxBytes) throw new HttpError(413, "This room is out of space");
      const id = hex();
      await tx.run("INSERT INTO studio_files(id,room_code,mime,size,data,created_at) VALUES (?,?,?,?,?,?)", [id, code, mime, data.length, data, this.ms()]);
      await this.stamp(tx, code);
      return id;
    });
  }

  getFile(code: string, id: string): Promise<{ mime: string; data: Uint8Array }> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code, false);
      const row = await tx.get("SELECT mime,data FROM studio_files WHERE room_code=? AND id=?", [code, id]);
      if (!row) throw new HttpError(404, "File not found");
      return { mime: String(row.mime), data: row.data as Uint8Array };
    });
  }

  join(code: string, name: string): Promise<Person> {
    const key = name.toLowerCase();
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code);
      const row = await tx.get("SELECT id,name FROM studio_people WHERE room_code=? AND name_key=?", [code, key]);
      if (row) return { id: String(row.id), name: String(row.name) };
      const count = await tx.get("SELECT COUNT(*) AS n FROM studio_people WHERE room_code=?", [code]);
      if (Number(count!.n) >= MAX_PEOPLE) throw new HttpError(409, "Room is full");
      const person = { id: hex().slice(0, 12), name };
      await tx.run("INSERT INTO studio_people(id,room_code,name,name_key,joined_at) VALUES (?,?,?,?,?)", [person.id, code, name, key, this.now()]);
      await this.stamp(tx, code);
      return person;
    });
  }

  leave(code: string, personId: string): Promise<RoomState> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code);
      await tx.run("DELETE FROM studio_assignments WHERE room_code=? AND person_id=?", [code, personId]);
      if ((await tx.run("DELETE FROM studio_people WHERE room_code=? AND id=?", [code, personId])) === 0) {
        throw new HttpError(404, "Person not found");
      }
      await this.stamp(tx, code);
      return this.state(tx, code);
    });
  }

  assign(code: string, groupId: string, personId: string | null): Promise<RoomState> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code);
      await tx.run("DELETE FROM studio_assignments WHERE room_code=? AND group_id=?", [code, groupId]);
      if (personId !== null) {
        await this.person(tx, code, personId);
        await tx.run("INSERT INTO studio_assignments(room_code,group_id,person_id) VALUES (?,?,?)", [code, groupId, personId]);
      }
      await this.stamp(tx, code);
      return this.state(tx, code);
    });
  }

  async startTake(code: string, take: NewTake): Promise<TakeInfo> {
    if (take.chunks !== expectedChunks(take.size)) {
      throw new HttpError(400, `A take of ${take.size} bytes has ${expectedChunks(take.size)} chunks`);
    }
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code);
      await this.person(tx, code, take.personId);
      if ((await this.used(tx, code, take.groupId)) + take.size > this.roomMaxBytes) throw new HttpError(413, "This room is out of space");
      // Chunks cascade with the take they belong to.
      await tx.run("DELETE FROM studio_takes WHERE room_code=? AND group_id=?", [code, take.groupId]);
      const info: TakeInfo = { id: hex(), ...take, received: 0, createdAt: this.ms() };
      await tx.run(
        "INSERT INTO studio_takes(id,room_code,group_id,person_id,duration_ms,cues_json,mime,size,chunks,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [info.id, code, info.groupId, info.personId, info.durationMs, JSON.stringify(info.cues), info.mime, info.size, info.chunks, info.createdAt],
      );
      await this.stamp(tx, code);
      return info;
    });
  }

  private async takeShape(tx: Tx, code: string, takeId: string) {
    const row = await tx.get("SELECT size,chunks FROM studio_takes WHERE room_code=? AND id=?", [code, takeId]);
    if (!row) throw new HttpError(404, "Take not found");
    return { size: Number(row.size), chunks: Number(row.chunks) };
  }

  putChunk(code: string, takeId: string, index: number, data: Uint8Array): Promise<number> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code);
      const { size, chunks } = await this.takeShape(tx, code, takeId);
      if (index < 0 || index >= chunks) throw new HttpError(404, "Chunk not found");
      const length = chunkLength(size, chunks, index);
      if (data.length !== length) throw new HttpError(400, `Chunk ${index} must be ${length} bytes`);
      await tx.run("INSERT INTO studio_chunks(take_id,idx,data) VALUES (?,?,?) ON CONFLICT(take_id,idx) DO UPDATE SET data=excluded.data", [takeId, index, data]);
      await this.stamp(tx, code);
      return Number((await tx.get("SELECT COUNT(*) AS n FROM studio_chunks WHERE take_id=?", [takeId]))!.n);
    });
  }

  getChunk(code: string, takeId: string, index: number): Promise<Uint8Array> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code, false);
      await this.takeShape(tx, code, takeId);
      const row = await tx.get("SELECT data FROM studio_chunks WHERE take_id=? AND idx=?", [takeId, index]);
      if (!row) throw new HttpError(404, "Chunk not found");
      return row.data as Uint8Array;
    });
  }

  /** Publishes the take `personId` is recording, or clears it. Clearing only ends their own take (or one nobody
   *  refreshes any more), so a late stop from an earlier presenter leaves the current one alone. */
  async putLive(code: string, personId: string, live: LiveState | null): Promise<LiveState | null> {
    if (live !== null && live.presenterId !== personId) throw new HttpError(403, "Only the presenter publishes their take");
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code, false);
      await this.person(tx, code, personId);
      const now = this.ms();
      if (live === null) {
        await tx.run("DELETE FROM studio_live WHERE room_code=? AND (person_id=? OR stored_at<?)", [code, personId, now - LIVE_MS]);
      } else {
        await tx.run(
          "INSERT INTO studio_live(room_code,person_id,data,stored_at) VALUES (?,?,?,?) ON CONFLICT(room_code) DO UPDATE SET person_id=excluded.person_id,data=excluded.data,stored_at=excluded.stored_at",
          [code, personId, JSON.stringify(live), now],
        );
      }
      return this.live(tx, code);
    });
  }

  /** Queues one signal for `to` and returns its sequence number. Expired signals go first. `data` is JSON text. */
  async sendSignal(code: string, from: string, to: string, kind: SignalKind, data: string): Promise<number> {
    if (from === to) throw new HttpError(400, "A signal goes to someone else");
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code, false);
      await this.person(tx, code, from);
      await this.person(tx, code, to);
      const now = this.ms();
      await tx.run("DELETE FROM studio_signals WHERE at<?", [now - SIGNAL_MS]);
      const count = await tx.get("SELECT COUNT(*) AS n FROM studio_signals WHERE room_code=?", [code]);
      if (Number(count!.n) >= ROOM_MAX_SIGNALS) throw new HttpError(429, "Too many signals; try again shortly");
      // The head row is the per-room counter; its row lock orders concurrent senders.
      const head = await tx.get(
        "INSERT INTO studio_signal_heads(room_code,last) VALUES (?,1) ON CONFLICT(room_code) DO UPDATE SET last=studio_signal_heads.last+1 RETURNING last",
        [code],
      );
      const seq = Number(head!.last);
      await tx.run("INSERT INTO studio_signals(room_code,seq,from_id,to_id,kind,data,at) VALUES (?,?,?,?,?,?,?)", [code, seq, from, to, kind, data, now]);
      return seq;
    });
  }

  /** Signals for `to` after the cursor, oldest first, and the cursor to send next time. Without a cursor only the
   *  current cursor comes back, so a new page skips what was meant for its predecessor. */
  signals(code: string, to: string, after: number | null): Promise<{ signals: Signal[]; last: number }> {
    return this.db.tx(async (tx) => {
      code = await this.room(tx, code, false);
      await this.person(tx, code, to);
      const row = await tx.get("SELECT last FROM studio_signal_heads WHERE room_code=?", [code]);
      const head = row ? Number(row.last) : 0;
      if (after === null) return { signals: [], last: head };
      const params: Value[] = [code, to, after, head, this.ms() - SIGNAL_MS, SIGNAL_PAGE];
      const rows = await tx.all(
        "SELECT seq,from_id,kind,data,at FROM studio_signals WHERE room_code=? AND to_id=? AND seq>? AND seq<=? AND at>=? ORDER BY seq LIMIT ?",
        params,
      );
      const signals = rows.map((r) => ({
        seq: Number(r.seq), from: String(r.from_id), kind: String(r.kind) as SignalKind, data: JSON.parse(String(r.data)), at: Number(r.at),
      }));
      return { signals, last: signals.length === SIGNAL_PAGE ? signals[signals.length - 1].seq : head };
    });
  }
}

function takeInfo(r: Record<string, unknown>, received: number): TakeInfo {
  return {
    id: String(r.id), groupId: String(r.group_id), personId: String(r.person_id), durationMs: Number(r.duration_ms),
    cues: JSON.parse(String(r.cues_json)) as Cue[], mime: String(r.mime), size: Number(r.size), chunks: Number(r.chunks),
    received, createdAt: Number(r.created_at),
  };
}

// The room API (docs/api.md) as one web-standard handler: server/dev.ts serves it locally, api/[...path].ts on Vercel.
import { defaultTarget } from "./db.ts";
import {
  CHUNK_BYTES, DECK_MAX_BYTES, FILE_MAX_BYTES, HttpError, SIGNAL_DATA_BYTES, SIGNAL_KINDS, Store, TAKE_MAX_BYTES,
  type LiveState, type SignalKind,
} from "./store.ts";

type Params = Record<string, string>;
type Route = { method: string; path: string[]; run: (store: Store, req: Request, p: Params, url: URL) => Promise<Response> };

const JSON_MAX_BYTES = 256 * 1024;
const FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const GROUP_ID = /^[a-z0-9-]{1,40}$/;
const MIME = /^video\/[\w.+-]+(;[\w=.,\s"+-]*)?$/;
const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------- validation

type Check<T> = (value: unknown, name: string) => T;
const bad = (detail: string) => new HttpError(400, detail);

const str = (min: number, max: number, pattern?: RegExp): Check<string> => (v, name) => {
  if (typeof v !== "string") throw bad(`${name} must be a string`);
  if (v.includes("\u0000")) throw bad(`${name} must not contain NUL`);
  const length = [...v].length;
  if (length < min || length > max) throw bad(`${name} must be ${min}–${max} characters`);
  if (pattern && !pattern.test(v)) throw bad(`${name} is not valid`);
  return v;
};
const trimmed = (min: number, max: number): Check<string> => (v, name) => str(min, max)(typeof v === "string" ? v.trim() : v, name);
const int = (min: number, max = Number.MAX_SAFE_INTEGER): Check<number> => (v, name) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return v;
};
const finite: Check<number> = (v, name) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw bad(`${name} must be a finite number`);
  return v;
};
const bool: Check<boolean> = (v, name) => {
  if (typeof v !== "boolean") throw bad(`${name} must be true or false`);
  return v;
};
const nullable = <T>(check: Check<T>): Check<T | null> => (v, name) => (v === null ? null : check(v, name));
const optional = <T>(check: Check<T>, fallback: T): Check<T> => (v, name) => (v === undefined ? fallback : check(v, name));
const list = <T>(check: Check<T>, max: number): Check<T[]> => (v, name) => {
  if (!Array.isArray(v)) throw bad(`${name} must be a list`);
  if (v.length > max) throw bad(`${name} holds at most ${max}`);
  return v.map((item, i) => check(item, `${name}[${i}]`));
};
const anything: Check<unknown> = (v) => (v === undefined ? null : v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An object with exactly these keys (each checked), and no others. */
const shape = <S extends Record<string, Check<unknown>>>(fields: S): Check<{ [K in keyof S]: ReturnType<S[K]> }> => (v, name) => {
  if (!isObject(v)) throw bad(`${name} must be an object`);
  for (const key of Object.keys(v)) if (!(key in fields)) throw bad(`${name}.${key} is not expected`);
  const out: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(fields)) out[key] = check(v[key], `${name}.${key}`);
  return out as { [K in keyof S]: ReturnType<S[K]> };
};

// A missing key reaches its check as undefined: required checks throw, optional ones return their fallback.
const required = <T>(check: Check<T>): Check<T> => (v, name) => {
  if (v === undefined) throw bad(`${name} is required`);
  return check(v, name);
};

const personId = required(str(1, 40));
const newRoom = shape({ code: optional(nullable(trimmed(1, 12)), null) });
const join = shape({ name: required(trimmed(1, 60)) });
const assign = shape({ personId: required(nullable(str(1, 40))) });
const cue = shape({ slide: required(int(0, 1000)), atMs: required(int(0)) });
const newTake = shape({
  groupId: required(str(1, 40, GROUP_ID)),
  personId,
  durationMs: required(int(0, HOUR_MS)),
  cues: required(list(cue, 1000)),
  mime: required(str(1, 120, MIME)),
  size: required(int(1, TAKE_MAX_BYTES)),
  chunks: required(int(1)),
});
const liveState: Check<LiveState> = shape({
  presenterId: personId,
  groupId: required(str(1, 40, GROUP_ID)),
  slide: required(int(0, 1000)),
  recording: required(bool),
  remainingMs: required(int(0, HOUR_MS)),
  targetMs: required(int(0, HOUR_MS)),
  at: required(int(0)),
});
const kind: Check<SignalKind> = (v, name) => {
  if (!SIGNAL_KINDS.includes(v as SignalKind)) throw bad(`${name} must be one of ${SIGNAL_KINDS.join(", ")}`);
  return v as SignalKind;
};
const newSignal = shape({ from: personId, to: personId, kind: required(kind), data: anything });
const text = str(0, DECK_MAX_BYTES);
const slide: Check<unknown> = (v, name) => {
  if (!isObject(v)) throw bad(`${name} must be an object`);
  text(v.kind, `${name}.kind`);
  return v;
};
const group: Check<unknown> = (v, name) => {
  if (!isObject(v)) throw bad(`${name} must be an object`);
  str(1, 40, GROUP_ID)(v.id, `${name}.id`);
  text(v.name, `${name}.name`);
  list(slide, DECK_MAX_BYTES)(v.slides, `${name}.slides`);
  list(text, DECK_MAX_BYTES)(v.script, `${name}.script`);
  if (v.speaker !== undefined) finite(v.speaker, `${name}.speaker`);
  if (v.seconds !== undefined) finite(v.seconds, `${name}.seconds`);
  return v;
};
const deck = (v: unknown) => {
  if (!isObject(v)) throw bad("A deck is an object with title, team and groups");
  text(v.title, "deck.title");
  list(text, DECK_MAX_BYTES)(v.team, "deck.team");
  list(group, DECK_MAX_BYTES)(v.groups, "deck.groups");
  if (v.logo !== undefined) text(v.logo, "deck.logo");
  if (v.camera !== undefined) {
    if (!isObject(v.camera)) throw bad("deck.camera must be an object");
    for (const key of ["x", "y", "w", "h"]) finite(v.camera[key], `deck.camera.${key}`);
  }
  return v;
};

function query(url: URL, name: string, required: boolean): string | null {
  const value = url.searchParams.get(name);
  if (value === null) {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  return str(1, 40)(value, name);
}

// ---------------------------------------------------------------- bodies

async function readBytes(req: Request, max: number, what: string): Promise<Buffer> {
  const tooBig = () => new HttpError(413, `${what} is at most ${max} bytes`);
  if (Number(req.headers.get("content-length")) > max) throw tooBig();
  if (!req.body) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const part of req.body) {
    total += part.length;
    if (total > max) throw tooBig();
    parts.push(part);
  }
  return Buffer.concat(parts, total);
}

/** The JSON body, or undefined when there is none. */
async function readJson(req: Request, max = JSON_MAX_BYTES, what = "A request body"): Promise<unknown> {
  const text = (await readBytes(req, max, what)).toString("utf8");
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw bad("The body is not valid JSON");
  }
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bytes = (data: Uint8Array, type: string, extra: Record<string, string> = {}) =>
  new Response(data as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": type, "Content-Length": String(data.length), ...extra } });

function chunkIndex(p: Params) {
  if (!/^\d{1,4}$/.test(p.index) || Number(p.index) > 1000) throw bad("A chunk index is a whole number from 0 to 1000");
  return Number(p.index);
}

// ---------------------------------------------------------------- routes

const route = (method: string, path: string, run: Route["run"]): Route => ({ method, path: path.split("/").filter(Boolean), run });

const routes: Route[] = [
  route("POST", "/api/rooms", async (store, req) => {
    const body = await readJson(req);
    const { code } = body === undefined || body === null ? { code: null } : newRoom(body, "body");
    const { state, created } = await store.createRoom(code);
    return json(state, created ? 201 : 200);
  }),
  route("GET", "/api/rooms/:code", async (store, _req, p) => json(await store.getRoom(p.code))),
  route("PUT", "/api/rooms/:code/deck", async (store, req, p) => {
    const value = deck(await readJson(req, DECK_MAX_BYTES, "A deck"));
    return json(await store.putDeck(p.code, JSON.stringify(value)));
  }),
  route("POST", "/api/rooms/:code/files", async (store, req, p) => {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!FILE_TYPES.includes(type)) throw bad(`A file is ${FILE_TYPES.join(", ")}`);
    const data = await readBytes(req, FILE_MAX_BYTES, "A file");
    if (data.length === 0) throw bad("The file is empty");
    return json({ id: await store.putFile(p.code, type, data) }, 201);
  }),
  route("GET", "/api/rooms/:code/files/:id", async (store, _req, p) => {
    const file = await store.getFile(p.code, p.id);
    return bytes(file.data, file.mime, { "Cache-Control": "public, max-age=31536000, immutable" });
  }),
  route("POST", "/api/rooms/:code/people", async (store, req, p) => {
    const { name } = join(await readJson(req), "body");
    return json(await store.join(p.code, name));
  }),
  route("DELETE", "/api/rooms/:code/people/:personId", async (store, _req, p) => json(await store.leave(p.code, p.personId))),
  route("PUT", "/api/rooms/:code/assignments/:groupId", async (store, req, p) => {
    if (!GROUP_ID.test(p.groupId)) throw bad("A group id is 1–40 of a-z, 0-9 and -");
    const { personId } = assign(await readJson(req), "body");
    return json(await store.assign(p.code, p.groupId, personId));
  }),
  route("POST", "/api/rooms/:code/takes", async (store, req, p) => json(await store.startTake(p.code, newTake(await readJson(req), "body")), 201)),
  route("PUT", "/api/rooms/:code/takes/:takeId/chunks/:index", async (store, req, p) => {
    const index = chunkIndex(p);
    const data = await readBytes(req, CHUNK_BYTES, "A chunk");
    return json({ received: await store.putChunk(p.code, p.takeId, index, data) });
  }),
  route("GET", "/api/rooms/:code/takes/:takeId/chunks/:index", async (store, _req, p) =>
    bytes(await store.getChunk(p.code, p.takeId, chunkIndex(p)), "application/octet-stream")),
  route("PUT", "/api/rooms/:code/live", async (store, req, p, url) => {
    const person = query(url, "person", true)!;
    const body = await readJson(req);
    const live = body === undefined || body === null ? null : liveState(body, "body");
    return json(await store.putLive(p.code, person, live));
  }),
  route("POST", "/api/rooms/:code/signals", async (store, req, p) => {
    const body = newSignal(await readJson(req), "body");
    const data = JSON.stringify(body.data);
    if (Buffer.byteLength(data) > SIGNAL_DATA_BYTES) throw new HttpError(413, `Signal data is at most ${SIGNAL_DATA_BYTES} bytes`);
    return json({ seq: await store.sendSignal(p.code, body.from, body.to, body.kind, data) }, 201);
  }),
  route("GET", "/api/rooms/:code/signals", async (store, _req, p, url) => {
    const to = query(url, "to", true)!;
    const after = url.searchParams.get("after");
    if (after !== null && !/^\d{1,15}$/.test(after)) throw bad("after must be a whole number from 0");
    return json(await store.signals(p.code, to, after === null ? null : Number(after)));
  }),
];

function match(route: Route, segments: string[]): Params | null {
  if (route.path.length !== segments.length) return null;
  const params: Params = {};
  for (const [i, part] of route.path.entries()) {
    if (part.startsWith(":")) params[part.slice(1)] = segments[i];
    else if (part !== segments[i]) return null;
  }
  return params;
}

// ---------------------------------------------------------------- handler

export function createHandler(getStore: () => Promise<Store>) {
  return async function handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      let segments: string[];
      try {
        segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      } catch {
        throw bad("The path is not valid");
      }
      const found = routes.map((r) => [r, match(r, segments)] as const).filter(([, p]) => p !== null);
      if (found.length === 0) throw new HttpError(404, "Not found");
      const hit = found.find(([r]) => r.method === req.method);
      if (!hit) {
        return Response.json({ detail: "Method not allowed" }, { status: 405, headers: { Allow: found.map(([r]) => r.method).join(", ") } });
      }
      const [r, params] = hit;
      // The store upper-cases codes; anything that is not 6 letters or digits cannot name a room.
      if (params!.code !== undefined && !/^[A-Za-z0-9]{6}$/.test(params!.code)) throw new HttpError(404, "Room not found");
      if (params!.id !== undefined && !/^[a-f0-9]{32}$/.test(params!.id)) throw new HttpError(404, "File not found");
      if (params!.takeId !== undefined && !/^[a-f0-9]{32}$/.test(params!.takeId)) throw new HttpError(404, "Take not found");
      if (params!.personId !== undefined && !/^[a-f0-9]{12}$/.test(params!.personId)) throw new HttpError(404, "Person not found");
      return await r.run(await getStore(), req, params!, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ detail: e.message }, e.status);
      console.error(e);
      return json({ detail: "Server error" }, 500);
    }
  };
}

let opening: Promise<Store> | null = null;

function defaultStore(): Promise<Store> {
  opening ??= Store.open(defaultTarget()).catch((e: unknown) => {
    opening = null;
    throw e;
  });
  return opening;
}

/** The room API over the default store: Postgres when DATABASE_URL is set, otherwise .data/lemo.sqlite. */
export const handle = createHandler(defaultStore);

// The room API end to end through handle(). SQLite in memory by default; with DATABASE_URL set, each test runs
// in a throwaway Postgres schema that is dropped afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import postgres from "postgres";
import type { Slide } from "../src/studio/types.ts";
import { createHandler } from "./app.ts";
import { CHUNK_BYTES, ROOM_MAX_SIGNALS, ROOM_MS, SIGNAL_MS, Store, type StoreOptions } from "./store.ts";

const DATABASE_URL = process.env.DATABASE_URL;

interface Call { json?: unknown; body?: Uint8Array | string; type?: string }

async function setup(t: TestContext, options: StoreOptions = {}) {
  let offset = 0;
  const now = () => performance.timeOrigin + performance.now() + offset;
  let store: Store;
  if (DATABASE_URL) {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const admin = postgres(DATABASE_URL, { onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    store = await Store.open({ postgres: DATABASE_URL, schema }, { now, ...options });
    t.after(async () => {
      await store.close();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
  } else {
    store = await Store.open({ sqlite: ":memory:" }, { now, ...options });
    t.after(() => store.close());
  }
  const handle = createHandler(async () => store);
  const call = (method: string, path: string, init: Call = {}) => {
    const headers: Record<string, string> = {};
    let body: RequestInit["body"];
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.body !== undefined) {
      headers["Content-Type"] = init.type ?? "application/octet-stream";
      body = init.body as RequestInit["body"];
    }
    return handle(new Request(`http://test${path}`, { method, headers, body }));
  };
  const ok = async (method: string, path: string, init: Call = {}, status = 200): Promise<any> => {
    const res = await call(method, path, init);
    assert.equal(res.status, status, `${method} ${path}: ${await res.clone().text()}`);
    return res.json();
  };
  const room = async () => ok("POST", "/api/rooms", { json: {} }, 201);
  const person = async (code: string, name: string) => ok("POST", `/api/rooms/${code}/people`, { json: { name } });
  return { store, call, ok, room, person, clock: (ms: number) => void (offset = ms), sql: store.db };
}

const seqOf = async (res: Response | Promise<Response>) => ((await (await res).json()) as { seq: number }).seq;
const status = async (res: Promise<Response>) => (await res).status;

function takeBody(personId: string, size: number, group = "intro", extra: Record<string, unknown> = {}) {
  return {
    groupId: group, personId, durationMs: 4200, cues: [{ slide: 1, atMs: 1500 }],
    mime: "video/webm;codecs=vp9,opus", size, chunks: Math.ceil(size / CHUNK_BYTES), ...extra,
  };
}

test("create, join, rejoin and leave", async (t) => {
  const { ok, call, room } = await setup(t);
  const created = await room();
  const code: string = created.code;
  assert.equal(code.length, 6);
  assert.ok(![...code].some((c) => "0O1I".includes(c)));
  assert.deepEqual([created.people, created.assignments, created.takes, created.deck, created.live], [[], {}, {}, null, null]);

  const ana = await ok("POST", `/api/rooms/${code.toLowerCase()}/people`, { json: { name: "  Ana  " } });
  assert.equal(ana.name, "Ana");
  assert.deepEqual(await ok("POST", `/api/rooms/${code}/people`, { json: { name: "ANA" } }), ana);
  const ben = await ok("POST", `/api/rooms/${code}/people`, { json: { name: "Ben" } });
  assert.equal(await status(call("POST", `/api/rooms/${code}/people`, { json: { name: "   " } })), 400);
  assert.equal(await status(call("POST", `/api/rooms/${code}/people`, { json: { name: "x".repeat(61) } })), 400);

  let state = await ok("GET", `/api/rooms/${code.toLowerCase()}`);
  assert.deepEqual(state.people, [ana, ben]);
  assert.ok(state.updatedAt > created.updatedAt);

  await ok("PUT", `/api/rooms/${code}/assignments/intro`, { json: { personId: ben.id } });
  state = await ok("DELETE", `/api/rooms/${code}/people/${ben.id}`);
  assert.deepEqual(state.people, [ana]);
  assert.deepEqual(state.assignments, {});
  assert.equal(await status(call("DELETE", `/api/rooms/${code}/people/${ben.id}`)), 404);
  assert.equal(await status(call("GET", "/api/rooms/ZZZZZZ")), 404);
});

test("a room is full after twelve", async (t) => {
  const { call, room } = await setup(t);
  const { code } = await room();
  for (let n = 0; n < 12; n++) assert.equal(await status(call("POST", `/api/rooms/${code}/people`, { json: { name: `P${n}` } })), 200);
  assert.equal(await status(call("POST", `/api/rooms/${code}/people`, { json: { name: "late" } })), 409);
  assert.equal(await status(call("POST", `/api/rooms/${code}/people`, { json: { name: "p3" } })), 200);
});

test("assignments", async (t) => {
  const { ok, call, room, person } = await setup(t);
  const { code } = await room();
  const ana = await person(code, "Ana");
  let state = await ok("PUT", `/api/rooms/${code}/assignments/the-problem`, { json: { personId: ana.id } });
  assert.deepEqual(state.assignments, { "the-problem": ana.id });
  state = await ok("PUT", `/api/rooms/${code}/assignments/the-problem`, { json: { personId: null } });
  assert.deepEqual(state.assignments, {});
  assert.equal(await status(call("PUT", `/api/rooms/${code}/assignments/the-problem`, { json: { personId: "nobody" } })), 404);
  assert.equal(await status(call("PUT", `/api/rooms/${code}/assignments/Bad_Id`, { json: { personId: ana.id } })), 400);
  assert.equal(await status(call("PUT", `/api/rooms/${code}/assignments/the-problem`, { json: {} })), 400);
});

test("a take uploads, downloads and is replaced", async (t) => {
  const { ok, call, room, person } = await setup(t);
  const { code } = await room();
  const ana = await person(code, "Ana");
  const video = Buffer.concat([Buffer.alloc(CHUNK_BYTES, 0).map((_, i) => i % 256), Buffer.from("tail-bytes")]);
  const take = await ok("POST", `/api/rooms/${code}/takes`, { json: takeBody(ana.id, video.length) }, 201);
  assert.equal(take.chunks, 2);
  assert.equal(take.received, 0);
  assert.deepEqual(take.cues, [{ slide: 1, atMs: 1500 }]);
  const url = `/api/rooms/${code}/takes/${take.id}/chunks`;

  assert.equal(await status(call("PUT", `${url}/0`, { body: video.subarray(0, 100) })), 400);
  assert.equal(await status(call("PUT", `${url}/2`, { body: "x" })), 404);
  assert.equal(await status(call("PUT", `${url}/x`, { body: "x" })), 400);
  assert.deepEqual(await ok("PUT", `${url}/1`, { body: video.subarray(CHUNK_BYTES) }), { received: 1 });
  assert.deepEqual(await ok("PUT", `${url}/1`, { body: video.subarray(CHUNK_BYTES) }), { received: 1 });
  assert.deepEqual(await ok("PUT", `${url}/0`, { body: video.subarray(0, CHUNK_BYTES) }), { received: 2 });
  assert.equal((await ok("GET", `/api/rooms/${code}`)).takes.intro.received, 2);

  const first = await call("GET", `${url}/0`);
  assert.equal(first.headers.get("content-type"), "application/octet-stream");
  const downloaded = Buffer.concat([Buffer.from(await first.arrayBuffer()), Buffer.from(await (await call("GET", `${url}/1`)).arrayBuffer())]);
  assert.ok(downloaded.equals(video));

  const again = await ok("POST", `/api/rooms/${code}/takes`, { json: takeBody(ana.id, 10) }, 201);
  assert.equal(await status(call("GET", `${url}/0`)), 404);
  assert.equal(await status(call("PUT", `${url}/0`, { body: video.subarray(0, CHUNK_BYTES) })), 404);
  assert.deepEqual((await ok("GET", `/api/rooms/${code}`)).takes, { intro: again });
});

test("take limits", async (t) => {
  const { ok, call, room, person } = await setup(t, { roomMaxBytes: 25 });
  const { code } = await room();
  const ana = await person(code, "Ana");
  const post = (body: unknown) => status(call("POST", `/api/rooms/${code}/takes`, { json: body }));
  assert.equal(await post(takeBody(ana.id, 150 * 1024 * 1024 + 1)), 400);
  assert.equal(await post(takeBody(ana.id, 10, "intro", { chunks: 2 })), 400);
  assert.equal(await post(takeBody(ana.id, 10, "intro", { mime: "audio/webm" })), 400);
  assert.equal(await post(takeBody(ana.id, 10, "intro", { cues: Array(1001).fill({ slide: 0, atMs: 0 }) })), 400);
  assert.equal(await post(takeBody(ana.id, 10, "intro", { durationMs: 1.5 })), 400);
  assert.equal(await post(takeBody(ana.id, 10, "intro", { extra: 1 })), 400);
  assert.equal(await post(takeBody("nobody", 10)), 404);
  assert.equal(await post(takeBody(ana.id, 10, "a")), 201);
  assert.equal(await post(takeBody(ana.id, 10, "b")), 201);
  assert.equal(await post(takeBody(ana.id, 10, "c")), 413);
  assert.equal(await post(takeBody(ana.id, 15, "b")), 201); // replacing b frees its space
  const take = await ok("POST", `/api/rooms/${code}/takes`, { json: takeBody(ana.id, 5, "a") }, 201);
  const oversized = call("PUT", `/api/rooms/${code}/takes/${take.id}/chunks/0`, { body: Buffer.alloc(CHUNK_BYTES + 1) });
  assert.equal(await status(oversized), 413);
});

test("a take keeps up to 1000 slide-change cues", async (t) => {
  const { ok, room, person } = await setup(t);
  const { code } = await room();
  const ana = await person(code, "Ana");
  for (const cues of [
    Array.from({ length: 101 }, (_, i) => ({ slide: i % 2, atMs: i * 1000 })),
    Array.from({ length: 1000 }, () => ({ slide: 1000, atMs: Number.MAX_SAFE_INTEGER })),
  ]) {
    const body = takeBody(ana.id, 1, "intro", { cues });
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 256 * 1024);
    const take = await ok("POST", `/api/rooms/${code}/takes`, { json: body }, 201);
    assert.deepEqual(take.cues, cues);
    assert.deepEqual((await ok("GET", `/api/rooms/${code}`)).takes.intro.cues, cues);
  }
});

test("a take's cues and the live state carry where the presenter's camera sits", async (t) => {
  const { ok, call, room, person } = await setup(t);
  const { code } = await room();
  const ana = await person(code, "Ana");
  const cues = [{ slide: 0, atMs: 0, spot: "br-m" }, { slide: 0, atMs: 800, spot: "c-l" }, { slide: 1, atMs: 1500, spot: "c-l" }];
  const take = await ok("POST", `/api/rooms/${code}/takes`, { json: takeBody(ana.id, 1, "intro", { cues }) }, 201);
  assert.deepEqual(take.cues, cues);
  assert.deepEqual((await ok("GET", `/api/rooms/${code}`)).takes.intro.cues, cues);
  for (const spot of ["full", "c-xl", "", 3]) {
    const bad = takeBody(ana.id, 1, "intro", { cues: [{ slide: 0, atMs: 0, spot }] });
    assert.equal(await status(call("POST", `/api/rooms/${code}/takes`, { json: bad })), 400, String(spot));
  }
  await ok("PUT", `/api/rooms/${code}/live?person=${ana.id}`, { json: liveBody(ana.id, { spot: "tl-s" }) });
  assert.equal((await ok("GET", `/api/rooms/${code}`)).live.spot, "tl-s");
  assert.equal(await status(call("PUT", `/api/rooms/${code}/live?person=${ana.id}`, { json: liveBody(ana.id, { spot: "full" }) })), 400);
});

test("an expired room is gone", async (t) => {
  const { call, room, clock } = await setup(t);
  const { code } = await room();
  clock(ROOM_MS + 1000);
  assert.equal(await status(call("GET", `/api/rooms/${code}`)), 404);
});

test("expired reads and writes commit deletion of the room and its media", async (t) => {
  const { ok, call, room, person, clock, sql } = await setup(t);
  for (const method of ["GET", "PUT"]) {
    clock(0);
    const { code } = await room();
    const ana = await person(code, "Ana");
    await ok("PUT", `/api/rooms/${code}/assignments/intro`, { json: { personId: ana.id } });
    assert.equal(await status(call("PUT", `/api/rooms/${code}/assignments/intro`, { json: { personId: "nobody" } })), 404);
    assert.deepEqual((await ok("GET", `/api/rooms/${code}`)).assignments, { intro: ana.id });
    await ok("POST", `/api/rooms/${code}/files`, { body: "image", type: "image/png" }, 201);
    const take = await ok("POST", `/api/rooms/${code}/takes`, { json: takeBody(ana.id, 1) }, 201);
    await ok("PUT", `/api/rooms/${code}/takes/${take.id}/chunks/0`, { body: "x" });
    clock(ROOM_MS + 1000);
    const path = `/api/rooms/${code}${method === "PUT" ? "/deck" : ""}`;
    assert.equal(await status(call(method, path, method === "PUT" ? { json: deck } : {})), 404);
    assert.equal(await status(call("GET", `/api/rooms/${code}`)), 404);
    await sql.tx(async (tx) => {
      for (const table of ["studio_rooms", "studio_people", "studio_assignments", "studio_files", "studio_takes", "studio_chunks"]) {
        const row = await tx.get(`SELECT COUNT(*) AS n FROM ${table}`);
        assert.equal(Number(row!.n), 0, `${method}: ${table}`);
      }
    });
  }
});

async function signalRoom(t: TestContext) {
  const ctx = await setup(t);
  const { code } = await ctx.room();
  const [ana, ben, cy] = await Promise.all(["Ana", "Ben", "Cy"].map(async (name) => (await ctx.person(code, name)).id as string));
  const send = (sender: string, to: string, kind = "offer", data: unknown = null, where = code) =>
    ctx.call("POST", `/api/rooms/${where}/signals`, { json: { from: sender, to, kind, data } });
  const inbox = (who: string, after?: number, where = code) =>
    ctx.ok("GET", `/api/rooms/${where}/signals?to=${who}${after === undefined ? "" : `&after=${after}`}`);
  return { ...ctx, code, ana, ben, cy, send, inbox };
}

test("signals arrive in order for their recipient only", async (t) => {
  const { ana, ben, cy, send, inbox, ok, room, person, call } = await signalRoom(t);
  assert.deepEqual(await inbox(ben), { signals: [], last: 0 });

  const sdp = { pc: "p1", to: null, description: { type: "offer", sdp: "v=0" } };
  const first = await send(ana, ben, "offer", sdp);
  assert.equal(first.status, 201);
  const seqs = [await seqOf(first)];
  seqs.push(await seqOf(send(ana, cy, "offer", sdp)));
  seqs.push(await seqOf(send(ana, ben, "candidate", { candidates: [{ candidate: "c1" }] })));
  seqs.push(await seqOf(send(cy, ben, "bye")));
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, 4);

  const got = await inbox(ben, 0);
  assert.deepEqual(got.signals.map((s: { from: string; kind: string }) => [s.from, s.kind]), [[ana, "offer"], [ana, "candidate"], [cy, "bye"]]);
  assert.deepEqual(got.signals[0].data, sdp);
  assert.equal(got.signals[2].data, null);
  assert.ok(got.signals.every((s: { at: unknown }) => Number.isInteger(s.at)));
  assert.equal(got.last, seqs.at(-1));
  assert.deepEqual((await inbox(ben, got.signals[0].seq)).signals.map((s: { kind: string }) => s.kind), ["candidate", "bye"]);
  assert.deepEqual(await inbox(ben, got.last), { signals: [], last: got.last });
  // Without a cursor a fresh page only learns where the queue ends.
  assert.deepEqual(await inbox(ben), { signals: [], last: seqs.at(-1) });
  assert.deepEqual((await inbox(cy, 0)).signals.map((s: { kind: string }) => s.kind), ["offer"]);

  const other = (await room()).code;
  const dee = (await person(other, "Dee")).id;
  assert.equal(await status(call("GET", `/api/rooms/${other}/signals?to=${ben}&after=0`)), 404);
  assert.deepEqual(await ok("GET", `/api/rooms/${other}/signals?to=${dee}&after=0`), { signals: [], last: 0 });
});

test("signals are checked", async (t) => {
  const { code, ana, ben, send, call } = await signalRoom(t);
  assert.equal(await status(send(ana, "nobody")), 404);
  assert.equal(await status(send("nobody", ben)), 404);
  assert.equal(await status(send(ana, ana)), 400);
  assert.equal(await status(send(ana, ben, "hello")), 400);
  assert.equal(await status(send(ana, ben, "offer", null, "ZZZZZZ")), 404);
  assert.equal(await status(call("POST", `/api/rooms/${code}/signals`, { json: { from: ana, to: ben, kind: "bye", x: 1 } })), 400);
  assert.equal(await status(send(ana, ben, "offer", { sdp: "x".repeat(64 * 1024) })), 413);
  assert.equal(await status(send(ana, ben, "offer", { sdp: "x".repeat(60 * 1024) })), 201);
  assert.equal(await status(call("GET", `/api/rooms/${code}/signals?to=nobody&after=0`)), 404);
  assert.equal(await status(call("GET", `/api/rooms/${code}/signals?to=${ben}&after=-1`)), 400);
  assert.equal(await status(call("GET", `/api/rooms/${code}/signals?after=0`)), 400);
  await call("DELETE", `/api/rooms/${code}/people/${ben}`);
  assert.equal(await status(send(ana, ben)), 404);
});

test("signals expire after ten minutes", async (t) => {
  const { code, ana, ben, send, inbox, clock, sql } = await signalRoom(t);
  const old = await seqOf(send(ana, ben, "offer", { n: 1 }));
  clock(9 * 60_000);
  await send(ana, ben, "candidate", { n: 2 });
  assert.deepEqual((await inbox(ben, 0)).signals.map((s: { data: { n: number } }) => s.data.n), [1, 2]);

  clock(10 * 60_000 + 1000);
  assert.deepEqual((await inbox(ben, 0)).signals.map((s: { data: { n: number } }) => s.data.n), [2]);
  assert.ok(await seqOf(send(ana, ben, "bye")) > old);
  const rows = await sql.tx((tx) => tx.all("SELECT seq FROM studio_signals WHERE room_code=? ORDER BY seq", [code]));
  assert.deepEqual(rows.map((r) => Number(r.seq)), [old + 1, old + 2]);
});

test("concurrent signals cannot exceed the room cap or consume rejected sequence numbers", async (t) => {
  const { code, ana, ben, send, inbox, clock, sql } = await signalRoom(t);
  for (let i = 0; i < ROOM_MAX_SIGNALS - 1; i++) assert.equal(await status(send(ana, ben)), 201);
  const race = () => Promise.all(Array.from({ length: 20 }, () => send(ana, ben)));
  let responses: Response[];
  if (sql.postgres) {
    const { pending, waiting } = await sql.tx(async (tx) => {
      await tx.get("SELECT last FROM studio_signal_heads WHERE room_code=? FOR UPDATE", [code]);
      const pending = race();
      const deadline = Date.now() + 5000;
      let waiting = 0;
      // Hold the head until two senders overlap there, rather than relying on network timing.
      while (waiting < 2 && Date.now() < deadline) {
        await tx.run("SELECT pg_stat_clear_snapshot()");
        const row = await tx.get("SELECT COUNT(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'INSERT INTO studio_signal_heads%'");
        waiting = Number(row!.n);
      }
      return { pending, waiting };
    });
    responses = await pending;
    assert.ok(waiting >= 2, "two senders reached the signal head lock");
  } else {
    responses = await race();
  }
  assert.equal(responses.filter((r) => r.status === 201).length, 1);
  assert.equal(responses.filter((r) => r.status === 429).length, 19);
  assert.deepEqual(await inbox(ben), { signals: [], last: ROOM_MAX_SIGNALS });
  const row = await sql.tx((tx) => tx.get("SELECT COUNT(*) AS n FROM studio_signals WHERE room_code=?", [code]));
  assert.equal(Number(row!.n), ROOM_MAX_SIGNALS);
  clock(SIGNAL_MS + 1000);
  const next = await send(ana, ben);
  assert.equal(next.status, 201);
  assert.equal(await seqOf(next), ROOM_MAX_SIGNALS + 1);
});

test("a named room is made once and shared", async (t) => {
  const { ok, call, person } = await setup(t);
  const first = await ok("POST", "/api/rooms", { json: { code: " batats " } }, 201);
  assert.equal(first.code, "BATATS");
  await person("BATATS", "Ana");
  const again = await ok("POST", "/api/rooms", { json: { code: "BATATS" } });
  assert.deepEqual(again.people.map((p: { name: string }) => p.name), ["Ana"]);
  assert.equal((await ok("GET", "/api/rooms/BATATS")).live, null);
  for (const bad of ["BATAT", "BATATSS", "BAT0TS", "BATIT1", "BA-TAT", "", "x".repeat(13)]) {
    assert.equal(await status(call("POST", "/api/rooms", { json: { code: bad } })), 400, bad);
  }
  assert.equal(await status(call("POST", "/api/rooms", { json: { code: 7 } })), 400);
  assert.equal(await status(call("POST", "/api/rooms", { json: { other: 1 } })), 400);
});

test("a fresh room gets a new code each time", async (t) => {
  const { ok } = await setup(t);
  const codes = new Set<string>();
  for (const init of [{ json: {} }, {}, { json: { code: null } }, { json: {} }]) {
    const state = await ok("POST", "/api/rooms", init, 201);
    assert.match(state.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal(state.deck, null);
    codes.add(state.code);
  }
  assert.equal(codes.size, 4);
});

const deck = { title: "Acme", team: ["Ana", "Ben"], groups: [{ id: "intro", name: "Intro", speaker: 0, slides: [{ kind: "statement", id: "s1", text: "Hi" }], script: ["Hello"] }] };

test("the deck is stored with the room", async (t) => {
  const { ok, call, room } = await setup(t);
  const created = await room();
  const state = await ok("PUT", `/api/rooms/${created.code}/deck`, { json: deck });
  assert.deepEqual(state.deck, deck);
  assert.ok(state.updatedAt > created.updatedAt);
  assert.deepEqual((await ok("GET", `/api/rooms/${created.code}`)).deck, deck);
  const next = { ...deck, title: "Renamed" };
  assert.equal((await ok("PUT", `/api/rooms/${created.code}/deck`, { json: next })).deck.title, "Renamed");

  for (const bad of [null, [], "deck", { title: "x" }, { title: 1, team: [], groups: [] }]) {
    assert.equal(await status(call("PUT", `/api/rooms/${created.code}/deck`, { json: bad })), 400, JSON.stringify(bad));
  }
  assert.equal(await status(call("PUT", `/api/rooms/${created.code}/deck`, { body: "{not json", type: "application/json" })), 400);
  const huge = { ...deck, title: "x".repeat(1024 * 1024) };
  assert.equal(await status(call("PUT", `/api/rooms/${created.code}/deck`, { json: huge })), 413);
  const nearly = { ...deck, title: "x".repeat(1024 * 1024 - 400) };
  assert.equal(await status(call("PUT", `/api/rooms/${created.code}/deck`, { json: nearly })), 200);
  assert.equal(await status(call("PUT", "/api/rooms/ZZZZZZ/deck", { json: deck })), 404);
});

test("invalid nested decks leave the stored deck intact", async (t) => {
  const { ok, call, room } = await setup(t);
  const { code } = await room();
  await ok("PUT", `/api/rooms/${code}/deck`, { json: deck });
  const group = deck.groups[0];
  for (const bad of [
    { ...deck, team: [null, 7], groups: [null] },
    { ...deck, team: [null] },
    { ...deck, team: [7] },
    { ...deck, groups: [null] },
    { ...deck, groups: [7] },
    ...[
      { id: undefined }, { id: "Bad_Id" }, { id: "../intro" }, { name: 7 },
      { slides: null }, { slides: [null] }, { slides: [7] }, { slides: [{ kind: 7 }] },
      { script: null }, { script: [null] }, { script: [7] },
      { speaker: "0" }, { speaker: null }, { seconds: "5" }, { seconds: null },
    ].map((bad) => ({ ...deck, groups: [{ ...group, ...bad }] })),
    { ...deck, logo: 7 },
    { ...deck, camera: null },
    { ...deck, camera: { x: 0, y: 0, w: 100 } },
    { ...deck, camera: { x: "0", y: 0, w: 100, h: 100 } },
  ]) {
    assert.equal(await status(call("PUT", `/api/rooms/${code}/deck`, { json: bad })), 400, JSON.stringify(bad));
    assert.deepEqual((await ok("GET", `/api/rooms/${code}`)).deck, deck);
  }
  for (const body of [
    JSON.stringify(deck).replace('"speaker":0', '"speaker":1e999'),
    JSON.stringify({ ...deck, groups: [{ ...group, seconds: 5 }] }).replace('"seconds":5', '"seconds":1e999'),
    JSON.stringify({ ...deck, camera: { x: 0, y: 0, w: 100, h: 100 } }).replace('"x":0', '"x":1e999'),
  ]) {
    assert.equal(await status(call("PUT", `/api/rooms/${code}/deck`, { body, type: "application/json" })), 400);
  }
  assert.deepEqual((await ok("GET", `/api/rooms/${code}`)).deck, deck);
});

test("all slide kinds and extra slide fields round-trip with camera and timing edits", async (t) => {
  const { ok, room } = await setup(t);
  const { code } = await room();
  const slides = [
    { kind: "page", id: "p1", src: "/page.png" },
    { kind: "statement", id: "s1", text: "Hi" },
    { kind: "clip", id: "c1", title: "Clip", src: "/clip.webm", from: 0, to: 2, rate: 1.5 },
    { kind: "image", id: "i1", title: "Image", src: "/image.png" },
    { kind: "compare", id: "c2", title: "Compare", left: { src: "/a.png", label: "A" }, right: { src: "/b.png", label: "B" } },
    { kind: "bars", id: "b1", title: "Bars", max: 5, bars: [{ label: "A", value: 3 }] },
    { kind: "count", id: "n1", value: 3, label: "Count" },
    { kind: "dots", id: "d1", title: "Dots", total: 5, lit: 3, label: "Dots" },
    { kind: "flow", id: "f1", title: "Flow", steps: [{ label: "Start" }] },
    { kind: "logo", id: "l1", names: ["Ana"] },
  ] satisfies Slide[];
  const value = {
    title: "", team: ["", "Ana"], logo: "/logo.png", camera: { x: 0.5, y: -1, w: 320, h: 180 },
    groups: [{ id: "g-setup", name: "", seconds: 12.5, script: ["", "An edit"], slides: [
      ...slides.map((slide) => ({ ...slide, extra: { kept: true } })),
      { kind: "older-slide", payload: { kept: [1, null, "text"] } },
    ] }],
  };
  assert.deepEqual((await ok("PUT", `/api/rooms/${code}/deck`, { json: value })).deck, value);
  assert.deepEqual((await ok("GET", `/api/rooms/${code}`)).deck, value);
});

test("files upload and come back with their type", async (t) => {
  const { ok, call, room } = await setup(t);
  const { code } = await room();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 255]);
  const { id } = await ok("POST", `/api/rooms/${code}/files`, { body: png, type: "image/png" }, 201);
  const res = await call("GET", `/api/rooms/${code.toLowerCase()}/files/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(png));
  const webp = await ok("POST", `/api/rooms/${code}/files`, { body: png, type: "Image/WebP; charset=binary" }, 201);
  assert.equal((await call("GET", `/api/rooms/${code}/files/${webp.id}`)).headers.get("content-type"), "image/webp");

  assert.equal(await status(call("POST", `/api/rooms/${code}/files`, { body: png, type: "image/gif" })), 400);
  assert.equal(await status(call("POST", `/api/rooms/${code}/files`, { body: png })), 400);
  assert.equal(await status(call("POST", `/api/rooms/${code}/files`, { body: new Uint8Array(0), type: "image/png" })), 400);
  assert.equal(await status(call("POST", `/api/rooms/${code}/files`, { body: Buffer.alloc(4 * 1024 * 1024 + 1), type: "image/jpeg" })), 413);
  assert.equal(await status(call("POST", `/api/rooms/${code}/files`, { body: Buffer.alloc(4 * 1024 * 1024), type: "image/jpeg" })), 201);
  assert.equal(await status(call("POST", "/api/rooms/ZZZZZZ/files", { body: png, type: "image/png" })), 404);
  assert.equal(await status(call("GET", `/api/rooms/${code}/files/nope`)), 404);
  const other = (await room()).code;
  assert.equal(await status(call("GET", `/api/rooms/${other}/files/${id}`)), 404);
});

test("files and takes share the room's space", async (t) => {
  const { ok, call, room, person } = await setup(t, { roomMaxBytes: 25 });
  const { code } = await room();
  const ana = await person(code, "Ana");
  await ok("POST", `/api/rooms/${code}/files`, { body: Buffer.alloc(15), type: "image/png" }, 201);
  assert.equal(await status(call("POST", `/api/rooms/${code}/takes`, { json: takeBody(ana.id, 11) })), 413);
  await ok("POST", `/api/rooms/${code}/takes`, { json: takeBody(ana.id, 10) }, 201);
  assert.equal(await status(call("POST", `/api/rooms/${code}/files`, { body: Buffer.alloc(1), type: "image/png" })), 413);
});

const liveBody = (personId: string, extra: Record<string, unknown> = {}) => ({
  presenterId: personId, groupId: "intro", slide: 2, recording: true, remainingMs: 30_000, targetMs: 40_000, at: 1_700_000_000_000, ...extra,
});

test("live state is shared through the room", async (t) => {
  const { ok, call, room, person } = await setup(t);
  const { code } = await room();
  const ana = await person(code, "Ana");
  const ben = await person(code, "Ben");
  assert.equal((await ok("PUT", `/api/rooms/${code}/live?person=${ana.id}`, { json: liveBody(ana.id) })).slide, 2);
  const live = (await ok("GET", `/api/rooms/${code}`)).live;
  assert.equal(live.presenterId, ana.id);
  assert.equal(live.groupId, "intro");
  assert.equal(live.at, 1_700_000_000_000);
  assert.ok(live.remainingMs > 29_000 && live.remainingMs <= 30_000);
  assert.equal(live.targetMs, 40_000);

  // Someone else's stop does not end Ana's take; hers does.
  assert.equal(await status(call("PUT", `/api/rooms/${code}/live?person=${ben.id}`, { body: "null", type: "application/json" })), 200);
  assert.equal((await ok("GET", `/api/rooms/${code}`)).live.presenterId, ana.id);
  assert.equal(await ok("PUT", `/api/rooms/${code}/live?person=${ana.id}`, { body: "null", type: "application/json" }), null);
  assert.equal((await ok("GET", `/api/rooms/${code}`)).live, null);
});

test("live state needs a person in the room", async (t) => {
  const { call, room, person } = await setup(t);
  const { code } = await room();
  const other = (await room()).code;
  const ana = await person(code, "Ana");
  const ben = await person(code, "Ben");
  const put = (where: string, query: string, body: unknown) => status(call("PUT", `/api/rooms/${where}/live${query}`, { json: body }));
  assert.equal(await put(other, `?person=${ana.id}`, liveBody(ana.id)), 404);
  assert.equal(await put(code, "?person=nobody", liveBody("nobody")), 404);
  assert.equal(await put(code, `?person=${ben.id}`, liveBody(ana.id)), 403);
  assert.equal(await put(code, "", liveBody(ana.id)), 400);
  assert.equal(await put(code, `?person=${ana.id}`, liveBody(ana.id, { remainingMs: 1.5 })), 400);
});

test("live state goes stale after ten seconds", async (t) => {
  const { ok, room, person, clock } = await setup(t);
  const { code } = await room();
  const ana = await person(code, "Ana");
  await ok("PUT", `/api/rooms/${code}/live?person=${ana.id}`, { json: liveBody(ana.id) });
  clock(6000);
  const live = (await ok("GET", `/api/rooms/${code}`)).live;
  assert.ok(live.remainingMs > 23_000 && live.remainingMs <= 24_000);
  clock(10_500);
  assert.equal((await ok("GET", `/api/rooms/${code}`)).live, null);
});

test("unknown paths, wrong methods and bad bodies", async (t) => {
  const { call, room } = await setup(t);
  const { code } = await room();
  const missing = await call("GET", "/api/nothing");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { detail: "Not found" });
  const wrong = await call("PATCH", `/api/rooms/${code}`);
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get("allow"), "GET");
  assert.equal(await status(call("GET", "/api/rooms/ABC")), 404);
  assert.equal(await status(call("POST", `/api/rooms/${code}/people`, { body: "{", type: "application/json" })), 400);
  assert.equal(await status(call("POST", `/api/rooms/${code}/people`)), 400);
});

test("NUL strings and malformed resource ids are rejected before storage", async (t) => {
  const { ok, call, room, person } = await setup(t);
  const { code } = await room();
  const ana = await person(code, "Ana");
  const nul = "Null\u0000Name";
  for (const [method, path, body] of [
    ["POST", "/api/rooms", { code: "ABC\u0000234" }],
    ["POST", `/api/rooms/${code}/people`, { name: nul }],
    ["PUT", `/api/rooms/${code}/assignments/intro`, { personId: nul }],
    ["POST", `/api/rooms/${code}/takes`, takeBody(nul, 1)],
    ["POST", `/api/rooms/${code}/takes`, takeBody(ana.id, 1, nul)],
    ["POST", `/api/rooms/${code}/takes`, takeBody(ana.id, 1, "intro", { mime: `video/${nul}` })],
    ["POST", `/api/rooms/${code}/signals`, { from: nul, to: ana.id, kind: "bye" }],
    ["POST", `/api/rooms/${code}/signals`, { from: ana.id, to: nul, kind: "bye" }],
    ["PUT", `/api/rooms/${code}/live?person=${ana.id}`, liveBody(nul)],
    ["PUT", `/api/rooms/${code}/live?person=${ana.id}`, liveBody(ana.id, { groupId: nul })],
  ] as const) {
    assert.equal(await status(call(method, path, { json: body })), 400, `${method} ${path}`);
  }
  for (const bad of [
    { ...deck, title: nul }, { ...deck, team: [nul] }, { ...deck, logo: nul },
    ...[{ id: nul }, { name: nul }, { script: [nul] }, { slides: [{ kind: nul }] }]
      .map((bad) => ({ ...deck, groups: [{ ...deck.groups[0], ...bad }] })),
  ]) {
    assert.equal(await status(call("PUT", `/api/rooms/${code}/deck`, { json: bad })), 400);
  }
  assert.equal(await status(call("GET", `/api/rooms/${code}/signals?to=%00`)), 400);
  assert.equal(await status(call("PUT", `/api/rooms/${code}/live?person=%00`, { body: "null", type: "application/json" })), 400);
  for (const id of ["%00", "bad", "f".repeat(31), "g".repeat(32), "F".repeat(32)]) {
    assert.equal(await status(call("GET", `/api/rooms/${code}/files/${id}`)), 404);
    assert.equal(await status(call("GET", `/api/rooms/${code}/takes/${id}/chunks/0`)), 404);
    assert.equal(await status(call("PUT", `/api/rooms/${code}/takes/${id}/chunks/0`, { body: "x" })), 404);
  }
  for (const id of ["%00", "bad", "f".repeat(11), "f".repeat(13), "g".repeat(12), "F".repeat(12)]) {
    assert.equal(await status(call("DELETE", `/api/rooms/${code}/people/${id}`)), 404);
  }
  const state = await ok("GET", `/api/rooms/${code}`);
  assert.deepEqual(state.people, [ana]);
  assert.deepEqual(state.takes, {});
  assert.equal(state.deck, null);
});

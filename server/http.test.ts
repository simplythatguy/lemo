// server/http.ts carries raw binary bodies both ways, up to the 4 MiB file limit.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createHandler } from "./app.ts";
import { serve } from "./http.ts";
import { Store } from "./store.ts";

test("a 4 MiB file goes through node:http and back unchanged", async (t) => {
  const store = await Store.open({ sqlite: ":memory:" });
  const server = serve(createHandler(async () => store));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const room = (await (await fetch(`${base}/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()) as { code: string };
  const image = randomBytes(4 * 1024 * 1024);
  const posted = await fetch(`${base}/rooms/${room.code}/files`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: image });
  assert.equal(posted.status, 201);
  const { id } = (await posted.json()) as { id: string };
  const got = await fetch(`${base}/rooms/${room.code}/files/${id}`);
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(image));

  const tooBig = await fetch(`${base}/rooms/${room.code}/files`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: randomBytes(4 * 1024 * 1024 + 1) });
  assert.equal(tooBig.status, 413);
  assert.match(((await tooBig.json()) as { detail: string }).detail, /at most/);
});

// `npm run smoke`: starts `npm run dev` as a fresh clone would and saves a room through the web app's /api proxy:
// create the room, upload an image, store the deck, read both back. Exits non-zero, with the servers' output, on failure.
import { spawn, spawnSync } from "node:child_process";

const WEB = "http://127.0.0.1:5173";
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

let output = "";
const dev = spawn(process.execPath, ["scripts/dev.mjs"], { stdio: ["ignore", "pipe", "pipe"] });
dev.stdout.on("data", (d) => (output += d));
dev.stderr.on("data", (d) => (output += d));
const exited = new Promise((resolve) => dev.on("exit", resolve));

// On Windows a kill ends only dev.mjs itself; taskkill /T takes the API and vite with it.
function stop() {
  if (dev.exitCode !== null || dev.signalCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(dev.pid), "/T", "/F"]);
  else dev.kill("SIGTERM");
}

async function call(method, path, init = {}) {
  const res = await fetch(`${WEB}${path}`, { method, ...init });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res;
}

async function ready() {
  const until = Date.now() + 60_000;
  for (;;) {
    if (dev.exitCode !== null) throw new Error(`npm run dev exited with ${dev.exitCode}`);
    try {
      // Vite answers 502 until the API behind it is listening; any other answer means both are up.
      if ((await fetch(`${WEB}/api/rooms/AAAAAA`)).status !== 502) return;
    } catch {}
    if (Date.now() > until) throw new Error("npm run dev did not start within 60 s");
    await new Promise((r) => setTimeout(r, 500));
  }
}

try {
  await ready();
  const { code } = await (await call("POST", "/api/rooms")).json();
  const { id } = await (await call("POST", `/api/rooms/${code}/files`, { headers: { "Content-Type": "image/png" }, body: PNG })).json();
  const src = `/api/rooms/${code}/files/${id}`;
  const deck = { title: "Smoke", team: ["Ana"], groups: [{ id: "g1", name: "Slide 1", speaker: 0, slides: [{ kind: "page", id: "s1", src }], script: ["Hello"] }] };
  await call("PUT", `/api/rooms/${code}/deck`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify(deck) });
  const room = await (await call("GET", `/api/rooms/${code}`)).json();
  if (JSON.stringify(room.deck) !== JSON.stringify(deck)) throw new Error(`The deck came back different: ${JSON.stringify(room.deck)}`);
  const image = new Uint8Array(await (await call("GET", src)).arrayBuffer());
  if (image.length !== PNG.length || image.some((b, i) => b !== PNG[i])) throw new Error("The image came back different");
  const page = await (await call("GET", "/new")).text();
  if (!page.includes('id="root"')) throw new Error("The web app did not serve its page");
  console.log(`Smoke test passed: room ${code} saved and read back through ${WEB}`);
} catch (e) {
  console.error(`Smoke test failed: ${e.message}\n\n--- npm run dev output ---\n${output}`);
  process.exitCode = 1;
} finally {
  stop();
  await exited;
}

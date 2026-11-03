// `npm run dev`: the API (server/dev.ts, restarted on change) and vite together. Ctrl-C stops both;
// if either exits, the other is stopped too.
import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["--watch", "server/dev.ts"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

for (const child of children) child.on("exit", (code) => stop(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));

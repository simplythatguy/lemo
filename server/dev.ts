// The room API on http://127.0.0.1:8787 for local work; vite proxies /api here (vite.config.ts).
import { handle } from "./app.ts";
import { SQLITE_FILE } from "./db.ts";
import { serve } from "./http.ts";

const PORT = 8787;
const server = serve(handle);
server.on("error", (e) => {
  console.error(`API could not listen on ${PORT}: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`API on http://127.0.0.1:${PORT}/api (${process.env.DATABASE_URL ? "Postgres" : SQLITE_FILE})`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}

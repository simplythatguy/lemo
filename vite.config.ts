import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API (server/dev.ts) listens on 8787 locally; on Vercel it is the function in api/.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8100",
      "/ws": {
        target: "ws://127.0.0.1:8100",
        ws: true,
      },
      "/healthz": "http://127.0.0.1:8100",
    },
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
  },
});

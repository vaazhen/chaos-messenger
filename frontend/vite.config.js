import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  server: {
    host: true,        // listen on 0.0.0.0 → exposes Network URL
    port: 5173,
    strictPort: false, // bump to next free port if 5173 is busy
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
  },
});
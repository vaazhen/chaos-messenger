import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "src/main.jsx",
        "src/styles.js",
        "src/test/**",
      ],
      thresholds: {
        statements: 65,
        lines: 65,
        branches: 55,
        functions: 45,
      },
    },
  },
});
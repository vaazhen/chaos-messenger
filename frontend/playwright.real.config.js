import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-real",
  timeout: 90_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-real" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_BASE: "http://127.0.0.1:8080/api",
      VITE_WS_URL: "http://127.0.0.1:8080/ws",
    },
  },
  projects: [
    {
      name: "chromium-real",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
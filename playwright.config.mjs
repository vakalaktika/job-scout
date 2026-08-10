import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = Number(process.env.E2E_PORT || 4173);

// Some environments ship the browser out of band. Prefer a matching local build
// when one is present so the suite does not need a download to run.
const preinstalled = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].find((path) => path && existsSync(path));

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.mjs/,
  // The fake Worker holds one scenario at a time, so tests take it in turns.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30000,
  expect: { timeout: 7000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...(preinstalled ? { launchOptions: { executablePath: preinstalled } } : {}),
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.mjs/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
        ...(preinstalled ? { launchOptions: { executablePath: preinstalled } } : {}),
      },
    },
  ],
  webServer: {
    command: `node e2e/fake-worker.mjs`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});

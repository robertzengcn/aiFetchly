/**
 * Playwright configuration for the AiFetchly Electron E2E suite (design §12).
 *
 * The suite launches the source-built E2E main bundle
 * (.vite/e2e/build/e2e-main.js) via Playwright's `_electron.launch()`. The
 * renderer is served by the existing Vite renderer dev server (port 5173,
 * strictPort) started through `webServer`.
 *
 * Playwright Electron tests use the project's installed Electron binary; no
 * Chromium browser download is required unless browser-only renderer projects
 * are added later (design §17.1).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e/specs",
  fullyParallel: false,
  // Establish a stable single-worker baseline first; raise only after measuring
  // memory + SQLite behavior under parallel Electron instances (design §2).
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  // One retry in CI so transient flake is visible as flaky in the report, but
  // first-attempt failures are still surfaced (design §12, NF-03).
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/playwright-results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "./test-results/playwright",
  webServer: {
    command: "yarn dev:renderer --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import { defineConfig } from "@playwright/test";

/**
 * Playwright Electron E2E. Two suites share this config:
 *
 *  - Workspace-redesign E2E (PRD §34.4) and the source-built ai-chat specs
 *    launch Electron via Playwright's `_electron` — no downloaded browsers.
 *  - The ai-chat specs additionally need the Vite renderer dev server, so a
 *    webServer boots it on 127.0.0.1:5173 (specs that don't use it simply
 *    ignore it). Live-AI scenarios need AIFETCHLY_E2E_LIVE_AI=1 and a
 *    configured provider backend.
 */
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
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
    // Poll instead of inotify: the worktree's file count can exceed the host's
    // inotify watcher limit (ENOSPC), which crashes the Vite dev server on
    // startup. Polling is heavier but never hits the watcher cap.
    env: { CHOKIDAR_USEPOLLING: "1", VITE_HMR_POLLING: "true" },
  },
});

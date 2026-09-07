import { defineConfig } from "@playwright/test";

/**
 * Workspace-redesign E2E (PRD §34.4). Runs against local vite build assets
 * via Playwright's Electron launcher — no downloaded browsers required.
 *
 *   yarn e2e:workspace
 *
 * Live-AI scenarios additionally need AIFETCHLY_E2E_LIVE_AI=1 and a
 * configured provider backend.
 */
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  // Acceptance criterion 37 / technical design §25.7: `yarn test:e2e` must be
  // self-contained — one command from a clean checkout starts the renderer,
  // runs the suite, and shuts everything down. Playwright owns the vite dev
  // server lifecycle (readiness = HTTP 200 on the renderer origin) and
  // reuses an already-running server locally for tight inner loops.
  webServer: {
    command: "yarn dev:renderer --port 5173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    trace: "retain-on-failure",
  },
});

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
  use: {
    trace: "retain-on-failure",
  },
});

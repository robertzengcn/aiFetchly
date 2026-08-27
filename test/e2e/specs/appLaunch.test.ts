/**
 * Application launch and security-boundary specs (design §15.1, test matrix T-01/T-02).
 *
 * These are the first Electron integration tests: they prove the source-built
 * E2E bundle launches through Playwright's _electron.launch(), reaches the
 * renderer served by the Vite dev server, mounts the app, exposes the real
 * preload bridge, and denies direct Node access — all with no external network
 * traffic and no real user state touched.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";

test.describe("Electron application launch", () => {
  test.afterEach(({ app }) => {
    // Skip teardown assertions if the app fixture failed to launch — the launch
    // error is already reported; don't mask it with a null-deref here.
    if (!app) return;
    assertCleanTeardown(app);
  });

  test("launches and renders the primary window (T-01)", async ({ app }) => {
    const { mainWindow, electronApp } = app;

    // Exactly one primary window (dev bridge + second-instance are disabled).
    expect(electronApp.windows().length).toBe(1);

    // Renderer navigated to the Vite dev-server origin.
    await expect(mainWindow).toHaveURL(/127\.0\.0\.1:5173/);

    // App landmark is mounted.
    await expect(mainWindow.locator("#app")).toHaveCount(1);
  });

  test("exposes the preload bridge and blocks direct Node access (T-02)", async ({
    app,
  }) => {
    const { mainWindow } = app;

    const security = await mainWindow.evaluate(() => {
      const w = window as unknown as Record<string, unknown> & {
        process?: { versions?: { node?: unknown } };
      };
      const proc = w.process;
      return {
        // Real preload bridge (contextBridge.exposeInMainWorld).
        hasApi: typeof w.api === "object" && w.api !== null,
        // nodeIntegration:false => no CommonJS `require` and no Node `global`.
        hasRequire: typeof w.require !== "undefined",
        hasGlobal: typeof w.global !== "undefined",
        // `process` may exist as a Vite dev-server polyfill (empty object), but
        // it must NOT expose Node internals — process.versions.node is only
        // present when nodeIntegration is on.
        hasNodeProcessVersions: typeof proc?.versions?.node !== "undefined",
      };
    });

    expect(security.hasApi).toBe(true);
    expect(security.hasRequire).toBe(false);
    expect(security.hasGlobal).toBe(false);
    expect(security.hasNodeProcessVersions).toBe(false);
  });
});

/**
 * Unified Plugin discovery & management — E2E critical flow (design §18.6).
 *
 * Covers the navigation and routing invariants of the consolidated Plugin
 * page that do NOT require the Plugin Hub backend:
 *   - exactly one visible Plugins nav destination (no Community Plugins item)
 *   - the legacy /community-plugins/list route redirects to the canonical
 *     /plugins/management?tab=discover
 *   - the four top-level sections (Discover / Installed / Sources / Issues)
 *     render in order
 *
 * The full install → Manage → Installed-sync → uninstall → return-to-Discover
 * loop requires a mocked Plugin Hub loopback server (analogous to
 * FakeOpenAiServer) plus an E2EStateSeeder path for PLUGIN_COMMUNITY_*
 * channels. The E2E harness currently has no Hub mock and the E2ENetworkGuard
 * default-denies non-loopback fetch, so that portion is documented below as a
 * skipped test rather than a silently-truncated one. It lands when a
 * FakePluginHub harness is added (renderer-only PRD scope; no backend change
 * required by this feature).
 */

import { e2eTest as test, expect } from "../fixtures/base";

test.describe("Unified Plugin discovery", () => {
  test("exposes one Plugins nav destination and no Community Plugins item", async ({
    app,
  }) => {
    const { mainWindow } = app;
    // Wait for the app shell + left navigation to mount.
    await expect(mainWindow.locator("#app")).toBeVisible();

    // Plugins nav item is present.
    await expect(
      mainWindow.getByRole("link", { name: /plugins/i }).first()
    ).toBeVisible();

    // Community Plugins must NOT appear as a separate visible nav destination.
    await expect(
      mainWindow.getByRole("link", { name: /^community plugins$/i })
    ).toHaveCount(0);
  });

  test("redirects the legacy /community-plugins/list route to canonical Discover", async ({
    app,
  }) => {
    const { mainWindow } = app;
    await mainWindow.goto(
      "http://127.0.0.1:5173/#/community-plugins/list"
    );
    // Client-side router resolves the redirect to the canonical Plugin route
    // with tab=discover. The hash route resolves to a path-bearing URL.
    await expect(mainWindow).toHaveURL(/127\.0\.0\.1:5173/);
    await expect(mainWindow).toHaveURL(/tab=discover/);
  });

  test("renders the four top-level sections in order", async ({ app }) => {
    const { mainWindow } = app;
    await mainWindow.goto(
      "http://127.0.0.1:5173/#/plugins/management?tab=discover"
    );
    // The top-level v-tabs render Discover / Installed / Sources / Issues.
    await expect(mainWindow.getByRole("tab", { name: /discover/i })).toBeVisible();
    const tabs = mainWindow.getByRole("tab");
    const texts = await tabs.allInnerTexts();
    const labels = texts.map((t) => t.trim().toLowerCase());
    const order = ["discover", "installed", "sources", "issues"];
    const indices = order.map((label) => labels.findIndex((l) => l.includes(label)));
    // Each label present.
    expect(indices.every((i) => i >= 0)).toBe(true);
    // Monotonically increasing (Discover < Installed < Sources < Issues).
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  test.skip("install → Manage → Installed sync → uninstall → return to Discover", async () => {
    // Requires a FakePluginHub loopback server + E2EStateSeeder support for
    // PLUGIN_COMMUNITY_* channels. See the file-level docstring.
  });
});

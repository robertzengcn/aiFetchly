/**
 * Unified Plugin discovery & management — E2E critical flow (design §18.6).
 *
 * Runs against the authenticated `pluginsApp` fixture whose Plugin Hub traffic
 * is pinned to the deterministic FakePluginHub loopback server
 * (VITE_PLUGIN_HUB_URL at launch; UPD-GAP-05/06). Covers:
 *
 *   - one visible Plugins nav destination, no separate Community item
 *   - legacy /community-plugins/list redirect to /plugins/management?tab=discover
 *     (authoritative real-router verification, UPD-GAP-09)
 *   - the four top-level sections render in order
 *   - the critical install loop (UPD-GAP-05): Discover → search → tag →
 *     Install → Installed chip + Manage → Manage opens Installed detail →
 *     uninstall → return to Discover → Install action restored
 *   - browser back/forward tab restoration (UPD-GAP-07)
 *   - Discover state retention across section changes with no duplicate
 *     catalog fetches (UPD-GAP-08: retained window content = no remount)
 *   - shipped touch-target rules verified in the live stylesheet (UPD-GAP-04)
 */

import { e2eTest as test, expect } from "../fixtures/base";

const PLUGINS_URL = "http://127.0.0.1:5173/#/plugins/management";
const INSTALLABLE = "e2e-fixture-plugin";
const INSTALLABLE_TAG_KEY = "e2e-tag";

test.describe("Unified Plugin discovery", () => {
  test("exposes one Plugins nav destination and no Community Plugins item", async ({
    pluginsApp,
  }) => {
    const { mainWindow } = pluginsApp;
    await expect(mainWindow.locator("#app")).toBeVisible();

    await expect(
      mainWindow.getByRole("link", { name: /^plugins$/i }).first()
    ).toBeVisible();

    await expect(
      mainWindow.getByRole("link", { name: /^community plugins$/i })
    ).toHaveCount(0);
  });

  test("redirects the legacy /community-plugins/list route to canonical Discover", async ({
    pluginsApp,
  }) => {
    const { mainWindow } = pluginsApp;
    await mainWindow.goto("http://127.0.0.1:5173/#/community-plugins/list");
    await expect(mainWindow).toHaveURL(/\/plugins\/management/);
    await expect(mainWindow).toHaveURL(/tab=discover/);
  });

  test("renders the four top-level sections in order", async ({
    pluginsApp,
  }) => {
    const { mainWindow } = pluginsApp;
    await mainWindow.goto(`${PLUGINS_URL}?tab=discover`);
    const tabs = mainWindow.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    const labels = (await tabs.allInnerTexts()).map((t) =>
      t.trim().toLowerCase()
    );
    expect(labels).toEqual(["discover", "installed", "sources", "issues"]);
  });

  test("critical flow: search → tag → install → manage → uninstall → discover", async ({
    pluginsApp,
    fakeHub,
  }) => {
    const { mainWindow } = pluginsApp;
    await mainWindow.goto(`${PLUGINS_URL}?tab=discover`);

    // 1. Discover catalog loads from the FakePluginHub.
    const card = mainWindow.getByTestId(`community-plugin-card-${INSTALLABLE}`);
    await expect(card).toBeVisible();

    // 2. Search narrows to the fixture plugin without extra catalog requests.
    const catalogFetchesAfterLoad = fakeHub.catalogRequestCount();
    await mainWindow
      .getByTestId("community-plugins-search")
      .locator("input")
      .fill("E2E Fixture");
    await expect(
      mainWindow.getByTestId("community-plugin-card-e2e-pro-plugin")
    ).toHaveCount(0);
    await expect(card).toBeVisible();
    expect(fakeHub.catalogRequestCount()).toBe(catalogFetchesAfterLoad);

    // 3. Select the fixture tag.
    await mainWindow
      .getByTestId(`community-plugin-tag-${INSTALLABLE_TAG_KEY}`)
      .click();
    await expect(card).toBeVisible();

    // 4. Install — downloads the fixture zip over the loopback E2E channel.
    await mainWindow
      .getByTestId(`community-plugin-install-${INSTALLABLE}`)
      .click();

    // 5. Card flips to Installed chip + Manage without leaving Discover.
    await expect(
      mainWindow.getByTestId(`community-plugin-status-${INSTALLABLE}`)
    ).toBeVisible();
    await expect(
      mainWindow.getByTestId(`community-plugin-manage-${INSTALLABLE}`)
    ).toBeVisible();
    expect(fakeHub.zipRequestCount()).toBeGreaterThanOrEqual(1);

    // 6. Manage switches to Installed and opens the matching detail.
    await mainWindow
      .getByTestId(`community-plugin-manage-${INSTALLABLE}`)
      .click();
    await expect(mainWindow).toHaveURL(/tab=installed/);
    const detail = mainWindow.getByRole("dialog").filter({
      hasText: "E2E Fixture Plugin",
    });
    await expect(detail).toBeVisible();
    // v-dialog closes on Escape -> emits close -> selectedName cleared.
    await mainWindow.keyboard.press("Escape");
    await expect(detail).toBeHidden();

    // 7. Uninstall from the Installed list.
    await mainWindow.getByTestId(`installed-uninstall-${INSTALLABLE}`).click();
    const confirm = mainWindow
      .getByRole("dialog")
      .filter({ hasText: /uninstall this plugin\?/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: /^uninstall$/i }).click();
    await expect(confirm).toBeHidden();

    // 8. Return to Discover — the Install action is restored after sync.
    await mainWindow.getByRole("tab", { name: /discover/i }).click();
    await expect(mainWindow).toHaveURL(/tab=discover/);
    await expect(
      mainWindow.getByTestId(`community-plugin-install-${INSTALLABLE}`)
    ).toBeVisible({ timeout: 20_000 });
  });

  test("restores sections across browser back/forward (AC-NAV-03)", async ({
    pluginsApp,
  }) => {
    const { mainWindow } = pluginsApp;
    await mainWindow.goto(`${PLUGINS_URL}?tab=discover`);
    await expect(
      mainWindow.getByRole("tab", { name: /discover/i })
    ).toBeVisible();

    await mainWindow.getByRole("tab", { name: /installed/i }).click();
    await expect(mainWindow).toHaveURL(/tab=installed/);
    await mainWindow.getByRole("tab", { name: /sources/i }).click();
    await expect(mainWindow).toHaveURL(/tab=sources/);

    await mainWindow.goBack();
    await expect(mainWindow).toHaveURL(/tab=installed/);
    await mainWindow.goBack();
    await expect(mainWindow).toHaveURL(/tab=discover/);
    await mainWindow.goForward();
    await expect(mainWindow).toHaveURL(/tab=installed/);
  });

  test("retains Discover state across section changes without duplicate catalog fetches", async ({
    pluginsApp,
    fakeHub,
  }) => {
    const { mainWindow } = pluginsApp;
    await mainWindow.goto(`${PLUGINS_URL}?tab=discover`);
    const card = mainWindow.getByTestId(`community-plugin-card-${INSTALLABLE}`);
    await expect(card).toBeVisible();

    await mainWindow
      .getByTestId("community-plugins-search")
      .locator("input")
      .fill("E2E Fixture");
    const fetchesBefore = fakeHub.catalogRequestCount();

    // Round trip Discover → Installed → Discover.
    await mainWindow.getByRole("tab", { name: /installed/i }).click();
    await expect(mainWindow).toHaveURL(/tab=installed/);
    await mainWindow.getByRole("tab", { name: /discover/i }).click();
    await expect(mainWindow).toHaveURL(/tab=discover/);

    // Search text survived (retained window content, TD-7).
    await expect(
      mainWindow.getByTestId("community-plugins-search").locator("input")
    ).toHaveValue("E2E Fixture");
    await expect(card).toBeVisible();
    await expect(
      mainWindow.getByTestId("community-plugin-card-e2e-pro-plugin")
    ).toHaveCount(0);
    // No remount → no duplicate catalog fetch / WebSocket listener.
    expect(fakeHub.catalogRequestCount()).toBe(fetchesBefore);
  });

  test("ships 44px touch-target rules in the live stylesheet (UPD-GAP-04)", async ({
    pluginsApp,
  }) => {
    const { mainWindow } = pluginsApp;
    await mainWindow.goto(`${PLUGINS_URL}?tab=discover`);
    await expect(
      mainWindow.getByTestId(`community-plugin-card-${INSTALLABLE}`)
    ).toBeVisible();

    const hasTouchRule = await mainWindow.evaluate(() => {
      const probe = (sheet: CSSStyleSheet): boolean => {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            const media = rule as CSSMediaRule;
            if (
              media.media &&
              media.media.mediaText.includes("pointer: coarse")
            ) {
              const inner = Array.from(media.cssRules).some(
                (innerRule) =>
                  innerRule.cssText.includes("min-height: 44px") ||
                  innerRule.cssText.includes("min-height:44px")
              );
              if (inner) return true;
            }
          }
          for (const rule of Array.from(sheet.cssRules)) {
            const imported = (rule as CSSImportRule).styleSheet;
            if (imported) {
              if (probe(imported)) return true;
            }
          }
        } catch {
          /* cross-origin sheet */
        }
        return false;
      };
      return Array.from(document.styleSheets).some(probe);
    });
    expect(hasTouchRule).toBe(true);
  });

  test("responsive sweep: narrow/tablet/desktop widths (UPD-GAP-10)", async ({
    pluginsApp,
  }) => {
    const { mainWindow } = pluginsApp;
    await mainWindow.goto(`${PLUGINS_URL}?tab=discover`);
    const card = mainWindow.getByTestId(`community-plugin-card-${INSTALLABLE}`);
    await expect(card).toBeVisible();

    // Column expectations from PRD §9.3: <600 → 1, 600–899 → 2 (space
    // permitting), 900–1279 → 3, ≥1280 → 3–4. Cards are never < 290px.
    for (const [width, expectedCols] of [
      [375, 1],
      [768, 2],
      [1280, 3],
    ] as const) {
      await mainWindow.setViewportSize({ width, height: 900 });
      // Electron window resize is async; wait until the grid has re-laid-out
      // to a stable width (two consecutive identical reads) so the sweep never
      // samples a mid-reflow state with stale track sizing.
      await mainWindow.waitForFunction(
        () => {
          const grid = document.querySelector<HTMLDivElement>(
            ".community-plugin-grid"
          );
          if (!grid) return false;
          const w = Math.round(grid.getBoundingClientRect().width);
          if ((grid.dataset.lastGridWidth ?? "") === String(w)) return true;
          grid.dataset.lastGridWidth = String(w);
          return false;
        },
        undefined,
        { timeout: 5_000, polling: 100 }
      );

      const layout = await mainWindow.evaluate(() => {
        const grid = document.querySelector<HTMLDivElement>(
          ".community-plugin-grid"
        );
        const cols = grid
          ? window.getComputedStyle(grid).gridTemplateColumns.split(" ").length
          : 0;
        const gridWidth = grid ? grid.getBoundingClientRect().width : 0;
        const firstCard = grid?.querySelector<HTMLElement>(
          "[data-testid^='community-plugin-card-']"
        );
        const cardWidth = firstCard
          ? firstCard.getBoundingClientRect().width
          : 0;
        // Horizontal overflow: any element wider than the viewport.
        const overflow =
          document.documentElement.scrollWidth > window.innerWidth + 1;
        // Keyboard reachability of the description affordance.
        const desc = document.querySelector<HTMLElement>(
          "[data-testid^='community-plugin-description-']"
        );
        return {
          cols,
          gridWidth,
          cardWidth,
          overflow,
          descFocusable: desc?.tabIndex === 0,
        };
      });
      expect(layout.overflow).toBe(false);
      expect(layout.cols).toBe(expectedCols);
      // PRD §9.3: cards are never narrower than 290px — except where the
      // available CONTENT width itself is smaller (navigation consumes part of
      // the viewport), where min(290px, 100%) correctly shrinks to fit.
      expect(layout.cardWidth).toBeGreaterThanOrEqual(
        Math.min(290, layout.gridWidth - 1)
      );
      expect(layout.descFocusable).toBe(true);
    }
  });
});

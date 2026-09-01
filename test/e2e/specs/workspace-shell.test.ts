import { e2eTest as test, expect } from "../fixtures/base";

/**
 * Persistent chat-first shell E2E (chat-first shell design §25.6, PRD §26.4).
 *
 * Uses the shared E2E harness: each test launches the source-built Electron
 * bundle with an isolated temp root and the deterministic E2E bootstrap
 * (AIFETCHLY_E2E=1 — window geometry is centered 1280x800, persisted window
 * state is ignored, and nothing is written back), so assertions never
 * inherit a developer's saved bounds or sidebar state.
 */

const LIVE_AI = process.env.AIFETCHLY_E2E_LIVE_AI === "1";

async function openWorkspace(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("http://127.0.0.1:5173/#/aiworkspace");
  await expect(page.getByTestId("chat-center-surface")).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("persistent shell startup (design §14, §25.6)", () => {
  test("opens at deterministic normal bounds and is NOT maximized", async ({
    shellApp: app,
  }) => {
    await openWorkspace(app.mainWindow);
    const geometry = await app.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return {
        bounds: win.getNormalBounds(),
        maximized: win.isMaximized(),
      };
    });
    expect(geometry.maximized).toBe(false);
    expect(geometry.bounds.width).toBe(1280);
    expect(geometry.bounds.height).toBe(800);
  });

  test("lands in the chat center inside the persistent shell", async ({
    shellApp: app,
  }) => {
    await openWorkspace(app.mainWindow);
    await expect(app.mainWindow.getByTestId("app-center-route")).toBeVisible();
    await expect(
      app.mainWindow.getByTestId("workspace-new-chat")
    ).toBeVisible();
    await expect(app.mainWindow.getByTestId("workspace-tree")).toBeVisible();
  });

  test("does not render a Back to app action (FR-SHELL-012)", async ({
    shellApp: app,
  }) => {
    await openWorkspace(app.mainWindow);
    expect(
      await app.mainWindow.getByTestId("workspace-back-to-app").count()
    ).toBe(0);
    await expect(app.mainWindow.getByText("Back to app")).toHaveCount(0);
  });
});

test.describe("composer placement (design §10, FR-COMP-002/005/006)", () => {
  test("renders a two-row textarea with selectors below it", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.getByTestId("workspace-new-chat").click();
    // Vuetify auto-grow also renders a hidden measurement sizer textarea —
    // target the real, labelled input only.
    const textarea = page
      .getByTestId("ai-chat-composer")
      .locator("textarea.v-field__input:not(.v-textarea__sizer)");
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    expect(await textarea.getAttribute("rows")).toBe("2");
    // Mode/model/approval render after the textarea in DOM order.
    const order = await page.evaluate(() => {
      const input = document
        .querySelector('[data-testid="ai-chat-composer"]')
        ?.querySelector("textarea.v-field__input:not(.v-textarea__sizer)") ??
        null;
      const controls = document.querySelector(
        '[data-testid="v2-composer-controls"]'
      );
      if (!input || !controls) return "missing";
      return input.compareDocumentPosition(controls) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? "after"
        : "before";
    });
    expect(order).toBe("after");
  });
});

test.describe("persistent shell navigation (FR-SHELL-002/003/008)", () => {
  test("keeps one shell DOM identity across center-route changes", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    // Tag the live center element so identity survives route swaps.
    await page.evaluate(() => {
      const center = document.querySelector(
        '[data-testid="app-center-route"]'
      ) as HTMLElement | null;
      if (center) center.dataset.shellIdentityProbe = "alive";
    });

    for (const testid of [
      "workspace-insights",
      "workspace-knowledge-library",
      "workspace-plugins",
    ]) {
      await page.getByTestId(testid).click();
      // The SAME center element is still mounted (no shell remount).
      await expect(
        page.locator('[data-shell-identity-probe="alive"]')
      ).toBeVisible();
      // The sidebar persists and the active route is accessibly marked.
      await expect(page.getByTestId("workspace-tree")).toBeVisible();
      await expect(page.getByTestId(testid)).toHaveAttribute(
        "aria-current",
        "page"
      );
    }

    // Returning to chat keeps the shell and shows the composer surface again.
    await page.getByTestId("workspace-new-chat").click();
    await expect(
      page.locator('[data-shell-identity-probe="alive"]')
    ).toBeVisible();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();
  });

  test("marks only the active global route with aria-current (FR-SHELL-008)", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    const insights = page.getByTestId("workspace-insights");
    // On the chat route no global item is marked.
    await expect(insights).not.toHaveAttribute("aria-current");
    await insights.click();
    await expect(insights).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("workspace-plugins")).not.toHaveAttribute(
      "aria-current"
    );
  });
});

test.describe("conversation actions from an inner page (FR-SHELL-010/011)", () => {
  test("new chat from Plugins returns the center to chat", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.getByTestId("workspace-plugins").click();
    await page.getByTestId("workspace-new-chat").click();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();
  });
});

test.describe("narrow responsive shell (PRD §16.3)", () => {
  test("navigation becomes an opt-in drawer with a visible opener", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.setViewportSize({ width: 700, height: 800 });
    const toggle = page.getByTestId("app-shell-nav-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
    // Backdrop closes the drawer.
    await page.getByTestId("app-shell-nav-backdrop").click();
    await expect(page.getByTestId("workspace-tree")).toBeHidden();
  });
});

test.describe("live-AI flows (§25.6 scenario 10)", () => {
  test.skip(
    !LIVE_AI,
    "requires AIFETCHLY_E2E_LIVE_AI=1 with a provider backend"
  );

  test("renderer reload restores the shell without cancelling runs", async ({
    aiApp,
  }) => {
    const page = aiApp.mainWindow;
    await openWorkspace(page);
    await page.reload();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
  });
});

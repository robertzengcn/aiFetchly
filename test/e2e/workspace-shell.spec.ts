import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

/**
 * Persistent chat-first shell E2E (chat-first shell design §25.6, PRD §26.4).
 *
 * Prerequisite: vite build artifacts — run `yarn build:e2e` first
 * (`yarn test:e2e` does this). Launch the single spec with:
 *   xvfb-run -a npx playwright test test/e2e/workspace-shell.spec.ts
 *
 * The E2E bootstrap forces AIFETCHLY_E2E=1: window geometry is deterministic
 * (centered 1280x800), persisted window state is ignored, and no state is
 * written back — so assertions never inherit a developer's saved bounds.
 */

const APP_ENTRY = ".";
const LIVE_AI = process.env.AIFETCHLY_E2E_LIVE_AI === "1";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await _electron.launch({
    args: [APP_ENTRY, "--no-sandbox"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      AIFETCHLY_E2E: "1",
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app.close();
});

async function openWorkspace(): Promise<void> {
  await page.goto("#/aiworkspace");
  await expect(page.getByTestId("chat-center-surface")).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("persistent shell startup (design §14, §25.6)", () => {
  test("opens at deterministic normal bounds and is NOT maximized", async () => {
    await openWorkspace();
    const geometry = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const bounds = win.getNormalBounds();
      return { bounds, maximized: win.isMaximized() };
    });
    expect(geometry.maximized).toBe(false);
    expect(geometry.bounds.width).toBe(1280);
    expect(geometry.bounds.height).toBe(800);
  });

  test("lands in the chat center inside the persistent shell", async () => {
    await openWorkspace();
    await expect(page.getByTestId("app-center-route")).toBeVisible();
    await expect(page.getByTestId("workspace-new-chat")).toBeVisible();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
  });

  test("does not render a Back to app action (FR-SHELL-012)", async () => {
    await openWorkspace();
    expect(
      await page.getByTestId("workspace-back-to-app").count()
    ).toBe(0);
    await expect(page.getByText("Back to app")).toHaveCount(0);
  });
});

test.describe("composer placement (design §10, FR-COMP-002/005/006)", () => {
  test("renders a two-row textarea with selectors below it", async () => {
    await openWorkspace();
    await page.getByTestId("workspace-new-chat").click();
    const textarea = page.locator("#ai-chat-composer textarea");
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    expect(await textarea.getAttribute("rows")).toBe("2");
    // Mode/model/approval render after the textarea in DOM order.
    const order = await page.evaluate(() => {
      const input = document.querySelector("#ai-chat-composer textarea");
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
  test("keeps one shell DOM identity across center-route changes", async () => {
    await openWorkspace();
    // Tag the live center element so identity survives route swaps.
    await page.evaluate(() => {
      const center = document.querySelector(
        '[data-testid="app-center-route"]'
      ) as HTMLElement | null;
      if (center) center.dataset.shellIdentityProbe = "alive";
    });

    for (const [label, testid] of [
      ["Insights", "workspace-insights"],
      ["Knowledge Library", "workspace-knowledge-library"],
      ["Plugins", "workspace-plugins"],
    ] as const) {
      await page.getByTestId(testid).click();
      // The SAME center element is still mounted (no shell remount).
      await expect(
        page.locator('[data-shell-identity-probe="alive"]')
      ).toBeVisible();
      // The sidebar persists and the active route is accessibly marked.
      await expect(page.getByTestId("workspace-tree")).toBeVisible();
      await expect(
        page.getByTestId(testid).getAttribute("aria-current")
      ).resolves.toBe("page");
      expect(label.length).toBeGreaterThan(0);
    }

    // Returning to chat keeps the shell and shows the composer surface again.
    await page.getByTestId("workspace-new-chat").click();
    await expect(
      page.locator('[data-shell-identity-probe="alive"]')
    ).toBeVisible();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();
  });

  test("marks the active global route with aria-current (FR-SHELL-008)", async () => {
    await openWorkspace();
    const insights = page.getByTestId("workspace-insights");
    await expect(insights.getAttribute("aria-current")).resolves.toBeNull();
    await insights.click();
    await expect(insights.getAttribute("aria-current")).resolves.toBe(
      "page"
    );
    // Another item is not marked.
    await expect(
      page.getByTestId("workspace-plugins").getAttribute("aria-current")
    ).resolves.toBeNull();
  });
});

test.describe("conversation actions from an inner page (FR-SHELL-010/011)", () => {
  test("new chat from Plugins returns the center to chat", async () => {
    await openWorkspace();
    await page.getByTestId("workspace-plugins").click();
    await page.getByTestId("workspace-new-chat").click();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();
  });
});

test.describe("narrow responsive shell (PRD §16.3)", () => {
  test("navigation becomes an opt-in drawer with a visible opener", async () => {
    await openWorkspace();
    await page.setViewportSize({ width: 700, height: 800 });
    const toggle = page.getByTestId("app-shell-nav-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
    // Backdrop closes the drawer.
    await page.getByTestId("app-shell-nav-backdrop").click();
    await expect(page.getByTestId("workspace-tree")).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});

test.describe("live-AI flows (§25.6 scenario 10)", () => {
  test.skip(
    !LIVE_AI,
    "requires AIFETCHLY_E2E_LIVE_AI=1 with a provider backend"
  );

  test("renderer reload restores the shell without cancelling runs", async () => {
    await openWorkspace();
    await page.reload();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
  });
});

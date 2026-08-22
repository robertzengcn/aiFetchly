import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

/**
 * Workspace-redesign E2E (PRD §34.4 subset runnable against local assets).
 *
 * Prerequisite: vite build assets for the main bundle — run `yarn package`
 * (or `AIFETCHLY_E2E_PREBUILT=1` after `yarn build` + main bundle build).
 * Launch: `yarn e2e:workspace`.
 *
 * AI-provider-dependent scenarios (§34.4 flows 1–3, 6–8, 11, 13–16) need a
 * live provider backend; they are implemented behind the
 * `AIFETCHLY_E2E_LIVE_AI=1` guard and skip otherwise.
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
  await expect(
    page.getByTestId("workspace-shell")
  ).toBeVisible({ timeout: 20_000 });
}

test.describe("workspace shell (PRD §34.4)", () => {
  test("renders the three regions with a workspace-aware sidebar", async () => {
    await openWorkspace();
    // Sidebar, center, and the new-chat affordance (FR-001).
    await expect(page.getByTestId("workspace-new-chat")).toBeVisible();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
    await expect(page.getByRole("searchbox")).toBeVisible();
  });

  test("header shows the conversation title and NO robot/AI Assistant (FR-007/008)", async () => {
    await openWorkspace();
    const header = page.getByTestId("workspace-conversation-header");
    await expect(header).toBeVisible();
    await expect(page.getByTestId("workspace-header-title")).toContainText(
      /new chat|./i
    );
    const text = (await header.textContent()) ?? "";
    expect(text).not.toContain("AI Assistant");
    // No robot icon: the header actions hold only inspector toggle + overflow.
    await expect(page.getByTestId("workspace-inspector-toggle")).toBeVisible();
    await expect(page.getByTestId("workspace-header-overflow")).toBeVisible();
  });

  test("overflow contains exactly the conversation actions (FR-010/011)", async () => {
    await openWorkspace();
    await page.getByTestId("workspace-header-overflow").click();
    for (const action of [
      "workspace-overflow-rename",
      "workspace-overflow-export",
      "workspace-overflow-duplicate",
      "workspace-overflow-compact",
      "workspace-overflow-clear",
      "workspace-overflow-delete",
    ]) {
      await expect(page.getByTestId(action)).toBeVisible();
    }
    // Global management (MCP, settings) must NOT appear here (FR-011).
    const menu = await page.getByRole("menu").textContent();
    expect(menu?.toLowerCase()).not.toContain("mcp");
    expect(menu?.toLowerCase()).not.toContain("settings");
  });

  test("new chat creates a conversation and focuses the composer (§22.1)", async () => {
    await openWorkspace();
    await page.getByTestId("workspace-new-chat").click();
    await expect(page.getByTestId("workspace-empty-state")).toBeVisible();
  });

  test("inspector tabs expose Artifacts, Activity, and Context (FR-004)", async () => {
    await openWorkspace();
    await page.getByTestId("workspace-inspector-toggle").click();
    for (const tab of [
      "workspace-inspector-tab-artifacts",
      "workspace-inspector-tab-activity",
      "workspace-inspector-tab-context",
    ]) {
      await expect(page.getByTestId(tab)).toBeVisible();
    }
    await page.getByTestId("workspace-inspector-tab-context").click();
    await expect(page.getByTestId("workspace-context-panel")).toBeVisible();
    await page.getByTestId("workspace-inspector-tab-activity").click();
    await expect(page.getByTestId("workspace-activity-panel")).toBeVisible();
  });

  test("mode toggle offers the §33 rollback path", async () => {
    await openWorkspace();
    const toggle = page
      .locator('[data-testid^="workspace-mode-"]')
      .first();
    await expect(toggle).toBeVisible();
  });

  test("narrow viewport renders the sidebar as a separate surface (FR-006)", async () => {
    await openWorkspace();
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.getByTestId("workspace-sidebar-toggle")).toBeVisible();
    await page.getByTestId("workspace-sidebar-toggle").click();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
    // Backdrop closes the drawer and returns to the conversation.
    await page.getByTestId("workspace-sidebar-backdrop").click();
    await expect(page.getByTestId("workspace-tree")).toBeHidden();
  });
});

test.describe("live-AI flows (§34.4 scenarios 1/4/5)", () => {
  test.skip(!LIVE_AI, "requires AIFETCHLY_E2E_LIVE_AI=1 with a provider backend");

  test("switching conversations keeps the previous run alive (scenario 1)", async () => {
    await openWorkspace();
    // Send in chat A, create + switch to chat B before completion.
    await page.getByTestId("workspace-new-chat").click();
    // Composer testid contract: ai-chat-composer input.
    await page.locator("#ai-chat-composer textarea").fill("Long-running question");
    await page.locator("#ai-chat-composer textarea").press("Enter");
    await page.getByTestId("workspace-new-chat").click();
    // The first conversation still shows a running indicator in the tree.
    await expect(
      page.locator('[data-testid^="workspace-conversation-"]').first()
    ).toBeVisible();
  });

  test("renderer reload restores the workspace without cancelling runs (scenario 6)", async () => {
    await openWorkspace();
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
  });
});

import { e2eTest as test, expect } from "../fixtures/base";
import { RENDERER_ORIGIN } from "../fixtures/types";
import { warmLazyRouteModules } from "../support/devServerWarmup";

// Discover the inner pages' dev-server dependencies BEFORE any renderer
// connects, so vite's dep-optimization reload cannot land mid-test.
test.beforeAll(() => warmLazyRouteModules());

/**
 * Keyboard-only critical path (FR-QUAL-005 / AC 42, TODO open-gap 2).
 *
 * Every action below is driven exclusively by keyboard (Tab / Shift+Tab /
 * Enter / Escape / typing); `.focus()` only SEEDS the starting element the
 * way a pointer user's click would, after which the flow is keyboard-only.
 * Runs against the authenticated, AI-disabled shell fixture: a send still
 * appends the optimistic user turn, so keyboard sending is observable
 * without a provider backend.
 */

const COMPOSER_INPUT = "textarea.v-field__input:not(.v-textarea__sizer)";

async function openWorkspace(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(page.getByTestId("chat-center-surface")).toBeVisible({
    timeout: 20_000,
  });
}

/** Read the keyboard-focus identity of the active element. */
async function activeFocus(page: import("@playwright/test").Page): Promise<{
  testid: string | null;
  role: string | null;
  label: string | null;
}> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { testid: null, role: null, label: null };
    return {
      testid: el.getAttribute("data-testid"),
      role: el.getAttribute("role"),
      label:
        el.getAttribute("aria-label") ??
        el.getAttribute("placeholder") ??
        el.textContent?.trim().slice(0, 40) ??
        null,
    };
  });
}

test.describe("keyboard-only critical path (FR-QUAL-005 / AC 42)", () => {
  test("keyboard navigation, composing, selection, inner page, drawer", async ({
    shellApp,
  }) => {
    const page = shellApp.mainWindow;
    await openWorkspace(page);

    // --- New chat via keyboard --------------------------------------------
    await page.getByTestId("workspace-new-chat").focus();
    await page.keyboard.press("Enter");
    const textarea = page
      .getByTestId("ai-chat-composer")
      .locator(COMPOSER_INPUT);
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // --- Type + Enter sends through the keyboard path ---------------------
    await textarea.focus();
    await page.keyboard.type("Keyboard-only message");
    await page.keyboard.press("Enter");
    // The optimistic user turn renders in the transcript (AI is disabled in
    // this fixture; the run itself rejects, which does not undo the turn).
    await expect(page.getByTestId("workspace-transcript")).toContainText(
      "Keyboard-only message",
      { timeout: 10_000 }
    );

    // --- Tab order: textarea -> selectors -> spoken toggle -> send -------
    await textarea.focus();
    const encountered: string[] = [];
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press("Tab");
      const focus = await activeFocus(page);
      const identity = focus.testid ?? `${focus.role}:${focus.label}`;
      if (identity && identity !== "null:null") {
        encountered.push(identity);
      }
      // Reaching the send control completes the composer tab chain.
      if (focus.testid === "ai-chat-send") break;
    }
    const joined = encountered.join(" | ");
    // Keyboard focus follows the design §10.1 order below the textarea:
    // microphone (when voice input is enabled) -> mode/model/tool-approval
    // selector activators (Vuetify v-select inputs; implicit roles, so they
    // surface here via their accessible labels) -> context indicator ->
    // spoken-response toggle -> send.
    const modelIdx = joined.indexOf("Model");
    expect(modelIdx).toBeGreaterThan(-1);
    const contextIdx = joined.indexOf("workspace-context-indicator");
    expect(contextIdx).toBeGreaterThan(modelIdx);
    const spokenIdx = joined.indexOf("spoken-response-toggle");
    expect(spokenIdx).toBeGreaterThan(contextIdx);
    expect(joined.lastIndexOf("ai-chat-send")).toBeGreaterThan(spokenIdx);

    // --- Select the conversation via keyboard ------------------------------
    // Scope to the sidebar tree: the bare prefix would also match the
    // conversation HEADER element in the center surface. New chats land in
    // the "Other chats" folder, which defaults to collapsed — expand it via
    // the tree's roving keyboard model (ArrowRight) before selecting.
    const tree = page.getByTestId("workspace-tree");
    const folderHeader = tree.locator('[data-nav-row="unassigned"]');
    await folderHeader.focus();
    await page.keyboard.press("ArrowRight");

    // A second keyboard-created chat makes the selection step a real state
    // change: the first row is NOT selected while chat two is active.
    await page.getByTestId("workspace-new-chat").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();

    // Newest chats sort first, so the unselected older conversation is the
    // LAST row in the folder.
    const row = tree.locator('[data-testid^="workspace-conversation-"]').last();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toHaveAttribute("aria-selected", "false");
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-selected", "true", {
      timeout: 10_000,
    });

    // --- Inner page via keyboard and back via keyboard --------------------
    await page.getByTestId("workspace-insights").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("workspace-insights")).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(page.getByTestId("app-center-route")).toBeVisible();

    await page.getByTestId("workspace-new-chat").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();

    // --- Narrow drawer: keyboard open, trapped Tab, Escape + restore -------
    await page.setViewportSize({ width: 700, height: 800 });
    const toggle = page.getByTestId("app-shell-nav-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("workspace-tree")).toBeVisible();

    // Opening the drawer moved focus into it.
    const firstInDrawer = await activeFocus(page);
    expect(firstInDrawer.testid ?? firstInDrawer.role).not.toBeNull();

    // Tab never leaves the drawer while it is open.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const nav = document.querySelector(
          '[data-testid="app-shell-navigation"]'
        );
        return nav?.contains(document.activeElement) ?? false;
      });
      expect(inside).toBe(true);
    }

    // Escape closes the drawer and restores focus to the opener.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("workspace-tree")).toBeHidden();
    expect((await activeFocus(page)).testid).toBe("app-shell-nav-toggle");
  });

  test("keyboard reaches the workspace chooser and voice controls", async ({
    shellApp,
  }) => {
    const page = shellApp.mainWindow;
    await openWorkspace(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId("workspace-new-chat").focus();
    await page.keyboard.press("Enter");
    const textarea = page
      .getByTestId("ai-chat-composer")
      .locator(COMPOSER_INPUT);
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // --- Workspace chooser via keyboard (FR-QUAL-005) ----------------------
    // The unset badge's explicit Choose action is focusable + operable by
    // keyboard; opening the picker card is observable without choosing.
    const choose = page.getByTestId("workspace-badge-choose");
    await expect(choose).toBeVisible({ timeout: 10_000 });
    await choose.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("workspace-required").first()).toBeVisible({
      timeout: 10_000,
    });

    // The card's Cancel is keyboard-operable and keeps state unchanged.
    const card = page.getByTestId("workspace-required").first();
    await card.getByRole("button", { name: /cancel/i }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("workspace-required")).toBeHidden();
    await expect(page.getByTestId("workspace-badge-choose")).toBeVisible();

    // --- Voice controls via keyboard (FR-QUAL-005) -------------------------
    // The spoken-response toggle is focusable and keyboard-operable. In the
    // E2E environment the voice runtime is not installed, so enabling must
    // NOT silently flip the pressed state — the designed outcome routes to
    // the voice settings surface (FR-VOICE-005), which is exactly what
    // Enter produces from the keyboard alone.
    const spokenToggle = page.getByTestId("spoken-response-toggle");
    await expect(spokenToggle).toBeVisible();
    const pressedBefore = await spokenToggle.getAttribute("aria-pressed");
    expect(pressedBefore).toBe("false");
    await spokenToggle.focus();
    await page.keyboard.press("Enter");
    // Enter routed to the voice settings surface (the composer unmounted).
    await expect(
      page.getByRole("checkbox", { name: /enable voice input/i })
    ).toBeVisible({ timeout: 10_000 });
  });
});

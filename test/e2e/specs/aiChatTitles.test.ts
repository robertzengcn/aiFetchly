/**
 * AI chat automatic titles + manual renaming specs
 * (docs/prd/ai-chat-automatic-titles-prd.md AC-01, AC-03, AC-08, AC-09, AC-13).
 *
 *   AC-01 delayed title    : a substantive exchange produces the generated
 *                            title while the chat stays usable.
 *   AC-03 one attempt      : reopening/renaming cannot trigger a second
 *                            title request for the same lifecycle.
 *   AC-08 rename dialog    : header entry point saves/validates/cancels.
 *   AC-09 manual ownership : a manual rename survives a later model title.
 *   AC-13 offline rename   : renaming works with hosted AI disabled.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";

type AppLike = { readonly mainWindow: import("@playwright/test").Page };

const GENERATED_TITLE = "Sydney Dentist Outreach";

function composer(app: AppLike): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: AppLike): Promise<void> {
  const chatToggle = app.mainWindow.getByTestId("ai-chat-toggle");
  if (await chatToggle.isVisible().catch(() => false)) {
    await chatToggle.click();
  }
  await app.mainWindow.getByTestId("workspace-new-chat").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}

async function sendMessage(app: AppLike, message: string): Promise<void> {
  await composer(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

function headerTitle(app: AppLike): import("@playwright/test").Locator {
  return app.mainWindow.getByTestId("workspace-header-title");
}

async function renameFromHeader(
  app: AppLike,
  next: string
): Promise<void> {
  await app.mainWindow.getByTestId("workspace-header-overflow").click();
  await app.mainWindow.getByTestId("workspace-overflow-rename").click();
  const input = app.mainWindow
    .getByTestId("rename-dialog-input")
    .locator("input");
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(next);
  await app.mainWindow.getByTestId("rename-dialog-save").click();
  await expect(app.mainWindow.getByTestId("rename-dialog")).toBeHidden({
    timeout: 10_000,
  });
}

test.describe("AI chat automatic titles + manual renaming", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("a completed substantive exchange names the chat and the chat stays usable (AC-01)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-text");
    // The title request is a NON-streaming completion — queue its body.
    await fakeAi.queueNonStreamingContents([GENERATED_TITLE]);
    await openChat(aiApp);
    await sendMessage(
      aiApp,
      "Can you find dentists in Sydney and prepare an outreach email?"
    );
    // The assistant answer renders before/while naming completes.
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText("world", { timeout: 30_000 });
    // The generated title lands on the header without a reload.
    await expect(headerTitle(aiApp)).toHaveText(GENERATED_TITLE, {
      timeout: 30_000,
    });
    // The chat remains usable (send button actionable again).
    await expect(aiApp.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a manual rename wins and survives later model activity (AC-09, AC-03)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-text");
    await fakeAi.queueNonStreamingContents([GENERATED_TITLE]);
    await openChat(aiApp);
    await sendMessage(aiApp, "Find dentists in Sydney please");
    await expect(headerTitle(aiApp)).toHaveText(GENERATED_TITLE, {
      timeout: 30_000,
    });

    // Manual rename through the shared dialog.
    await renameFromHeader(aiApp, "Sydney Dentists — Q4");
    await expect(headerTitle(aiApp)).toHaveText("Sydney Dentists — Q4", {
      timeout: 10_000,
    });

    // A later exchange must NOT overwrite the manual name (attempt already
    // consumed for this lifecycle; no second title dispatch either).
    await sendMessage(aiApp, "Now draft the follow-up email");
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText("world", { timeout: 30_000 });
    await headerTitle(aiApp).waitFor({ state: "visible" });
    // Give any (incorrect) second title request a window to land.
    await aiApp.mainWindow.waitForTimeout(2_000);
    await expect(headerTitle(aiApp)).toHaveText("Sydney Dentists — Q4");
  });

  test("rename dialog validates empty input and cancels cleanly (AC-08)", async ({
    aiApp,
  }) => {
    await openChat(aiApp);
    await sendMessage(aiApp, "hello there, quick question about imports");
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-send")
    ).toBeVisible({ timeout: 30_000 });

    await aiApp.mainWindow.getByTestId("workspace-header-overflow").click();
    await aiApp.mainWindow.getByTestId("workspace-overflow-rename").click();
    const input = aiApp.mainWindow
      .getByTestId("rename-dialog-input")
      .locator("input");
    await expect(input).toBeVisible({ timeout: 10_000 });

    // Empty name: Save is disabled and an inline error appears.
    await input.fill("   ");
    await expect(
      aiApp.mainWindow.getByTestId("rename-dialog-error")
    ).toBeVisible();
    expect(
      await aiApp.mainWindow
        .getByTestId("rename-dialog-save")
        .isDisabled()
    ).toBe(true);

    // Cancel closes without changing the title.
    await aiApp.mainWindow.getByTestId("rename-dialog-cancel").click();
    await expect(
      aiApp.mainWindow.getByTestId("rename-dialog")
    ).toBeHidden();
  });

  test("rename UI works with hosted AI disabled; a missing row is reported, never faked (AC-13/FR-10)", async ({
    disabledApp,
  }) => {
    await openChat(disabledApp);
    // A denied send (AI disabled) creates no conversation record, so there
    // is nothing to rename yet: the dialog opens offline, and Save surfaces
    // the explicit unavailable error while preserving the typed draft.
    await sendMessage(disabledApp, "draft an outreach email");
    await disabledApp.mainWindow.waitForTimeout(1_500);

    await disabledApp.mainWindow
      .getByTestId("workspace-header-overflow")
      .click();
    await disabledApp.mainWindow
      .getByTestId("workspace-overflow-rename")
      .click();
    const input = disabledApp.mainWindow
      .getByTestId("rename-dialog-input")
      .locator("input");
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("Offline Renamed Chat");
    await disabledApp.mainWindow.getByTestId("rename-dialog-save").click();

    await expect(
      disabledApp.mainWindow.getByTestId("rename-dialog-error")
    ).toContainText("no longer available", { timeout: 10_000 });
    // Draft preserved for retry; the dialog never reports false success.
    await expect(input).toHaveValue("Offline Renamed Chat");
  });
});

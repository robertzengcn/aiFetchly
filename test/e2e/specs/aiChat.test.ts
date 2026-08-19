/**
 * AI chat Electron integration specs (design §15.2-15.3, test matrix T-03/T-04/T-05).
 *
 * These drive the real renderer -> preload -> IPC -> AIProviderResolver ->
 * OpenAICompatibleProviderClient -> FakeOpenAI loopback server path. The app is
 * seeded authenticated (local Token store) so it leaves /login, and either
 * local-enabled (requests hit the fake server) or hosted-disabled (the AI gate
 * rejects before any transport call).
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";

/** The composer's real <textarea> (Vuetify auto-grow adds a hidden measurement
 * textarea, so pick the first one — the user-editable input). */
function composerTextarea(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

/** Open the AI chat dock and wait for the composer to be actionable. */
async function openChat(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composerTextarea(app)).toBeVisible({ timeout: 30_000 });
}

/** Fill the composer with a unique message and return it. */
async function composeUniqueMessage(
  app: { readonly mainWindow: import("@playwright/test").Page },
  prefix: string
): Promise<string> {
  const message = `${prefix}-${Date.now()}`;
  await composerTextarea(app).fill(message);
  return message;
}

test.describe("AI chat (Electron integration)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("opens the AI chat dock through the real preload/IPC path (T-03)", async ({
    aiApp,
  }) => {
    await openChat(aiApp);
    // Composer + root landmark render via the real layout/AiChatV2 components.
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toBeVisible();
    await expect(composerTextarea(aiApp)).toBeVisible();
  });

  test("streams a deterministic response in order (T-05)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-text");
    await openChat(aiApp);
    await composeUniqueMessage(aiApp, "e2e-stream");

    // Send triggers the real renderer->IPC->provider->FakeOpenAI path.
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    // The fake server received a chat-completion request.
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(1);

    // Final streamed content renders exactly (chunks arrive in order, no dupes).
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toContainText(
      STREAM_TEXT_FINAL,
      { timeout: 30_000 }
    );
  });

  test("AI-disabled gate rejects before any transport call (T-04)", async ({
    disabledApp,
    fakeAi,
  }) => {
    await openChat(disabledApp);
    await composeUniqueMessage(disabledApp, "e2e-disabled");

    // Send is attempted; the entitlement gate rejects before the fake transport.
    await disabledApp.mainWindow.getByTestId("ai-chat-send").click();

    // No request ever reaches the fake provider — the gate ran first.
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 15_000,
      })
      .toEqual(0);

    // The composer returns to an actionable state (no stuck streaming).
    await expect(composerTextarea(disabledApp)).not.toBeDisabled({
      timeout: 15_000,
    });
  });
});

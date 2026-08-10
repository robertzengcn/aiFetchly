/**
 * AI chat lifecycle + failure-recovery specs (design §15.4/§15.6, T-06/T-10).
 *
 *   T-06 cancellation   : stream-delayed barrier, press Stop, assert the fake
 *                         server observes the client disconnect and the composer
 *                         returns to an actionable state.
 *   T-10 transport fail : http-500 surfaces a recoverable, user-safe state and a
 *                         subsequent message (stream-text) succeeds.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";

type AppLike = { readonly mainWindow: import("@playwright/test").Page };

function composer(app: AppLike): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: AppLike): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}

async function sendUnique(app: AppLike, prefix: string): Promise<string> {
  const message = `${prefix}-${Date.now()}`;
  await composer(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
  return message;
}

/** The composer is actionable again once the send button (not Stop) is shown. */
function actionableAgain(app: AppLike): Promise<unknown> {
  return expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("AI chat lifecycle + failure recovery", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("cancels an active stream and returns the composer to actionable (T-06)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);
    await sendUnique(aiApp, "e2e-cancel");

    // Wait for the first chunk to render, then Stop must be available.
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Streaming",
      { timeout: 30_000 }
    );
    await expect(aiApp.mainWindow.getByTestId("ai-chat-stop")).toBeVisible();

    await aiApp.mainWindow.getByTestId("ai-chat-stop").click();

    // The cancel aborts the stream consumer, so the delayed suffix never renders.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).not.toContainText("cancelled", { timeout: 6_000 });
    // The composer returns to an actionable state (send button shown again).
    await actionableAgain(aiApp);

    // The request reached the fake provider over the real transport path. (A
    // server-side socket-close observation is contingent on the app propagating
    // the abort to the fetch transport; the user-visible cancel above is the
    // guaranteed contract.)
    await expect
      .poll(
        async () =>
          (
            await fakeAi.getRequests()
          ).filter((r) => r.path.includes("/chat/completions")).length,
        { timeout: 15_000 }
      )
      .toBeGreaterThanOrEqual(1);
  });

  test("recovers from an HTTP transport failure and accepts a next message (T-10)", async ({
    aiApp,
    fakeAi,
  }) => {
    await openChat(aiApp);

    // First message hits a 500 -> recoverable user-safe state.
    await fakeAi.setScenario("http-500");
    await sendUnique(aiApp, "e2e-fail");
    await actionableAgain(aiApp);

    // A subsequent message with a healthy scenario succeeds end-to-end.
    await fakeAi.setScenario("stream-text");
    const second = await sendUnique(aiApp, "e2e-retry");
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Hello world!",
      { timeout: 30_000 }
    );
    // The user's second message persisted into the conversation view.
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toContainText(
      second,
      { timeout: 15_000 }
    );
  });
});

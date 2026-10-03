/**
 * Per-AI-output actions row Electron integration spec.
 *
 * Drives the real renderer -> preload -> IPC -> AIProviderResolver ->
 * FakeOpenAI loopback path to produce a streamed assistant turn, then
 * asserts the per-message actions row:
 *   - the report button renders ICON-ONLY (no "Report AI output" text) —
 *     the compact affordance must not crowd the message row (design §11.1);
 *   - a copy icon button renders beside it.
 *
 * Clipboard-write mechanics are covered by the component test
 * (AiChatV2Message.copyAndReport.test.ts) which controls
 * navigator.clipboard/execCommand directly; this E2E spec asserts the
 * real-renderer presence and compact contract only, keeping the spec
 * deterministic under the fail-closed harness (no external backend).
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

/**
 * Click Send until the turn is observably running.
 *
 * CI #584: on slow xvfb runners the send click can dispatch while the
 * dock-open transition is still settling (frame stalls defeat the stability
 * check), silently missing the button — the draft stays, no error surfaces,
 * and no turn starts. The same signature covers a stale-render drop in the
 * composer/parent stream guards. Poll for acceptance signals (Stop button or
 * first-chunk text) and re-click while Send is still mounted; a genuinely
 * broken send path still fails loudly when the timeout exhausts. The 1s
 * settle between clicks keeps a slow-to-render turn start from double-sending
 * (once streaming, Send unmounts and the loop exits via the signals above).
 */
async function sendAndAwaitStreaming(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): Promise<void> {
  const send = app.mainWindow.getByTestId("ai-chat-send");
  const stop = app.mainWindow.getByTestId("ai-chat-stop");
  const root = app.mainWindow.getByTestId("ai-chat-root");
  await send.click();
  await expect
    .poll(
      async () => {
        if ((await stop.count()) > 0) return "streaming";
        if (((await root.textContent()) ?? "").includes("Streaming")) {
          return "streaming";
        }
        if ((await send.count()) > 0) {
          await send.click();
          // Let a just-started turn render before the next check so a slow
          // runner cannot stack a second send behind the first.
          await app.mainWindow.waitForTimeout(1_000);
          return "resent";
        }
        return "waiting";
      },
      { timeout: 30_000 }
    )
    .toBe("streaming");
}

test.describe("AI output actions row (copy + compact report)", () => {
  test.afterEach(({ aiApp, disabledApp }) => {
    const a = aiApp ?? disabledApp;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("renders the report button icon-only and a copy button after a streamed assistant turn", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-text");
    await openChat(aiApp);
    await composerTextarea(aiApp).fill("e2e-output-actions");

    // Send triggers the real renderer->IPC->provider->FakeOpenAI path.
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    // Wait for the streamed assistant turn to complete and render.
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toContainText(
      STREAM_TEXT_FINAL,
      { timeout: 30_000 }
    );

    // The per-message report button renders under the chat root. It must be
    // ICON-ONLY: the visible "Report AI output" label is hidden in compact
    // mode so it does not crowd each output row.
    const reportButton = aiApp.mainWindow
      .getByTestId("ai-chat-root")
      .getByTestId("ai-content-report-btn");
    await expect(reportButton).toBeVisible({ timeout: 30_000 });
    await expect(reportButton).not.toContainText("Report AI output");

    // The accessible name is preserved via aria-label even though the visible
    // text is gone (PRD §11.4).
    await expect(reportButton).toHaveAttribute(
      "aria-label",
      "Report this AI-generated output"
    );

    // A copy icon button renders beside the report button on the same output.
    const copyButton = aiApp.mainWindow.getByTestId("copy-message-btn");
    await expect(copyButton).toBeVisible({ timeout: 30_000 });
    await expect(copyButton).toHaveAttribute(
      "aria-label",
      "Copy this AI response"
    );
  });

  test("does not render the actions row while the assistant is still streaming", async ({
    aiApp,
    fakeAi,
  }) => {
    // stream-delayed emits one chunk fast, then holds a bounded 10s delay —
    // enough margin to assert the actions row is absent mid-stream.
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);
    await composerTextarea(aiApp).fill("e2e-streaming-no-actions");

    // The first chunk renders, proving the turn started.
    await sendAndAwaitStreaming(aiApp);

    // While streaming, the actions row (copy + report) must NOT be present —
    // it appears only on completed assistant text/image messages.
    await expect(
      aiApp.mainWindow.getByTestId("copy-message-btn")
    ).toHaveCount(0);
    await expect(
      aiApp.mainWindow.getByTestId("ai-content-report-btn")
    ).toHaveCount(0);
  });
});

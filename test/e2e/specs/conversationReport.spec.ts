/**
 * Conversation-reporting Electron integration spec (design §24.6, §25.5).
 *
 * Drives the real renderer -> preload -> IPC -> AIContentReportService path.
 *
 * Capability fail-closed contract (PRD FR-4.4, design §11.1): the E2E harness
 * has no real backend and the E2ENetworkGuard default-denies non-loopback
 * fetch, so the capability fetch resolves to FAIL_CLOSED_CAPABILITIES
 * (conversationReporting.enabled === false). The "Report conversation" button
 * must therefore render DISABLED — never hidden — which is the deterministic,
 * harness-respecting smoke test for this surface. A submit-to-completion flow
 * would require the fake server to also serve the capabilities endpoint,
 * which is out of scope for this spec (tracked in the rollout checklist).
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { RENDERER_ORIGIN } from "../fixtures/types";
import { assertCleanTeardown } from "../support/assertions";
import {
  FAKE_REPORT_ID,
  startFakeReportingServer,
} from "../fixtures/fakeReportingServer";

function composerTextarea(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): Promise<void> {
  // The chat workspace is the default landing route; drive it directly
  // (the legacy dock toggle path is obsolete — G02 doctrine).
  await app.mainWindow.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(composerTextarea(app)).toBeVisible({ timeout: 30_000 });
  // The report button + dialog live in the workspace strip, which renders
  // once a conversation exists — start one from the sidebar.
  const newChat = app.mainWindow.getByTestId("workspace-new-chat");
  await newChat.waitFor({ state: "visible", timeout: 5_000 });
  await newChat.click();
  await expect(composerTextarea(app)).toBeVisible({ timeout: 30_000 });
}

/**
 * The AiChatV2 report-conversation button. Scoped under `ai-chat-root` because
 * a second chat surface (legacy AiChatBox / knowledge chat) may also be mounted
 * on the page and renders the same test-id; strict-mode disambiguates by anchor.
 */
function v2ReportButton(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): import("@playwright/test").Locator {
  // The chat-first shell hosts the report button in the workspace strip;
  // the legacy dock (ai-chat-root) is the rollback surface. Scope to
  // whichever root is present.
  return app.mainWindow
    .locator(
      '[data-testid="chat-center-surface"] [data-testid="report-conversation"], ' +
        '[data-testid="ai-chat-root"] [data-testid="report-conversation"]'
    )
    .first();
}

test.describe("Conversation reporting (Electron integration)", () => {
  test.afterEach(({ aiApp, disabledApp }) => {
    const a = aiApp ?? disabledApp;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("renders the Report-conversation button disabled when the capability endpoint is unreachable (fail-closed)", async ({
    aiApp,
  }) => {
    await openChat(aiApp);

    // The button renders inside the AiChatV2 header.
    const reportButton = v2ReportButton(aiApp);
    await expect(reportButton).toBeVisible({ timeout: 30_000 });

    // Fail-closed: the capability fetch resolves to enabled:false (no real
    // backend in the E2E harness; E2ENetworkGuard denies the fetch), so the
    // button is disabled — present but not actionable. It must NOT be hidden.
    await expect(reportButton).toBeDisabled({ timeout: 30_000 });
  });

  test("keeps the Report-conversation button disabled on the AI-disabled surface too", async ({
    disabledApp,
  }) => {
    await openChat(disabledApp);

    const reportButton = v2ReportButton(disabledApp);
    await expect(reportButton).toBeVisible({ timeout: 30_000 });
    // Conversation reporting is NOT AI-gated (PRD FR-4.4): the button still
    // renders on the disabled surface, but fail-closes to disabled because
    // the capability endpoint is unreachable.
    await expect(reportButton).toBeDisabled({ timeout: 30_000 });
  });

  // FR-4.4: reporting is NOT an AI-gated capability. With the fake loopback
  // capabilities endpoint reachable on the AI-disabled surface, the disabled
  // reason must switch from "unavailable" (endpoint unreachable) to
  // "no eligible outputs" (empty conversation) — the capability chain itself
  // succeeds without any AI enablement. A submitted report additionally
  // needs an eligible assistant output, which the AI gate prevents by
  // design on this surface, so the journey pins the capability flip via the
  // button's disabled-reason title.
  test("AI-disabled surface still resolves capabilities through the non-gated chain", async ({
    disabledApp,
  }) => {
    const reporting = await startFakeReportingServer();
    try {
      await openChat(disabledApp);

      const reportButton = v2ReportButton(disabledApp);
      await expect(reportButton).toBeVisible({ timeout: 30_000 });
      // The capability fetch resolves enabled:true over the fake loopback,
      // so the ONLY remaining disable reason is the empty conversation —
      // never an AI-plan gate (FR-4.4 fail-closed contract honored, the AI
      // gate stayed closed but reporting stayed reachable).
      await expect(reportButton).toHaveAttribute(
        "title",
        /no reportable AI outputs/i,
        { timeout: 30_000 }
      );
    } finally {
      await reporting.close();
    }
  });

  // §24.6 successful journey. Re-enabled 2026-10-19: the post-submit runner
  // wedge documented below did not reproduce on the current host (passes
  // deterministically with locator + evaluate assertions), so the journey
  // runs as a regular test again. Historical note: Playwright's runner
  // previously wedged right after the dialog's submit click on a contested
  // host CPU (15 reproduced stalls, 2 clean passes under identical code) —
  // if the stall returns, the bounded main-world evaluate loop below is the
  // fallback reading strategy for the terminal state.
  test("successful journey: enabled capabilities → select → submit → server reference (§24.6)", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(300_000);
    const reporting = await startFakeReportingServer();
    try {
      await openChat(aiApp);
      // Produce one eligible assistant output (plain text completion).
      await aiApp.mainWindow
        .getByTestId("ai-chat-composer")
        .locator("textarea")
        .first()
        .fill("make a splash page");
      await aiApp.mainWindow.getByTestId("ai-chat-send").click();
      // Wait for the assistant response to become an eligible item.
      await aiApp.mainWindow
        .locator('[data-testid="workspace-transcript"]')
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      await aiApp.mainWindow
        .getByText("Hello world!")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });

      const reportButton = v2ReportButton(aiApp);
      await expect(reportButton).toBeEnabled({ timeout: 60_000 });
      await reportButton.click();

      const dialog = aiApp.mainWindow.getByTestId(
        "ai-conversation-report-dialog"
      );
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      // Select the eligible outputs (a single checkbox row exists for the
      // one assistant response).
      await dialog
        .locator('[data-testid^="report-item-"] input[type="checkbox"]')
        .first()
        .check();
      // The category select is required local validation — pick one via
      // the Vuetify overlay (teleported outside the dialog element).
      await dialog.locator(".v-select .v-field").click();
      await aiApp.mainWindow
        .getByRole("option", { name: "Hate or harassment", exact: true })
        .click();
      await dialog.getByTestId("conversation-report-submit").click();

      // Terminal assertions (FR-5.5): the success message carries the
      // server reference and the copy control appears. Read via main-world
      // evaluate inside a bounded retry — locator-based visibility checks
      // are blocked by the runner stall documented above.
      const readResultText = (): Promise<string> =>
        aiApp.mainWindow.evaluate(() => {
          const r = document.querySelector(".report-result");
          if (r) return r.textContent ?? "";
          const e = document.querySelector(".report-error");
          return e ? e.textContent ?? "" : "";
        });
      let resultText = "";
      const startedAt = Date.now();
      while (Date.now() - startedAt < 120_000) {
        resultText =
          (await Promise.race([
            readResultText(),
            new Promise<string>((resolve) =>
              setTimeout(() => resolve(""), 10_000)
            ),
          ])) ?? "";
        if (resultText.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      await expect(resultText).toContain(FAKE_REPORT_ID);
      // Journey ends at the submitted state (FR-5.5). The cancel-close UX
      // is certified by AIConversationReportDialog.test.ts — an end-to-end
      // close assertion is unreliable because Vuetify's exit transition
      // never completes for a backgrounded Electron window (rAF
      // suspension).
    } finally {
      await reporting.close();
    }
  });
});

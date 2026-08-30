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
import { assertCleanTeardown } from "../support/assertions";

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
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
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
  return app.mainWindow
    .getByTestId("ai-chat-root")
    .getByTestId("report-conversation");
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
});

/**
 * Plan decision card persistence (PRD §12.4–§12.7):
 *
 *  1. "Review full plan" on the awaiting-approval decision card MUST open
 *     the workspace inspector on the Activity tab (typed app-inspector
 *     bridge); the full plan document renders there BEFORE approval
 *     (FR-054/FR-055).
 *  2. Leaving the chat route to another page and returning MUST keep the
 *     awaiting-approval card — the card may never silently vanish because
 *     plan lifecycle state lives only in a renderer-only stream row.
 *
 * The fake provider scripts deterministic plan documents via the
 * EnterPlanMode + SubmitPlanForApproval tool-call chain (same script shape
 * as the AC12 parity journey).
 *
 * Relative imports only (design §9.3).
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { RENDERER_ORIGIN } from "../fixtures/types";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { Locator } from "@playwright/test";

function textarea(app: Pick<LaunchedApp, "mainWindow">): Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: Pick<LaunchedApp, "mainWindow">): Promise<void> {
  await app.mainWindow.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
  const newChat = app.mainWindow.getByTestId("workspace-new-chat");
  await newChat.waitFor({ state: "visible", timeout: 10_000 });
  await newChat.click();
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
}

async function send(
  app: Pick<LaunchedApp, "mainWindow">,
  message: string
): Promise<void> {
  await textarea(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

/** First durable conversation id (menu order mirrors the sidebar rows). */
async function firstConversationId(
  app: Pick<LaunchedApp, "mainWindow">
): Promise<string> {
  const resp = await app.mainWindow.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          invoke: (
            channel: string,
            data?: unknown
          ) => Promise<{ status: boolean; data: unknown } | undefined>;
        };
      }
    ).api;
    return await api.invoke("ai-chat-v2:conversations", JSON.stringify({}));
  });
  const convs = (resp?.data ?? []) as Array<{ conversationId: string }>;
  if (!convs[0]) throw new Error("no conversation exists");
  return convs[0].conversationId;
}

test("plan decision card: review-full-plan opens the inspector and survives navigation", async ({
  aiApp,
  fakeAi,
  testRoot,
}) => {
  test.setTimeout(300_000);
  void testRoot;
  void firstConversationId;
  const app = aiApp;

  await openChat(app);
  await fakeAi.setToolCallQueue([
    {
      name: "EnterPlanMode",
      arguments: JSON.stringify({
        rationale: "e2e plan-persist journey",
        objective: "Ship the newsletter campaign",
      }),
    },
    {
      name: "SubmitPlanForApproval",
      arguments: JSON.stringify({
        title: "Newsletter campaign",
        objective: "Ship the newsletter campaign",
        planMarkdown:
          "## Steps\n\n1. Draft the copy\n2. Schedule the send\n3. Verify the metrics",
      }),
    },
  ]);

  await send(app, "plan the campaign");
  const decisionCard = app.mainWindow.getByTestId(
    "workspace-plan-decision-card"
  );
  await expect(decisionCard).toBeVisible({ timeout: 60_000 });

  // 1) Review full plan → the inspector opens on Activity.
  await decisionCard.getByTestId("workspace-plan-review-full").click();
  const inspector = app.mainWindow.getByTestId("workspace-inspector");
  await expect(inspector).toBeVisible({ timeout: 15_000 });

  // 2) Leave the chat route to another page, then come back.
  const planConversationId = await firstConversationId(app);
  await app.mainWindow.goto(`${RENDERER_ORIGIN}/#/insights`);
  await expect
    .poll(() => app.mainWindow.evaluate(() => window.location.hash))
    .toContain("insights");
  await app.mainWindow.waitForTimeout(1_000);

  await app.mainWindow.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });

  // The awaiting-approval card must STILL be pinned after the round trip.
  await expect(decisionCard).toBeVisible({ timeout: 30_000 });

  // 3) The stronger wipe journey: select a NEW conversation (the selection
  //    handshake re-seeds the renderer buffers from the durable snapshot),
  //    then switch BACK to the plan conversation (sidebar row). The plan
  //    surface must be rebuilt from the durable plan row, not lost.
  await app.mainWindow.getByTestId("workspace-new-chat").click();
  // A fresh selection replaces the plan selection in the renderer.
  await expect(decisionCard).toHaveCount(0, { timeout: 15_000 });
  // A fresh boot may render the sidebar's "Other chats" group collapsed —
  // expand and retry (same convention as generatedImageSeed switching).
  const sidebarRow = app.mainWindow.getByTestId(
    `workspace-conversation-${planConversationId}`
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await sidebarRow.isVisible().catch(() => false)) break;
    await app.mainWindow
      .getByRole("treeitem", { name: /Other chats/ })
      .click()
      .catch(() => undefined);
    await app.mainWindow.waitForTimeout(500);
  }
  await sidebarRow.click();
  // The durable plan row re-materializes the pinned decision card.
  await expect(decisionCard).toBeVisible({ timeout: 30_000 });

  // The rebuilt card is actionable: review-full-plan re-opens the inspector.
  await decisionCard.getByTestId("workspace-plan-review-full").click();
  await expect(inspector).toBeVisible({ timeout: 15_000 });
});

/**
 * Tool approval specs (design §15.5, T-07/T-08/T-09).
 *
 * Drives the real tool-use loop with a workspace-bound tool (file_read): the fake
 * AI requests it, the SkillApprovalCard gates it, and the user allow/deny choice
 * determines whether the tool executes against the isolated workspace.
 * Conversation-scoped workspace trust (AI_WORKSPACE_SET/APPROVE) is set up through
 * the real IPC since file_read requires an approved workspace.
 */

import * as fs from "fs";
import * as path from "path";
import { e2eTest as test, expect } from "../fixtures/base";
import type { Locator } from "@playwright/test";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";

function composer(app: LaunchedApp): Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}
async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}
async function sendUnique(app: LaunchedApp, prefix: string): Promise<void> {
  await composer(app).fill(`${prefix}-${Date.now()}`);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

/**
 * Shared setup: create a workspace file, open the chat, create a conversation,
 * approve an isolated workspace for it, then trigger a file_read tool_call.
 * Resolves once the permission card for file_read is visible (tool gated, not
 * yet executed). Returns the secret content + the card locator.
 */
async function setupGatedFileRead(
  app: LaunchedApp,
  fakeAi: FakeOpenAiController
): Promise<{ secret: string; card: Locator }> {
  const wsRoot = app.testRoot.workspacePath;
  const secret = `e2e-secret-${Date.now()}`;
  fs.writeFileSync(path.join(wsRoot, "target.txt"), secret, "utf8");

  await openChat(app);
  await fakeAi.setScenario("stream-text");
  await sendUnique(app, "e2e-prep");
  await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
    timeout: 30_000,
  });

  const err = await app.mainWindow.evaluate(async (rootPath: string) => {
    const api = (
      window as unknown as {
        api: {
          invoke: (
            c: string,
            d?: unknown
          ) => Promise<
            { status: boolean; data: unknown; msg?: string } | undefined
          >;
        };
      }
    ).api;
    const convResp = await api.invoke(
      "ai-chat-v2:conversations",
      JSON.stringify({})
    );
    const convs = (convResp?.data ?? []) as Array<{ conversationId: string }>;
    if (!convs.length) return "no conversation";
    const setResp = await api.invoke(
      "ai-workspace:set",
      JSON.stringify({
        conversationId: convs[0].conversationId,
        rootPath,
        label: "e2e",
      })
    );
    const id = (setResp?.data as { id?: unknown } | undefined)?.id;
    if (typeof id !== "number")
      return `no workspace id (${setResp?.msg ?? "?"})`;
    await api.invoke("ai-workspace:approve", JSON.stringify({ id }));
    return undefined;
  }, wsRoot);
  expect(err, `workspace setup failed: ${err ?? ""}`).toBeUndefined();

  await fakeAi.setToolCall("file_read", JSON.stringify({ path: "target.txt" }));
  await sendUnique(app, "e2e-tool");
  const card = app.mainWindow.getByTestId("ai-chat-permission-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("file_read", { timeout: 15_000 });
  return { secret, card };
}

test.describe("AI tool approval (Electron integration)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (!a) return;
    // Enforce the same no-unexpected-pageerror / no-external-network invariant
    // as the sibling specs across the tool-use loop.
    assertCleanTeardown(a);
  });

  test("the tool does not execute before approval (T-07)", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const { secret } = await setupGatedFileRead(aiApp, fakeAi);
    // The permission card is shown (tool identified) but the file has NOT been
    // read yet -> the secret content is not in the conversation.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).not.toContainText(secret, { timeout: 5_000 });
  });

  test("approving runs the tool and completes the turn (T-08)", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const { secret } = await setupGatedFileRead(aiApp, fakeAi);
    await aiApp.mainWindow.getByTestId("ai-chat-permission-allow-once").click();
    // file_read executed against the workspace -> content + follow-up render.
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toContainText(
      secret,
      {
        timeout: 30_000,
      }
    );
    await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toContainText(
      "Done.",
      {
        timeout: 30_000,
      }
    );
  });

  test("denying prevents execution and leaves a rejection state (T-09)", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const { secret } = await setupGatedFileRead(aiApp, fakeAi);
    await aiApp.mainWindow.getByTestId("ai-chat-permission-deny").click();
    // The tool never executes -> the secret content never appears.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).not.toContainText(secret, { timeout: 6_000 });
    // The composer returns to an actionable state.
    await expect(aiApp.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
      timeout: 30_000,
    });
  });
});

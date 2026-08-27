/**
 * Persistence spec (design §15.7, T-12).
 *
 * Completes a streamed conversation, closes the app, relaunches with the SAME
 * isolated root + fake provider, and asserts the conversation + messages reload
 * through the real history IPC. State isolation is proven by the per-test root
 * (a different root would have no such conversation).
 */

import { test, expect } from "@playwright/test";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";

function composer(app: LaunchedApp): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}

test("conversation persists across a controlled restart (T-12)", async (testInfo) => {
  test.setTimeout(180_000);
  const fakeAi = await startFakeOpenAiServer();
  await fakeAi.setScenario("stream-text");
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  try {
    const manifest = {
      authState: "authenticated" as const,
      aiState: "local-enabled" as const,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
    };

    // --- First session: create a conversation with a unique marker message. ---
    writeStateManifest(root, manifest);
    const app1 = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app1);
      const marker = `e2e-persist-${Date.now()}`;
      await composer(app1).fill(marker);
      await app1.mainWindow.getByTestId("ai-chat-send").click();
      // Wait for the streamed response to complete -> the turn + message persist.
      await expect(app1.mainWindow.getByTestId("ai-chat-root")).toContainText(
        "Hello world!",
        { timeout: 30_000 }
      );
      await expect(app1.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
        timeout: 30_000,
      });
      await closeApp(app1);
    } catch (err) {
      await closeApp(app1);
      throw err;
    }

    // --- Second session: same root + fake provider; history must reload. ---
    await fakeAi.reset();
    await fakeAi.setScenario("stream-text");
    const app2 = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app2);
      // Assert persistence through the REAL history IPC (design T-12 step 5):
      // the conversation + marker message from session 1 reload from SQLite.
      const result = await app2.mainWindow.evaluate(async () => {
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
        const convResp = await api.invoke(
          "ai-chat-v2:conversations",
          JSON.stringify({})
        );
        const convs = (convResp?.data ?? []) as Array<{
          conversationId: string;
        }>;
        if (convs.length === 0) return { convCount: 0, hasMarker: false };
        const histResp = await api.invoke(
          "ai-chat-v2:history",
          JSON.stringify({ conversationId: convs[0].conversationId })
        );
        const serialized = JSON.stringify(histResp?.data ?? {});
        return {
          convCount: convs.length,
          hasMarker: serialized.includes("e2e-persist-"),
        };
      });
      expect(result.convCount).toBeGreaterThanOrEqual(1);
      expect(result.hasMarker).toBe(true);
      await closeApp(app2);
    } catch (err) {
      await closeApp(app2);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});

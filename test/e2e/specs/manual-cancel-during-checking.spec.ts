/**
 * Manual cancel during an enrolled turn — Stop path (PRD FR-22/FR-23,
 * AC-24/AC-25; TODO GAP-S2 #14 E2E slice).
 *
 * With the completion policy flag ON, a task-shaped message ("Search ...")
 * enrolls a real execution (engine enrollment seam, Slice 2 Unit 4). This
 * spec drives the live manual path against the source-built E2E main bundle:
 *
 *   1. Flag ON + task-shaped send with the `stream-delayed` scenario: the
 *      turn enrolls (route task_best_effort), the first chunk renders.
 *   2. Click Stop (`ai-chat-stop`) mid-stream: the stream cancels — the
 *      post-barrier "-should-be-cancelled" text NEVER renders — and the
 *      engine's stop wiring finalizes the enrolled execution cancelled
 *      (fire-and-forget through the coordinator; failures only log).
 *   3. After the cancelled turn a fresh task-shaped send still completes
 *      normally — replacement fencing must not wedge the conversation
 *      (AC-25: a second turn cannot collide with the fenced execution).
 *
 * The renderer badge (`task_execution_state` chunks) renders only once the
 * main-process emitter ships (renderer-ahead in Slice 2, mirroring goal_state),
 * so this spec pins the enrollment + Stop + recovery-contract seams that ARE
 * live today. Stop-during-verification specifically (checker in flight) is
 * covered by TaskExecutionCoordinatorControl unit tests.
 *
 * Relative imports only — the E2E test layer is deliberately decoupled from
 * `src/` (design §9.3). macOS runs directly; Linux needs `xvfb-run -a`.
 */

import { test, expect } from "@playwright/test";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";

/** Mirror of featureFlags.AI_TASK_COMPLETION_POLICY_V1_FLAG (design §9.3:
 * the E2E test layer duplicates runtime constants instead of importing src/). */
const AI_TASK_COMPLETION_POLICY_V1_FLAG =
  "ai_task_completion_policy_v1_enabled";

const TASK_CONTINUE_CHANNEL = "ai-chat-v2:task-continue";

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

test("Stop during an enrolled turn cancels the stream and the conversation recovers", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });
  try {
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: { [AI_TASK_COMPLETION_POLICY_V1_FLAG]: "true" },
    });
    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);

      // --- 1. Enrolled task turn, held open by the delayed scenario. ---
      await fakeAi.setScenario("stream-delayed");
      // TaskRequestResolver routes "search ..." to task_best_effort (action
      // verb lead with a material target) → the engine enrolls an execution.
      await composer(app).fill("Search the workspace for launch blockers");
      await app.mainWindow.getByTestId("ai-chat-send").click();
      await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
        "Streaming",
        { timeout: 30_000 }
      );

      // --- 2. Stop mid-stream: turn cancels before the barrier suffix. ---
      const stop = app.mainWindow.getByTestId("ai-chat-stop");
      await expect(stop).toBeVisible({ timeout: 15_000 });
      await stop.click();
      await expect(
        app.mainWindow.getByTestId("ai-chat-root")
      ).not.toContainText("-should-be-cancelled", { timeout: 6_000 });
      // Send re-enables once the cancelled turn unwinds.
      await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
        timeout: 30_000,
      });

      // --- 3. Fresh task-shaped send still completes (no fence wedge). ---
      await fakeAi.reset();
      await fakeAi.setScenario("stream-text");
      await composer(app).fill("Search again for the release checklist");
      await app.mainWindow.getByTestId("ai-chat-send").click();
      await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
        "Hello world!",
        { timeout: 30_000 }
      );

      // --- 4. Recovery contract stays honest on the real bridge: the
      // cancelled execution id is renderer-invisible, so an unknown parent
      // is denied (fail-closed) rather than fabricating a successor. ---
      const denied = await app.mainWindow.evaluate(
        // Parameter type is inferred from the `arg` tuple (Playwright contract);
        // an explicit mutable-tuple annotation would fail against a readonly arg.
        async ([ch, body]) => {
          const api = (
            window as unknown as {
              api: {
                invoke: (
                  channel: string,
                  data?: unknown
                ) => Promise<
                  { status: boolean; msg: string; data: unknown } | undefined
                >;
              };
            }
          ).api;
          const resp = await api.invoke(
            ch,
            typeof body === "string" ? body : JSON.stringify(body)
          );
          return resp ?? { status: false, msg: "no response", data: null };
        },
        [
          TASK_CONTINUE_CHANNEL,
          {
            parentExecutionId: "exec-synthetic-after-cancel",
            submissionId: "33333333-3333-4333-8333-333333333333",
          },
        ] as const
      );
      expect(denied.status).toBe(false);
      expect(denied.msg).toContain("Unknown parentExecutionId");

      await closeApp(app);
    } catch (err) {
      await closeApp(app);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});

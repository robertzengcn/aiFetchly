/**
 * Plans/questions + permissions certification (audit V01 bullet, R03/R04):
 *
 *   P-1 — a persistent ("always allow") grant for a FILESYSTEM tool
 *         auto-executes with no permission card in the same session AND
 *         after a controlled app relaunch (durable SKILL_PERMISSION_*
 *         token; the grant is tool-scoped, not conversation-scoped).
 *   P-2 — an "allow once" grant is session-scoped: after a relaunch the
 *         same gated tool prompts again (in-memory session grants must
 *         never leak across boots).
 *   P-3 — a stored user DENIAL persists across a relaunch: the gated tool
 *         is auto-blocked with NO card, the provider sees the denied tool
 *         result, and the turn still settles terminally.
 *   P-4 — plan mode: EnterPlanMode → AskUserQuestion parks the queue-backed
 *         turn on the durable plan question (R03's parked-continuation
 *         path through the question claim); the answer resumes the turn
 *         EXACTLY ONCE and the terminal publishes to the renderer.
 *
 * Grant-once (T-08), deny-state (T-09) and gating-before-grant (T-07) for
 * the interactive card are certified by `toolApproval.test.ts`; grant/answer
 * store-level semantics by `selectedConversation.permission.test.ts`; and
 * the exactly-once gate machinery by `aiChatWorkspaceParkedLifecycle.test.ts`
 * (R03). This spec certifies the persistence/reload matrix and the
 * question-park path against the REAL queue + engine + renderer shell.
 *
 * Relative imports only — the E2E layer is decoupled from `src/` (design
 * §9.3).
 */

import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import {
  startFakeOpenAiServer,
  type FakeOpenAiController,
} from "../fixtures/fakeOpenAiServer";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";

test.describe("plan-mode questions + permission persistence matrix (Electron)", () => {
  function composer(app: LaunchedApp): Locator {
    return app.mainWindow
      .getByTestId("ai-chat-composer")
      .locator("textarea")
      .first();
  }

  async function openChat(app: LaunchedApp): Promise<void> {
    // The chat workspace is the default landing route; the dock toggle only
    // exists when the app landed elsewhere. Handle both.
    const toggle = app.mainWindow.getByTestId("ai-chat-toggle");
    try {
      await toggle.waitFor({ state: "visible", timeout: 5000 });
      await toggle.click();
    } catch {
      /* already on the chat workspace */
    }
    await app.mainWindow.getByTestId("workspace-new-chat").click();
    await expect(composer(app)).toBeVisible({ timeout: 30000 });
  }

  async function sendAndSettleText(
    app: LaunchedApp,
    message: string
  ): Promise<void> {
    await composer(app).fill(message);
    await app.mainWindow.getByTestId("ai-chat-send").click();
    await expect(
      app.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(message, { timeout: 30000 });
    await expect(
      app.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 30000 });
    // The run strip settles before the composer is actionable again.
    await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
      timeout: 30000,
    });
  }

  /**
   * Bind + approve an isolated workspace for the CURRENT (newest)
   * conversation through the real IPC, and verify through the get channel
   * that the reading state exists.
   */
  async function approveWorkspace(
    app: LaunchedApp,
    wsRoot: string
  ): Promise<void> {
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
      const convs = (convResp?.data ?? []) as Array<{
        conversationId: string;
        title: string;
      }>;
      const target = convs[0];
      if (!target) return "no conversation";
      const setResp = await api.invoke(
        "ai-workspace:set",
        JSON.stringify({
          conversationId: target.conversationId,
          rootPath,
          label: "e2e",
        })
      );
      const id = (setResp?.data as { id?: unknown } | undefined)?.id;
      if (typeof id !== "number") return `no workspace id (${setResp?.msg ?? "?"})`;
      const approveResp = await api.invoke(
        "ai-workspace:approve",
        JSON.stringify({ id })
      );
      if (approveResp && approveResp.status === false)
        return `approve failed (${approveResp.msg ?? "?"})`;
      const getResp = await api.invoke(
        "ai-workspace:get",
        JSON.stringify({ conversationId: target.conversationId })
      );
      if (getResp && getResp.status === false) {
        return `workspace get failed (${getResp.msg ?? "?"})`;
      }
      if (!getResp?.data) {
        return `no approved workspace for conv=${target.conversationId}`;
      }
      return undefined;
    }, wsRoot);
    expect(err, `workspace setup failed: ${err ?? ""}`).toBeUndefined();
  }

  async function triggerGatedFileRead(
    app: LaunchedApp,
    fakeAi: FakeOpenAiController,
    path: string,
    marker: string
  ): Promise<void> {
    await fakeAi.setToolCall(
      "file_read",
      JSON.stringify({ path })
    );
    await composer(app).fill(marker);
    await app.mainWindow.getByTestId("ai-chat-send").click();
  }

  // ---------------------------------------------------------------------------
  // P-1: persistent grant survives a relaunch (auto-executes, no card).
  // ---------------------------------------------------------------------------
  test("P-1: always-allow persists across a relaunch and auto-executes without a card", async ({}, testInfo) => {
    test.setTimeout(300_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });

    try {
      await fakeAi.setScenario("stream-text");
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
      });

      const fs = await import("fs");
      const path = await import("path");
      const secret1 = `p1-secret-1-${Date.now()}`;
      const secret2 = `p1-secret-2-${Date.now()}`;
      const secret3 = `p1-secret-3-${Date.now()}`;
      fs.writeFileSync(path.join(root.workspacePath, "target1.txt"), secret1, "utf8");
      fs.writeFileSync(path.join(root.workspacePath, "target2.txt"), secret2, "utf8");
      fs.writeFileSync(path.join(root.workspacePath, "target3.txt"), secret3, "utf8");

      // --- Session 1: approve the workspace, always-allow, then re-request. ---
      const app1 = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        await openChat(app1);
        await sendAndSettleText(app1, `p1-prep-${Date.now()}`);
        await approveWorkspace(app1, root.workspacePath);

        await triggerGatedFileRead(app1, fakeAi, "target1.txt", `read t1 ${secret1}`);
        await expect(
          app1.mainWindow.getByTestId("ai-chat-permission-card")
        ).toBeVisible({ timeout: 30000 });
        await app1.mainWindow
          .getByTestId("ai-chat-permission-always-allow")
          .click();
        await expect(
          app1.mainWindow.getByTestId("workspace-transcript")
        ).toContainText(secret1, { timeout: 30000 });

        // A SECOND request in the same session auto-executes: no card.
        await triggerGatedFileRead(app1, fakeAi, "target2.txt", `read t2 ${secret2}`);
        await expect(
          app1.mainWindow.getByTestId("workspace-transcript")
        ).toContainText(secret2, { timeout: 30000 });
        await expect(
          app1.mainWindow.getByTestId("ai-chat-permission-card")
        ).toHaveCount(0);
        await closeApp(app1);
      } catch (err) {
        await closeApp(app1);
        throw err;
      }

      // --- Session 2 (relaunch, same root): the grant is still honored. ---
      await fakeAi.reset();
      await fakeAi.setScenario("stream-text");
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
      });
      const app2 = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        await openChat(app2);
        await sendAndSettleText(app2, `p1-prep2-${Date.now()}`);
        await approveWorkspace(app2, root.workspacePath);

        await triggerGatedFileRead(app2, fakeAi, "target3.txt", `read t3 ${secret3}`);
        await expect(
          app2.mainWindow.getByTestId("workspace-transcript")
        ).toContainText(secret3, { timeout: 30000 });
        // The persisted decision needed NO consent prompt after restart.
        await expect(
          app2.mainWindow.getByTestId("ai-chat-permission-card")
        ).toHaveCount(0);
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

  // ---------------------------------------------------------------------------
  // P-2: the session ("allow once") grant never survives a relaunch.
  // ---------------------------------------------------------------------------
  test("P-2: allow-once is session-scoped — the card prompts again after a relaunch", async ({}, testInfo) => {
    test.setTimeout(300_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });

    try {
      await fakeAi.setScenario("stream-text");
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
      });

      const fs = await import("fs");
      const path = await import("path");
      const secret = `p2-secret-${Date.now()}`;
      fs.writeFileSync(path.join(root.workspacePath, "target.txt"), secret, "utf8");

      const app1 = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        await openChat(app1);
        await sendAndSettleText(app1, `p2-prep-${Date.now()}`);
        await approveWorkspace(app1, root.workspacePath);

        await triggerGatedFileRead(app1, fakeAi, "target.txt", `read ${secret}`);
        await expect(
          app1.mainWindow.getByTestId("ai-chat-permission-card")
        ).toBeVisible({ timeout: 30000 });
        await app1.mainWindow
          .getByTestId("ai-chat-permission-allow-once")
          .click();
        await expect(
          app1.mainWindow.getByTestId("workspace-transcript")
        ).toContainText(secret, { timeout: 30000 });
        await closeApp(app1);
      } catch (err) {
        await closeApp(app1);
        throw err;
      }

      // --- Relaunch: the one-shot session grant must be gone. ---
      await fakeAi.reset();
      await fakeAi.setScenario("stream-text");
      const app2 = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        await openChat(app2);
        await sendAndSettleText(app2, `p2-prep2-${Date.now()}`);
        await approveWorkspace(app2, root.workspacePath);

        await triggerGatedFileRead(app2, fakeAi, "target.txt", `read again ${secret}`);
        // The gated tool prompts again — session grants do not carry over.
        await expect(
          app2.mainWindow.getByTestId("ai-chat-permission-card")
        ).toBeVisible({ timeout: 30000 });
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

  // ---------------------------------------------------------------------------
  // P-3: a stored denial persists and auto-blocks without a card.
  // ---------------------------------------------------------------------------
  test("P-3: a stored denial persists across a relaunch and blocks without a card", async ({}, testInfo) => {
    test.setTimeout(300_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });

    try {
      await fakeAi.setScenario("stream-text");
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
      });

      const fs = await import("fs");
      const path = await import("path");
      // The leak assertion targets the FILE CONTENT, which must differ from
      // any user-facing text (the prompt itself is visible in the transcript).
      const fileSecret = `p3-file-secret-${Date.now()}`;
      fs.writeFileSync(
        path.join(root.workspacePath, "target.txt"),
        fileSecret,
        "utf8"
      );

      const app1 = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        await openChat(app1);
        await sendAndSettleText(app1, `p3-prep-${Date.now()}`);
        await approveWorkspace(app1, root.workspacePath);

        await triggerGatedFileRead(
          app1,
          fakeAi,
          "target.txt",
          "read target.txt and tell me what it says"
        );
        await expect(
          app1.mainWindow.getByTestId("ai-chat-permission-card")
        ).toBeVisible({ timeout: 30000 });
        await app1.mainWindow.getByTestId("ai-chat-permission-deny").click();
        // Deny settles the turn without executing the tool (T-09 semantics).
        await expect(app1.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
          timeout: 30000,
        });
        await expect(
          app1.mainWindow.getByTestId("workspace-transcript")
        ).not.toContainText(fileSecret, { timeout: 6000 });
        await closeApp(app1);
      } catch (err) {
        await closeApp(app1);
        throw err;
      }

      // --- Relaunch: the denial blocks WITHOUT showing a card. ---
      await fakeAi.reset();
      await fakeAi.setScenario("stream-text");
      await fakeAi.setFollowupText("Denied as expected.");
      const app2 = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        await openChat(app2);
        await sendAndSettleText(app2, `p3-prep2-${Date.now()}`);
        await approveWorkspace(app2, root.workspacePath);

        await triggerGatedFileRead(
          app2,
          fakeAi,
          "target.txt",
          "read target.txt again"
        );
        // No prompt: the stored "denied" decision auto-blocks execution.
        await expect(
          app2.mainWindow.getByTestId("ai-chat-permission-card")
        ).toHaveCount(0, { timeout: 15000 });
        // The tool result feeds back so the turn still settles.
        await expect(
          app2.mainWindow.getByTestId("workspace-transcript")
        ).toContainText("Denied as expected.", { timeout: 30000 });
        await expect(
          app2.mainWindow.getByTestId("workspace-transcript")
        ).not.toContainText(fileSecret, { timeout: 6000 });
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

  // ---------------------------------------------------------------------------
  // P-4: plan-question park through the QUESTION claim resumes exactly once.
  // ---------------------------------------------------------------------------
  test("P-4: a plan-mode question parks the turn and one answer resumes it exactly once", async ({}, testInfo) => {
    test.setTimeout(180_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });

    try {
      await fakeAi.setScenario("stream-text");
      await fakeAi.setFollowupText("Plan ready after answers.");
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
      });

      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        await openChat(app);
        await sendAndSettleText(app, `p4-prep-${Date.now()}`);

        // Script the plan-mode tool chain: enter plan mode, then ask.
        await fakeAi.setToolCallQueue([
          {
            name: "EnterPlanMode",
            arguments: JSON.stringify({
              rationale: "e2e cert",
              objective: "Ship the newsletter campaign",
            }),
          },
          {
            name: "AskUserQuestion",
            arguments: JSON.stringify({
              questions: [
                {
                  header: "Audience",
                  question: "Who should the newsletter target?",
                  options: [
                    { label: "Existing users", description: "Current subscribers" },
                    { label: "New leads", description: "Prospects from ads" },
                  ],
                },
              ],
            }),
          },
        ]);
        await composer(app).fill("plan the campaign");
        await app.mainWindow.getByTestId("ai-chat-send").click();

        // The turn parks on the durable plan question.
        const flow = app.mainWindow.getByTestId("workspace-plan-question-flow");
        await expect(flow).toBeVisible({ timeout: 60000 });
        await expect(flow).toContainText("Audience", { timeout: 15000 });

        const requestsBefore = (await fakeAi.getRequests()).length;

        await flow.getByTestId("workspace-plan-option-0").click();
        await flow.getByTestId("workspace-plan-question-submit").click();

        // One answer → exactly ONE provider continuation round → terminal.
        await expect(
          app.mainWindow.getByTestId("workspace-transcript")
        ).toContainText("Plan ready after answers.", { timeout: 60000 });
        const requestsAfter = (await fakeAi.getRequests()).length;
        expect(
          requestsAfter - requestsBefore,
          "the answer must resume the parked turn exactly once"
        ).toBe(1);
        // The question flow is no longer actionable.
        await expect(flow).toBeHidden({ timeout: 30000 });
        await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
          timeout: 30000,
        });
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
});

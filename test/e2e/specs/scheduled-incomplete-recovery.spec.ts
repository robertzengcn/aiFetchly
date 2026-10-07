/**
 * Task recovery IPC contract — flag-off / flag-on denial paths
 * (PRD FR-20/FR-21, AC-27/AC-28; TODO GAP-S2 #14 E2E slice).
 *
 * Drives the REAL renderer → preload → IPC → coordinator chain against the
 * source-built E2E main bundle:
 *   1. With the completion policy flag OFF (the default), Continue/Retry are
 *      denied with the not-enabled message — a renderer can never reach the
 *      coordinator while the policy is dark.
 *   2. With the flag ON (state-manifest tokenOverride, allowlisted in
 *      E2EEnvironment), an unknown parent execution is denied with
 *      "Unknown parentExecutionId" — the recovery IPC reaches the real
 *      AiTaskExecutionModule lookup and fails closed on a missing parent.
 *   3. A malformed payload (missing submissionId) is rejected at the Zod
 *      boundary before any coordinator work.
 *
 * The full scheduled incomplete → badge → Retry loop needs the
 * `task_execution_state` stream emitter (renderer-ahead in Slice 2; the
 * emitter ships with the scheduled-runner wiring). This spec pins the IPC
 * contract those UI actions invoke, which is the live surface today.
 *
 * Relative imports only — the E2E test layer is deliberately decoupled from
 * `src/` (design §9.3). macOS runs directly; Linux needs `xvfb-run -a`.
 */

import { test, expect } from "@playwright/test";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import type { E2ETestRoot } from "../fixtures/types";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";

/**
 * Mirror of featureFlags.AI_TASK_COMPLETION_POLICY_V1_FLAG. The E2E test layer
 * cannot import `src/` (design §9.3), so runtime constants that must match the
 * bootstrap are duplicated as literals — same contract as E2E_ENV.
 */
const AI_TASK_COMPLETION_POLICY_V1_FLAG =
  "ai_task_completion_policy_v1_enabled";

const TASK_CONTINUE_CHANNEL = "ai-chat-v2:task-continue";
const TASK_RETRY_CHANNEL = "ai-chat-v2:task-retry";

type InvokeEnvelope = { status: boolean; msg: string; data: unknown };

/** Invoke a task-recovery channel via the real preload window.api bridge. */
async function invokeTaskChannel(
  app: LaunchedApp,
  channel: string,
  payload: unknown
): Promise<InvokeEnvelope> {
  return app.mainWindow.evaluate(
    // Parameter type is inferred from the `arg` tuple (Playwright contract);
    // an explicit mutable-tuple annotation would fail against a readonly arg.
    async ([ch, body]) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              channel: string,
              data?: unknown
            ) => Promise<InvokeEnvelope | undefined>;
          };
        }
      ).api;
      const resp = await api.invoke(
        ch,
        typeof body === "string" ? body : JSON.stringify(body)
      );
      return resp ?? { status: false, msg: "no response", data: null };
    },
    [channel, payload] as const
  );
}

interface RecoveryFixture {
  readonly root: E2ETestRoot;
  readonly app: LaunchedApp;
}

/** Launch with the policy flag forced to `flagValue` via tokenOverrides. */
async function launchWithPolicyFlag(
  fakeAiBaseUrl: string,
  root: E2ETestRoot,
  flagValue: "true" | "false"
): Promise<LaunchedApp> {
  writeStateManifest(root, {
    authState: "authenticated",
    aiState: "local-enabled",
    fakeAiBaseUrl,
    workspacePath: root.workspacePath,
    tokenOverrides: { [AI_TASK_COMPLETION_POLICY_V1_FLAG]: flagValue },
  });
  return launchAiFetchly({ testRoot: root, fakeAiBaseUrl });
}

test.describe("scheduled-incomplete recovery IPC", () => {
  test("policy flag OFF denies Continue/Retry before any coordinator work", async ({}, testInfo) => {
    test.setTimeout(180_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    try {
      const app = await launchWithPolicyFlag(
        fakeAi.providerBaseUrl,
        root,
        "false"
      );
      try {
        const request = {
          parentExecutionId: "exec-flag-off",
          submissionId: "11111111-1111-4111-8111-111111111111",
        };
        const cont = await invokeTaskChannel(
          app,
          TASK_CONTINUE_CHANNEL,
          request
        );
        expect(cont.status).toBe(false);
        expect(cont.msg).toContain("completion policy is not enabled");

        const retry = await invokeTaskChannel(app, TASK_RETRY_CHANNEL, request);
        expect(retry.status).toBe(false);
        expect(retry.msg).toContain("completion policy is not enabled");
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

  test("policy flag ON: unknown parent is denied, malformed payload rejected", async ({}, testInfo) => {
    test.setTimeout(180_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    try {
      const app = await launchWithPolicyFlag(
        fakeAi.providerBaseUrl,
        root,
        "true"
      );
      try {
        // Flag ON + AI enabled: the handler reaches the real parent lookup.
        const cont = await invokeTaskChannel(app, TASK_CONTINUE_CHANNEL, {
          parentExecutionId: "exec-does-not-exist",
          submissionId: "22222222-2222-4222-8222-222222222222",
        });
        expect(cont.status).toBe(false);
        expect(cont.msg).toContain("Unknown parentExecutionId");

        // Malformed payload fails the Zod boundary with the required-fields
        // message — no coordinator work, no invented execution.
        const malformed = await invokeTaskChannel(app, TASK_RETRY_CHANNEL, {
          parentExecutionId: "exec-does-not-exist",
        });
        expect(malformed.status).toBe(false);
        expect(malformed.msg).toContain("required");
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

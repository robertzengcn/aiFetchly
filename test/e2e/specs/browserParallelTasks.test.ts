import { expect, test } from "@playwright/test";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import { createTemporaryRoot, writeStateManifest } from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";

/**
 * T28 M-AC-01/C-AC-01/03 (E01): parallel-tasks E2E through the APP PATH.
 * E01 enablement state:
 *  - Stop-cancels-and-releases: ENABLED - the REAL batch tool runs two
 *    fast-runner lanes; a mid-run Stop cancels both and the collector
 *    cleanup releases every session (openSessions === 0).
 *  - CAPTCHA wait/resume: still test.fixme - it needs the handoff dialog
 *    driven in the MAIN WINDOW (a UI harness) plus a challenge fixture;
 *    the wait/resume mechanics are covered by the runner + control
 *    suites (R05/F06) and the handoff coordinator tests.
 */
test.describe("browser parallel tasks E2E (app-path harness)", () => {
  test("Stop cancels all tasks and releases every lease", async () => {
    test.setTimeout(180_000);
    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: "browser-parallel-tasks-e2e",
      workerIndex: 0,
    });
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
    });
    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      extraEnv: { AIFETCHLY_E2E_APP_HOOKS: "1" },
    });
    try {
      await fakeAi.setScenario("browser-decision");
      const result = await app.mainWindow.evaluate(
        async (stopAfterMs: number) => {
          const hooks = (window as unknown as {
            __e2e?: {
              runBatchAndStop?: (input: {
                readonly stopAfterMs: number;
                readonly goals: readonly string[];
              }) => Promise<{
                batchId: string;
                statuses: string[];
                openSessions: number;
              }>;
            };
          }).__e2e;
          if (!hooks?.runBatchAndStop) {
            throw new Error("e2e_hooks_missing");
          }
          return await hooks.runBatchAndStop({
            stopAfterMs,
            goals: ["slow lane A", "slow lane B"],
          });
        },
        900
      );
      // T13 semantics: UNFINISHED lanes end cancelled/partial (a user
      // stop, never a failure); a lane that already COMPLETED before the
      // stop landed keeps its honest result.
      expect(result.statuses.length).toBe(2);
      for (const status of result.statuses) {
        expect(["cancelled", "partial", "completed"]).toContain(status);
      }
      expect(result.statuses).toContain("cancelled");
      // E01/M-FR-09: every lease released - no session survives.
      expect(result.openSessions).toBe(0);
    } finally {
      await app.electronApp.close();
      await fakeAi.stop();
    }
  });

  test.fixme("CAPTCHA wait on one task does not block the other; resume completes", async () => {
    // E01 boundary: needs the handoff dialog driven in the MAIN WINDOW
    // (a UI harness) plus a challenge fixture; the wait/resume mechanics
    // are covered by the runner + control suites (R05/F06) and the
    // handoff coordinator tests.
  });
});

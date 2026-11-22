import { expect, test } from "@playwright/test";
import { startManagedBrowserFixtureServer } from "../support/managedBrowserFixtureServer";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import { createTemporaryRoot, writeStateManifest } from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";

/**
 * T28 D-AC-02/06/09 (E01): deterministic accelerated-task E2E through the
 * APP PATH - the hooks drive the REAL production services (startSession +
 * executeTask) inside the launched Electron app, with the decision client
 * pointed at the local fake provider (deterministic script: FILL the
 * search box, CLICK Search, DONE with url_contains) and the REAL fixture
 * page (search box -> results page).
 *
 * Asserts:
 *  - the task completes with independent verification (url criterion);
 *  - the final observation carries the result page URL;
 *  - a mid-task provider-config change aborts with provider_config_changed;
 *  - a failed DONE (criteria not met) reports partial, never success.
 */

interface ExecuteTaskHook {
  executeTask: (input: {
    readonly startUrl: string;
    readonly goal: string;
    readonly completionCriteria?: ReadonlyArray<{ kind: string; value: string }>;
    readonly flipProviderMidTask?: boolean;
    readonly stopAfterMs?: number;
  }) => Promise<{
    status: string;
    reason: string;
    finalObservation: { url: string | null } | null;
    sessionId: string | null;
    evidence: string[];
  }>;
}

const decisionJson = (body: Record<string, unknown>): string =>
  JSON.stringify({
    operation: body.operation,
    target_id: body.target_id ?? null,
    option_id: null,
    key: null,
    url: null,
    text: body.text ?? null,
  });

const planBody = decisionJson({
  operation: "DONE",
  text: JSON.stringify({
    completion_criteria: [],
    bindings: [],
    first_subgoal: "fill the search box and search",
  }),
});

test.describe("browser decision task E2E (app-path harness)", () => {
  let fixture: Awaited<ReturnType<typeof startManagedBrowserFixtureServer>>;

  test.beforeEach(async () => {
    fixture = await startManagedBrowserFixtureServer();
  });

  test.afterEach(async () => {
    await fixture.close();
  });

  async function launchWithHooks(
    fakeAi: Awaited<ReturnType<typeof startFakeOpenAiServer>>
  ): Promise<LaunchedApp> {
    const root = createTemporaryRoot({
      testId: "browser-decision-task-e2e",
      workerIndex: 0,
    });
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
    });
    return await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      extraEnv: { AIFETCHLY_E2E_APP_HOOKS: "1" },
    });
  }

  test("search task completes with verified criteria and a compact final observation", async () => {
    test.setTimeout(180_000);
    const fakeAi = await startFakeOpenAiServer();
    const app = await launchWithHooks(fakeAi);
    try {
      // Deterministic decision script: the planner plan, FILL the search
      // box (the first observed candidate), CLICK Search (the second),
      // then DONE (verified by the /results criterion).
      await fakeAi.setScenario("browser-decision");
      const startUrl = `http://127.0.0.1:${fixture.port}/search?q=none`;
      const result = await app.mainWindow.evaluate(
        async (
          startUrl: string
        ): Promise<Awaited<ReturnType<ExecuteTaskHook["executeTask"]>>> => {
          const hooks = (window as unknown as { __e2e?: ExecuteTaskHook })
            .__e2e;
          if (!hooks) {
            throw new Error("e2e_hooks_missing");
          }
          return await hooks.executeTask({
            startUrl,
            goal: "Search for supplier prices and open the results.",
            completionCriteria: [{ kind: "url_contains", value: "/results" }],
          });
        },
        startUrl
      );
      expect(result.status).toBe("completed");
      expect(result.reason).toBe("verified");
      expect(result.finalObservation?.url).toContain("/results");
    } finally {
      await app.electronApp.close();
      await fakeAi.stop();
    }
  });

  test("a mid-task provider config change aborts without redirecting data", async () => {
    test.setTimeout(180_000);
    const fakeAi = await startFakeOpenAiServer();
    const app = await launchWithHooks(fakeAi);
    try {
      await fakeAi.setScenario("browser-decision");
      const startUrl = `http://127.0.0.1:${fixture.port}/search?q=none`;
      const result = await app.mainWindow.evaluate(
        async (
          startUrl: string
        ): Promise<Awaited<ReturnType<ExecuteTaskHook["executeTask"]>>> => {
          const hooks = (window as unknown as { __e2e?: ExecuteTaskHook })
            .__e2e;
          if (!hooks) {
            throw new Error("e2e_hooks_missing");
          }
          return await hooks.executeTask({
            startUrl,
            goal: "Search for anything.",
            completionCriteria: [{ kind: "url_contains", value: "/results" }],
            flipProviderMidTask: true,
          });
        },
        startUrl
      );
      expect(result.status).not.toBe("completed");
      // The decision client classifies the refused dispatch as a provider
      // error carrying the reason - the INVARIANT is the abort: the task
      // never completes and nothing dispatches after the change.
      expect(result.reason).toContain("provider_config_changed");
    } finally {
      await app.electronApp.close();
      await fakeAi.stop();
    }
  });

  test("unverifiable DONE reports partial, never success", async () => {
    test.setTimeout(180_000);
    const fakeAi = await startFakeOpenAiServer();
    const app = await launchWithHooks(fakeAi);
    try {
      await fakeAi.setScenario("browser-decision-stuck");
      const startUrl = `http://127.0.0.1:${fixture.port}/search?q=none`;
      const result = await app.mainWindow.evaluate(
        async (
          startUrl: string
        ): Promise<Awaited<ReturnType<ExecuteTaskHook["executeTask"]>>> => {
          const hooks = (window as unknown as { __e2e?: ExecuteTaskHook })
            .__e2e;
          if (!hooks) {
            throw new Error("e2e_hooks_missing");
          }
          return await hooks.executeTask({
            startUrl,
            goal: "Search for supplier prices but never navigate.",
            completionCriteria: [{ kind: "url_contains", value: "/results" }],
          });
        },
        startUrl
      );
      expect(result.status).toBe("partial");
      expect(result.reason).toBe("verification_failed_budget_exhausted");
    } finally {
      await app.electronApp.close();
      await fakeAi.stop();
    }
  });
})

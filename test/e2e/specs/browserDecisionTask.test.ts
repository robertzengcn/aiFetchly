import { expect, test } from "@playwright/test";

/**
 * F23 BOUNDARY: these tests drive the Electron app through the
 * window.__e2e* hooks that the app-run harness must expose — they
 * are test.fixme until that layer lands (the deterministic fixture
 * and the worker-equivalent driver pattern are proven in
 * browserSignIn.test.ts, which PASSES).
 * T28 D-AC-02/06/09: deterministic accelerated-task E2E against a local
 * fake search fixture. The harness seeds a local page with a search box
 * and a result list; the runner executes the full loop against it through
 * the chat decision client pointed at a local fake provider (deterministic
 * script: FILL the search box, PRESS Enter, DONE with url_contains).
 *
 * Asserts:
 *  - the task completes with independent verification (url criterion);
 *  - the final observation in the tool result carries the result page URL;
 *  - a mid-task provider-config change aborts with provider_config_changed
 *    instead of silently redirecting (D-FR-02);
 *  - a failed DONE (criteria not met) reports partial, never success.
 */
test.describe("browser decision task E2E (deterministic fixture)", () => {
  const BASE = "https://localhost:8443";

  test.fixme(\"search task completes with verified criteria and a compact final observation", async ({
    page,
  }) => {
    await page.goto(`${BASE}/search?q=none`);

    const result = await page.evaluate(() =>
      (window as unknown as {
        __e2eExecuteTask?: (input: {
          sessionId: string;
          goal: string;
          completionCriteria: Array<{ kind: string; value: string }>;
        }) => Promise<{ status: string; reason: string; finalObservation: { url: string } | null }>;
      }).__e2eExecuteTask?.({
        sessionId: "mb_e2e_task",
        goal: "Search for 'supplier prices' and open the results.",
        completionCriteria: [{ kind: "url_contains", value: "/results" }],
      })
    );

    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
    expect(result!.reason).toBe("verified");
    expect(result!.finalObservation?.url).toContain("/results");
  });

  test.fixme(\"a mid-task provider config change aborts without redirecting data", async ({
    page,
  }) => {
    await page.goto(`${BASE}/search?q=none`);
    const result = await page.evaluate(() =>
      (window as unknown as {
        __e2eExecuteTaskWithConfigFlip?: (input: { sessionId: string; goal: string }) => Promise<{
          status: string;
          reason: string;
        }>;
      }).__e2eExecuteTaskWithConfigFlip?.({
        sessionId: "mb_e2e_task2",
        goal: "Search for anything.",
      })
    );
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("provider_config_changed");
  });

  test.fixme(\"unverifiable DONE reports partial, never success", async ({ page }) => {
    await page.goto(`${BASE}/search?q=none`);
    const result = await page.evaluate(() =>
      (window as unknown as {
        __e2eExecuteTask?: (input: {
          sessionId: string;
          goal: string;
          completionCriteria: Array<{ kind: string; value: string }>;
        }) => Promise<{ status: string; reason: string }>;
      }).__e2eExecuteTask?.({
        sessionId: "mb_e2e_task3",
        goal: "Search for 'supplier prices' but never navigate.",
        completionCriteria: [{ kind: "url_contains", value: "/results" }],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe("partial");
  });
});

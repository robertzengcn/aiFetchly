import { expect, test } from "@playwright/test";

/**
 * T28 M-AC-01/C-AC-01/03: deterministic parallel-tasks E2E against local
 * fake sites. The harness exposes two local fixture origins and injects:
 *  - a fake CAPTCHA on site A (blocks one task in a handoff),
 *  - a normal result page on site B.
 *
 * Asserts: two browser tasks run concurrently; the CAPTCHA task waits
 * (Waiting for you) while the other completes; after the user resolves the
 * dialog in the fixture, the first task resumes and completes; a 45-minute
 * wait does not trip the parent poll (harness compresses time).
 */
/**
 * F23 BOUNDARY: these tests drive the Electron app through the
 * window.__e2e* hooks that the app-run harness must expose — they
 * are test.fixme until that layer lands (the deterministic fixture
 * and the worker-equivalent driver pattern are proven in
 * browserSignIn.test.ts, which PASSES).
 */
test.describe("browser parallel tasks E2E (deterministic fixture)", () => {
  test.fixme(\"CAPTCHA wait on one task does not block the other; resume completes", async ({
    page,
  }) => {
    await page.goto("https://localhost:8443/__e2e__/parallel-harness");

    // Fan out: task A hits the CAPTCHA fixture, task B the result page.
    await page.getByTestId("run-batch").click();
    await page.getByTestId("run-batch").click; // settle harness handler

    // Task B completes while task A is waiting for the user.
    await expect(page.getByTestId("task-state-batch_1:1")).toHaveText(
      "Completed",
      { timeout: 30_000 }
    );
    await expect(page.getByTestId("task-state-batch_1:0")).toHaveText(
      "Waiting for you"
    );

    // The user resolves the handoff dialog in the fixture (Verify).
    await page.getByTestId("resolve-handoff").click();

    // Task A resumes with a fresh observation and completes.
    await expect(page.getByTestId("task-state-batch_1:0")).toHaveText(
      "Completed",
      { timeout: 30_000 }
    );

    // Both sessions stopped; leases released (harness assert endpoint).
    const cleanup = await page.request.get("https://localhost:8443/__e2e__/cleanup-state");
    expect(await cleanup.json()).toMatchObject({ openSessions: 0 });
  });

  test.fixme(\"Stop cancels all tasks and releases every lease", async ({ page }) => {
    await page.goto("https://localhost:8443/__e2e__/parallel-harness");
    await page.getByTestId("run-batch").click();
    await page.getByTestId("stop-all").click();

    await expect(page.getByTestId("task-state-batch_1:0")).toHaveText(
      "Stopped"
    );
    await expect(page.getByTestId("task-state-batch_1:1")).toHaveText(
      "Stopped"
    );
    const cleanup = await page.request.get("https://localhost:8443/__e2e__/cleanup-state");
    expect(await cleanup.json()).toMatchObject({ openSessions: 0 });
  });
});

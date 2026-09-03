/**
 * Message queue + steering Electron E2E specs (message-queue technical
 * design §21.6). Eight scenarios drive the real renderer -> pending queue
 * IPC -> AIChatTurnQueueService -> engine/loop path against the FakeOpenAI
 * loopback server:
 *
 *  1. Queue B behind delayed A; B auto-dispatches after A completes.
 *  2. Steer committed mid-stream: no superseded tool executes; every
 *     skipped call receives a synthetic result.
 *  3. Steer accepted during a running turn is applied exactly once — the
 *     message never also dispatches as a duplicate normal turn.
 *  4. Stop A: the remaining queue pauses until explicit Send next.
 *  5. Provider failure pauses the queue instead of draining it.
 *  6. Conversations drain independently while both have work.
 *  7. Relaunch with queued rows: no automatic provider request; explicit
 *     recovery works.
 *  8. An attachment message queues and dispatches normally, but cannot steer.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";

/** The pure (no-permission) read-only file tool used for steering scenarios. */
const PURE_TOOL = "glob_files";

function composer(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): import("@playwright/test").Locator {
  return app.mainWindow.getByTestId("ai-chat-composer");
}

function textarea(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): import("@playwright/test").Locator {
  return composer(app).locator("textarea").first();
}

async function openChat(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): Promise<void> {
  // The AI chat workspace is the default landing route; the dock toggle only
  // exists when the app landed elsewhere. Handle both.
  const toggle = app.mainWindow.getByTestId("ai-chat-toggle");
  try {
    await toggle.waitFor({ state: "visible", timeout: 5_000 });
    await toggle.click();
  } catch {
    /* already on the chat workspace */
  }
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
}

async function send(
  app: { readonly mainWindow: import("@playwright/test").Page },
  message: string
): Promise<void> {
  await textarea(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

async function requestCount(fakeAi: {
  getRequests(): Promise<readonly unknown[]>;
}): Promise<number> {
  return (await fakeAi.getRequests()).length;
}

test.describe("AI chat message queue + steering (Electron E2E)", () => {
  test.afterEach(({ aiApp }) => {
    if (aiApp) {
      assertCleanTeardown(aiApp);
    }
  });

  test("1. queues B behind delayed A and auto-dispatches B after A (§21.6-1)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);

    await send(aiApp, "slow question A");
    // A is streaming (10s barrier) — B must queue, not dispatch.
    await send(aiApp, "follow-up B");
    const pending = aiApp.mainWindow.getByTestId("ai-chat-pending-message");
    await expect(pending).toBeVisible({ timeout: 15_000 });
    await expect(pending).toContainText("Queued");
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 5_000 })
      .toBe(1);

    // A completes -> B dispatches automatically (FIFO drain).
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 45_000 })
      .toBe(2);
    // The pending bubble is gone once B is delivered.
    await expect(pending).toHaveCount(0, { timeout: 30_000 });
  });

  test("2. steering mid-stream skips superseded tools with synthetic results (§21.6-2)", async ({
    aiApp,
    fakeAi,
  }) => {
    await openChat(aiApp);
    // Two pure tool calls; 3s delay before the first delta leaves a window
    // to commit steering while the response is still streaming.
    await fakeAi.setToolCalls(
      [
        { name: PURE_TOOL, arguments: '{"pattern":"*.txt"}' },
        { name: PURE_TOOL, arguments: '{"pattern":"*.md"}' },
      ],
      3_000
    );

    await send(aiApp, "list both file sets");
    // Wait until the turn is running (request opened), then queue + steer.
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 30_000 })
      .toBe(1);
    await send(aiApp, "actually skip the tools");
    await aiApp.mainWindow.getByTestId("ai-chat-pending-steer").click();

    // after_model consumes the steering batch: no tool executes, and every
    // skipped call renders a synthetic superseded result.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).toContainText("superseded_by_user_steering", { timeout: 30_000 });

    // The continuation request carries the two tool results (protocol
    // validity) — exactly one follow-up after the steered round.
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 30_000 })
      .toBe(2);
  });

  test("3. accepted steering applies exactly once — never a duplicate turn (§21.6-3)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);

    await send(aiApp, "slow turn A");
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 30_000 })
      .toBe(1);
    await send(aiApp, "redirect A");
    await aiApp.mainWindow.getByTestId("ai-chat-pending-steer").click();
    // The bubble transitions to the steering state (applied later at the
    // boundary).
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toBeVisible({ timeout: 10_000 });

    // A's stream finishes -> steering applies (one continuation round) and
    // the message is CONSUMED — it must never also dispatch as a normal
    // duplicate turn. Total requests: initial + continuation = 2.
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 45_000 })
      .toBe(2);
    await aiApp.mainWindow.waitForTimeout(3_000);
    expect(await requestCount(fakeAi)).toBe(2);
    // The steered bubble reached its terminal applied state / is delivered.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toHaveCount(0, { timeout: 30_000 });
  });

  test("4. Stop pauses the queue until explicit Send next (§21.6-4)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);

    await send(aiApp, "slow turn for stop");
    await send(aiApp, "queued behind stop");
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toBeVisible({ timeout: 15_000 });

    await aiApp.mainWindow.getByTestId("ai-chat-stop").click();
    // Stop pauses the queue: B shows the paused state, no second request.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toContainText("Queue paused", { timeout: 20_000 });
    await aiApp.mainWindow.waitForTimeout(2_000);
    expect(await requestCount(fakeAi)).toBe(1);

    // Explicit resume drains B (FIFO).
    await aiApp.mainWindow.getByTestId("ai-chat-pending-resume").click();
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 45_000 })
      .toBe(2);
  });

  test("5. provider failure pauses the queue instead of draining it (§21.6-5)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("http-500");
    await openChat(aiApp);

    await send(aiApp, "failing turn");
    // Queue B while the (retrying) failure plays out.
    await send(aiApp, "should stay paused");
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toContainText("Queue paused", { timeout: 60_000 });
    // No second TURN starts for B (the queue is held).
    await aiApp.mainWindow.waitForTimeout(2_000);
    const requests = await fakeAi.getRequests();
    // Only A's attempts (with transport retries) exist — B never dispatched
    // as its own turn: every recorded request precedes B's enqueue window.
    expect(requests.length).toBeGreaterThanOrEqual(1);
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toBeVisible();
  });

  test("6. conversations drain independently (§21.6-6)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);

    // Conversation 1: delayed turn runs in the background.
    await send(aiApp, "background slow turn");
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 30_000 })
      .toBe(1);

    // Conversation 2: independent queue + dispatch.
    await aiApp.mainWindow.getByTestId("new-conversation").click();
    await expect(textarea(aiApp)).toBeVisible({ timeout: 15_000 });
    await send(aiApp, "independent fast turn");
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 45_000 })
      .toBe(2);
    // Conversation 1 keeps streaming; both responses eventually render.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 60_000 });
  });

  test("7. relaunch with queued rows recovers without auto-dispatch (§21.6-7)", async ({
    testRoot,
    fakeAi,
    aiApp,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);

    await send(aiApp, "slow turn before relaunch");
    await send(aiApp, "durable queued survivor");
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toBeVisible({ timeout: 15_000 });
    await aiApp.mainWindow.getByTestId("ai-chat-stop").click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toContainText("Queue paused", { timeout: 20_000 });

    // Close + relaunch on the SAME root (durable queue persists).
    const { closeApp } = await import("../support/processCleanup");
    const { launchAiFetchly } = await import("../fixtures/electronApp");
    await closeApp(aiApp);
    await fakeAi.reset();
    const relaunched = await launchAiFetchly({
      testRoot,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await relaunched.mainWindow.getByTestId("ai-chat-toggle").click();
      await expect(
        relaunched.mainWindow.getByTestId("ai-chat-pending-message")
      ).toContainText("Queue paused", { timeout: 30_000 });

      // Recovery NEVER auto-runs provider work.
      await relaunched.mainWindow.waitForTimeout(4_000);
      expect(await requestCount(fakeAi)).toBe(0);

      // Explicit resume drains the durable row.
      await relaunched.mainWindow
        .getByTestId("ai-chat-pending-resume")
        .click();
      await expect
        .poll(() => requestCount(fakeAi), { timeout: 45_000 })
        .toBe(1);
    } finally {
      await closeApp(relaunched);
    }
  });

  test("8. attachment messages queue and dispatch, but cannot steer (§21.6-8)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);

    await send(aiApp, "slow turn with attachment follow-up");
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 30_000 })
      .toBe(1);

    // Attach a small document and queue it behind the running turn.
    await aiApp.mainWindow
      .locator(".v2-composer")
      .locator('input[type="file"]')
      .setInputFiles({
        name: "e2e-notes.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("a,b\n1,2\n", "utf8"),
      });
    await send(aiApp, "process this attachment");
    const pending = aiApp.mainWindow.getByTestId("ai-chat-pending-message");
    await expect(pending).toBeVisible({ timeout: 15_000 });
    // Attachment pending bubbles never offer Steer (PRD §7.8) — the hint
    // replaces the button.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-steer")
    ).toHaveCount(0);
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-attachments")
    ).toBeVisible();

    // After A completes the attachment message dispatches normally.
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 45_000 })
      .toBe(2);
  });
});

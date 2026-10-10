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
  // Under the chat-first shell the composer renders on the empty state too,
  // but sends need a selected conversation — start one (the legacy dock
  // created a conversation implicitly on first send).
  const newChat = app.mainWindow.getByTestId("workspace-new-chat");
  try {
    await newChat.waitFor({ state: "visible", timeout: 5_000 });
    await newChat.click();
    await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
  } catch {
    /* legacy dock: no shell strip button */
  }
}

/**
 * The chat content root: the chat-first shell renders the transcript as
 * `workspace-transcript`; the legacy dock uses `ai-chat-root`. Scope text
 * containment to whichever is present.
 */
function chatRoot(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): import("@playwright/test").Locator {
  return app.mainWindow
    .locator(
      '[data-testid="workspace-transcript"], [data-testid="ai-chat-root"]'
    )
    .first();
}

/**
 * Switch the composer's tool-approval selector (dev's hardened policy gates
 * glob_files behind a Skill Permission Request in ask_for_approval mode,
 * which parks the turn before steering can consume the tools).
 */
async function selectToolApproval(
  app: { readonly mainWindow: import("@playwright/test").Page },
  optionTitle: string
): Promise<void> {
  await app.mainWindow
    .locator(".v2-tool-approval-selector")
    .locator(".v-field")
    .click();
  await app.mainWindow.getByRole("option", { name: optionTitle }).click();
}

async function send(
  app: { readonly mainWindow: import("@playwright/test").Page },
  message: string
): Promise<void> {
  await textarea(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

/**
 * Sidebar conversation rows. Scoped under the tree and matched by the
 * `v2-…` id shape — the center surface's `workspace-conversation-header`
 * testid would otherwise shadow a bare prefix match.
 */
function conversationRows(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("workspace-tree")
    .locator('[data-testid^="workspace-conversation-v2-"]');
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
    // A's provider request opens (cold-start dispatch can take seconds);
    // equality still proves B has not dispatched its own turn.
    await expect.poll(() => requestCount(fakeAi), { timeout: 30_000 }).toBe(1);

    // A completes -> B dispatches automatically (FIFO drain).
    await expect.poll(() => requestCount(fakeAi), { timeout: 45_000 }).toBe(2);
    // The pending bubble is gone once B is delivered.
    await expect(pending).toHaveCount(0, { timeout: 30_000 });
    // BOTH responses stream into the shell transcript — B's turn is
    // queue-dispatched, so this guards the detail-event bridge (a broken
    // envelope conversationId silently drops every queue-turn event).
    await expect
      .poll(
        async () =>
          (
            await chatRoot(aiApp).innerText()
          ).split("Streaming-should-be-cancelled").length - 1,
        { timeout: 45_000 }
      )
      .toBeGreaterThanOrEqual(2);
  });

  test("2. steering mid-stream skips superseded tools with synthetic results (§21.6-2)", async ({
    aiApp,
    fakeAi,
  }) => {
    await openChat(aiApp);
    // glob_files is permission-gated in ask_for_approval mode (the turn
    // parks on a Skill Permission Request before steering can consume the
    // tools) — run the steering scenario with auto-approval instead.
    await selectToolApproval(aiApp, "Approve for me");
    // Two pure tool calls; the pre-delta delay leaves a window to commit
    // steering while the response is still streaming. The two-phase claim
    // (reserve → DB claim → commit) must land inside the window, and the
    // coordinator path writes concurrently with it — keep generous margin.
    await fakeAi.setToolCalls(
      [
        { name: PURE_TOOL, arguments: '{"pattern":"*.txt"}' },
        { name: PURE_TOOL, arguments: '{"pattern":"*.md"}' },
      ],
      8_000
    );

    await send(aiApp, "list both file sets");
    // Wait until the turn is live mid-stream, then queue + steer. (The
    // request log records on COMPLETION — polling it would wait past the
    // stream and miss the steering window entirely.)
    await expect(chatRoot(aiApp)).toContainText("Generating…", {
      timeout: 30_000,
    });
    await send(aiApp, "actually skip the tools");
    await aiApp.mainWindow.getByTestId("ai-chat-pending-steer").click();

    // after_model consumes the steering batch: no tool executes, and every
    // skipped call renders a synthetic superseded result. The shell's
    // execution groups auto-collapse on completion (FR-048) and the group
    // REMOUNTS when its counter testid changes (resetting the user's expand
    // override) — expand self-healingly, then assert the row summaries.
    const group = aiApp.mainWindow.getByTestId("workspace-execution-group-2-2");
    await expect(group).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          if ((await group.locator(".execution-rows").count()) === 0) {
            await group
              .locator(".group-summary")
              .click({ timeout: 2_000 })
              .catch(() => undefined);
            return false;
          }
          return true;
        },
        { timeout: 20_000 }
      )
      .toBe(true);
    await expect(chatRoot(aiApp)).toContainText("superseded_by_user_steering", {
      timeout: 10_000,
    });

    // The continuation request carries the two tool results (protocol
    // validity) — exactly one follow-up after the steered round.
    await expect.poll(() => requestCount(fakeAi), { timeout: 30_000 }).toBe(2);
  });

  test("3. accepted steering applies exactly once — never a duplicate turn (§21.6-3)", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp);

    await send(aiApp, "slow turn A");
    // Steer while A is mid-stream (the request log records on completion —
    // polling it would miss the steering window).
    await expect(chatRoot(aiApp)).toContainText("Generating…", {
      timeout: 30_000,
    });
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
    await expect.poll(() => requestCount(fakeAi), { timeout: 45_000 }).toBe(2);
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
    await expect.poll(() => requestCount(fakeAi), { timeout: 45_000 }).toBe(2);
  });

  test("5. provider failure pauses the queue instead of draining it (§21.6-5)", async ({
    aiApp,
    fakeAi,
  }) => {
    // A definite 5xx fails fast with no transport retries, so the delayed
    // variant holds the request 4s — a deterministic busy window to queue
    // B behind the failing turn.
    await fakeAi.setScenario("http-500-delayed");
    await openChat(aiApp);

    await send(aiApp, "failing turn");
    // Queue B while the failure plays out.
    await send(aiApp, "should stay paused");
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-pending-message")
    ).toContainText("Queue paused", { timeout: 60_000 });
    // No second TURN starts for B (the queue is held).
    await aiApp.mainWindow.waitForTimeout(2_000);
    const requests = await fakeAi.getRequests();
    // Only A's attempt exists — B never dispatched as its own turn.
    expect(requests.length).toBe(1);
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
    await expect.poll(() => requestCount(fakeAi), { timeout: 30_000 }).toBe(1);

    // Conversation 2: independent queue + dispatch. The chat-first shell
    // starts a new conversation from the sidebar strip (the legacy dock used
    // a header new-conversation button — handle both).
    const newConversation = aiApp.mainWindow.getByTestId("new-conversation");
    if (await newConversation.isVisible().catch(() => false)) {
      await newConversation.click();
    } else {
      await aiApp.mainWindow.getByTestId("workspace-new-chat").click();
    }
    await expect(textarea(aiApp)).toBeVisible({ timeout: 15_000 });
    await send(aiApp, "independent fast turn");
    await expect.poll(() => requestCount(fakeAi), { timeout: 45_000 }).toBe(2);
    // Conversation 2's own response renders in its transcript (the
    // stream-delayed scenario's final text). Conversation 1 kept streaming
    // independently; its final content renders once re-selected — under the
    // shell's selected-conversation routing, detail events follow selection.
    const delayedFinal = "Streaming-should-be-cancelled";
    await expect(chatRoot(aiApp)).toContainText(delayedFinal, {
      timeout: 60_000,
    });
    const firstConversation = conversationRows(aiApp).last(); // sidebar sorts newest-first: the oldest row is conversation 1
    if (await firstConversation.isVisible().catch(() => false)) {
      await firstConversation.click();
      await expect(chatRoot(aiApp)).toContainText(delayedFinal, {
        timeout: 60_000,
      });
    }
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
      // The chat workspace is the default landing route; the dock toggle only
      // exists when the app landed elsewhere. Handle both.
      const relaunchedToggle =
        relaunched.mainWindow.getByTestId("ai-chat-toggle");
      try {
        await relaunchedToggle.waitFor({ state: "visible", timeout: 5_000 });
        await relaunchedToggle.click();
      } catch {
        /* already on the chat workspace */
      }
      // The shell lands unselected: pick the paused conversation from the
      // sidebar so its durable pending rows render (the legacy dock
      // auto-selected the most recent conversation). A fresh boot may render
      // the sidebar tree group collapsed — expand it, then select the row.
      const relaunchedConversation = conversationRows(relaunched).first();
      if (!(await relaunchedConversation.isVisible().catch(() => false))) {
        await relaunched.mainWindow
          .getByRole("treeitem", { name: /Other chats/ })
          .click()
          .catch(() => undefined);
      }
      await relaunchedConversation.waitFor({
        state: "visible",
        timeout: 15_000,
      });
      await relaunchedConversation.click();
      await expect(
        relaunched.mainWindow.getByTestId("ai-chat-pending-message")
      ).toContainText("Queue paused", { timeout: 30_000 });

      // Recovery NEVER auto-runs provider work.
      await relaunched.mainWindow.waitForTimeout(4_000);
      expect(await requestCount(fakeAi)).toBe(0);

      // Explicit resume drains the durable row.
      await relaunched.mainWindow.getByTestId("ai-chat-pending-resume").click();
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
    // Queue the attachment while A is still mid-stream (the request log
    // records on completion — polling it would let A finish first and B
    // would dispatch instead of queue).
    await expect(chatRoot(aiApp)).toContainText("Generating…", {
      timeout: 30_000,
    });

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
    await expect.poll(() => requestCount(fakeAi), { timeout: 45_000 }).toBe(2);
  });
});

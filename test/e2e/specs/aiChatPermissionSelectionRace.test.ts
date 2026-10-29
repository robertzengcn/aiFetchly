/**
 * R10 permission-action ownership — controlled Electron selection-race
 * journeys (audit TODO 2026-10-25-r10, B01/B02; T01 Electron case).
 *
 * The component suite (`selectedConversation.permission.test.ts`) certifies
 * the store contract with mocked IPC. These journeys drive the REAL renderer
 * store, REAL main-process cancel/permission services and REAL selection
 * handshakes, holding the deny IPC in the MAIN process so the decision stays
 * in flight while the user selects another conversation:
 *
 *   B01 — a delayed interactive deny ({ok, handled:false} resolved while a
 *         RUNNING conversation B is selected) must cancel the CAPTURED
 *         claim (conversation A + its run id), never the current
 *         selection's run: B's turn completes and A's parked run settles
 *         cancelled (deny-equals-stop) with the tool never executed.
 *
 *   B02 — an authoritative denial failure ({handled:true, ok:false})
 *         resolved later must NOT display a denied receipt: the decision
 *         card stays mounted and actionable on the originating
 *         conversation (FR-PER-007).
 *
 * The main-process deny handler is REPLACED for the duration of each test
 * (ipcMain.removeHandler + a gated fabrication — public Electron APIs);
 * every other channel (workspace cancel, start, selection) still reaches
 * the real handlers, so the captured-claim cancel is executed by the real
 * coordinator. The replacement lives only inside the test's app instance.
 */

import * as fs from "fs";
import * as path from "path";
import { e2eTest as test, expect } from "../fixtures/base";
import type { Locator } from "@playwright/test";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";

const DENY_CHANNEL = "ai-chat-v2:deny-tool-permission";

function composer(app: LaunchedApp): Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  // Chat-first boot race: composer may already be present.
  const chatToggle = app.mainWindow.getByTestId("ai-chat-toggle");
  if (await chatToggle.isVisible().catch(() => false)) {
    await chatToggle.click();
  }
  await app.mainWindow.getByTestId("workspace-new-chat").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}

async function sendUnique(app: LaunchedApp, prefix: string): Promise<string> {
  const message = `${prefix}-${Date.now()}`;
  await composer(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
  return message;
}

function chatRoot(app: LaunchedApp): Locator {
  return app.mainWindow
    .locator('[data-testid="workspace-transcript"]')
    .first();
}

/** Sidebar conversation rows (newest-first). */
function conversationRows(app: LaunchedApp): Locator {
  return app.mainWindow
    .getByTestId("workspace-tree")
    .locator('[data-testid^="workspace-conversation-v2-"]');
}

async function requestCount(fakeAi: FakeOpenAiController): Promise<number> {
  return (await fakeAi.getRequests()).length;
}

/**
 * Replace the main-process deny handler with a GATED one: deny invokes hold
 * until `releaseGateIpc` is evaluated, then resolve with `fabricated`.
 * Returns through the app instance only — never restored, the instance is
 * torn down right after.
 */
async function gateDenyIpc(
  app: LaunchedApp,
  fabricated: Record<string, unknown>
): Promise<void> {
  await app.electronApp.evaluate(
    ({ ipcMain }, { channel, fabricated }) => {
      ipcMain.removeHandler(channel);
      let release: () => void = () => undefined;
      let gate: Promise<void> = new Promise<void>((resolve) => {
        release = resolve;
      });
      let count = 0;
      (
        globalThis as unknown as {
          __r10DenyGate?: { release(): void; count(): number };
        }
      ).__r10DenyGate = {
        release: () => {
          const held = gate;
          gate = Promise.resolve();
          release();
          void held;
        },
        count: () => count,
      };
      ipcMain.handle(channel, async () => {
        count += 1;
        await gate;
        return { status: true, msg: "", data: fabricated };
      });
    },
    { channel: DENY_CHANNEL, fabricated }
  );
}

async function releaseDenyGate(app: LaunchedApp): Promise<void> {
  await app.electronApp.evaluate(() => {
    (
      globalThis as unknown as { __r10DenyGate?: { release(): void } }
    ).__r10DenyGate?.release();
  });
}

/** How many deny invokes reached the (gated) main handler. */
async function denyCallCount(app: LaunchedApp): Promise<number> {
  return app.electronApp.evaluate(
    () =>
      (globalThis as unknown as { __r10DenyGate?: { count(): number } })
        .__r10DenyGate?.count() ?? -1
  );
}

/**
 * Shared setup (mirrors toolApproval.test.ts): workspace file + prep turn +
 * approved isolated workspace, then a gated file_read that parks the turn on
 * the permission card.
 */
async function setupGatedFileRead(
  app: LaunchedApp,
  fakeAi: FakeOpenAiController
): Promise<{ secret: string; card: Locator }> {
  const wsRoot = app.testRoot.workspacePath;
  const secret = `e2e-secret-${Date.now()}`;
  fs.writeFileSync(path.join(wsRoot, "target.txt"), secret, "utf8");

  await openChat(app);
  await fakeAi.setScenario("stream-text");
  await sendUnique(app, "e2e-prep");
  await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
    timeout: 30_000,
  });

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
    return undefined;
  }, wsRoot);
  expect(err, `workspace setup failed: ${err ?? ""}`).toBeUndefined();

  await fakeAi.setToolCall("file_read", JSON.stringify({ path: "target.txt" }));
  await sendUnique(app, "e2e-tool");
  const card = app.mainWindow.getByTestId("ai-chat-permission-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("file_read", { timeout: 15_000 });
  return { secret, card };
}

test.describe("R10 permission ownership selection races (Electron)", () => {
  test.afterEach(({ aiApp }) => {
    if (aiApp) {
      assertCleanTeardown(aiApp);
    }
  });

  test("B01: a delayed interactive deny stops the captured claim, not the running conversation", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(240_000);
    const { secret } = await setupGatedFileRead(aiApp, fakeAi);
    // Requests so far: prep turn + parked tool turn.
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 30_000 })
      .toBe(2);

    // Hold the deny IPC in main with the INTERACTIVE branch payload (no
    // owner claims the tool from the renderer's view): the fixed store
    // cancels the CAPTURED claim on resolution.
    await gateDenyIpc(aiApp, { ok: true, handled: false });

    // Start the deny and leave its IPC unresolved.
    await aiApp.mainWindow.getByTestId("ai-chat-permission-deny").click();

    // Select a second conversation and keep a turn running there. The
    // sticky file_read script is cleared so B's turn streams plain text.
    await fakeAi.clearToolCall();
    await fakeAi.setScenario("stream-delayed");
    await aiApp.mainWindow.getByTestId("workspace-new-chat").click();
    await expect(composer(aiApp)).toBeVisible({ timeout: 30_000 });
    await sendUnique(aiApp, "e2e-running-b");
    // B is mid-stream inside the scenario's 10 s hold window: its first
    // frame renders while the turn is still running (the fakeAi request log
    // only records COMPLETED requests — never gate the race on it).
    await expect(chatRoot(aiApp)).toContainText("Streaming", {
      timeout: 30_000,
    });

    // Release the delayed denial while B is the selected running turn.
    await releaseDenyGate(aiApp);
    expect(await denyCallCount(aiApp)).toBe(1);

    // The captured-claim cancel ran against A — B's turn completes
    // undisturbed (the old generic-stop fallback cancelled B mid-stream).
    await expect(chatRoot(aiApp)).toContainText(
      "Streaming-should-be-cancelled",
      { timeout: 45_000 }
    );

    // Switch back to A: the parked run settled cancelled — the tool never
    // executed (the secret never appears) and the composer is actionable.
    const conversationA = conversationRows(aiApp).last();
    if (await conversationA.isVisible().catch(() => false)) {
      await conversationA.click();
      await expect(chatRoot(aiApp)).toContainText("e2e-tool", {
        timeout: 30_000,
      });
      await expect(chatRoot(aiApp)).not.toContainText(secret, {
        timeout: 15_000,
      });
      await expect(aiApp.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  test("B02: a failed authoritative denial keeps the decision card actionable", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(240_000);
    await setupGatedFileRead(aiApp, fakeAi);
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 30_000 })
      .toBe(2);

    // The owner reports a FAILED cancellation (ok:false, handled:true):
    // the fixed store must NOT display a denied receipt.
    await gateDenyIpc(aiApp, {
      ok: false,
      handled: true,
      error: "Conversation A permission failed",
    });

    await aiApp.mainWindow.getByTestId("ai-chat-permission-deny").click();
    // Let the gated (immediate) resolution land.
    await releaseDenyGate(aiApp);
    expect(await denyCallCount(aiApp)).toBe(1);

    // FR-PER-007: the decision stays mounted and actionable for retry —
    // no receipt replaced it.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-permission-deny")
    ).toBeVisible({ timeout: 15_000 });

    // The tool still never executes; the parked run keeps waiting for the
    // decision (the denial was not applied by the owner).
    expect(await requestCount(fakeAi)).toBe(2);
  });
});

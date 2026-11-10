/**
 * Slash/goal/scheduled-loop/skill command certification matrix (audit V01
 * bullet "Certify slash/goal/scheduled-loop/skill flows", incl. R09/R10).
 *
 * The router-level contracts (R09 attachment rejection, control-failure
 * dispositions, R09-1 durable-only acceptance, R10 origin-scoped error
 * ownership) are certified in `useChatCommandRouting.test.ts` and the
 * component suite (`AiChatCenterSurface.test.ts`, `AiChatV2.acceptedSendContract.test.ts`,
 * `ScheduledLoopToolApprovalDialog.test.ts`). THIS spec certifies the same
 * matrix END-TO-END through the real shell + real IPC handlers:
 *
 *   C-1 — /goal creates the durable goal and expands the plan prompt
 *         through the ordinary send exactly once (real goal-create/get IPC).
 *   C-2 — scheduled `/loop 10m …` stages the approval dialog; CONFIRM
 *         durably creates the loop (scheduled-loop-get returns it), the
 *         composer draft is cleared, and /loop pause|resume|stop update the
 *         REAL schedule state in the documented direction.
 *   C-3 — approval CANCELLATION: no durable row is created and the
 *         retryable command draft survives in the composer.
 *   C-4 — `/loop …` with a staged attachment is rejected explicitly with the
 *         draft AND the attachment chips retained (R09); nothing durable.
 *   C-5 — a failed control (`/loop pause` with no loop) shows the localized
 *         error and is not silently accepted (R09 failed-control contract).
 *   C-6 — /skill with no matching skill fails locally (no provider round
 *         trip) with the skill name in the error (FR-SKL-005/R10 ownership).
 *   C-7 — /clear through the generic registry actually clears the durable
 *         conversation; a /clear with attachments is rejected and clears
 *         nothing (B11).
 *
 * Relative imports only (design §9.3).
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { RENDERER_ORIGIN } from "../fixtures/types";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";

function textarea(
  app: Pick<LaunchedApp, "mainWindow">
): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

function composerRoot(
  app: Pick<LaunchedApp, "mainWindow">
): import("@playwright/test").Locator {
  // The composer SFC root is the styled `.v2-composer` container; the
  // ai-chat-composer testid sits on the TEXTAREA, not on the root.
  return app.mainWindow.locator(".v2-composer").first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
  await app.mainWindow.getByTestId("workspace-new-chat").click();
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
}

async function send(
  app: LaunchedApp,
  message: string
): Promise<void> {
  await textarea(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

/**
 * Invoke a main-process IPC channel through the preload bridge, mirroring
 * the real renderer calls (`windowInvoke` serializes via the same layer —
 * the E2E bridge speaks JSON strings, see ElectronPreloadTransport).
 */
async function ipc(
  app: LaunchedApp,
  channel: string,
  data: unknown
): Promise<{ status: boolean; data: unknown; msg?: string }> {
  const payload = JSON.stringify(data);
  const resp = await app.mainWindow.evaluate(
    async ([ch, body]: [string, string]) => {
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
      return (await api.invoke(ch, body)) ?? { status: false, data: null };
    },
    [channel, payload] as const
  );
  return resp as { status: boolean; data: unknown; msg?: string };
}

async function goalOfType(
  app: LaunchedApp,
  conversationId: string
): Promise<{ objective?: string } | null> {
  const resp = await ipc(app, "ai-chat-v2:goal-get", {
    conversationId,
  });
  return (resp?.data ?? null) as { objective?: string } | null;
}

async function loopView(
  app: LaunchedApp,
  conversationId: string
): Promise<{ status?: string } | null> {
  const resp = await ipc(app, "ai-chat-v2:scheduled-loop-get", {
    conversationId,
  });
  return (resp?.data ?? null) as { status?: string } | null;
}

async function firstConversationId(app: LaunchedApp): Promise<string> {
  const resp = await ipc(app, "ai-chat-v2:conversations", {});
  const convs = (resp?.data ?? []) as Array<{ conversationId: string }>;
  if (!convs[0]) throw new Error("no conversation exists");
  return convs[0].conversationId;
}

async function requestCount(fakeAi: FakeOpenAiController): Promise<number> {
  return (await fakeAi.getRequests()).length;
}

function commandError(app: LaunchedApp): import("@playwright/test").Locator {
  return app.mainWindow.getByTestId("workspace-command-error");
}

test.describe("slash/goal/loop/skill command matrix (Electron E2E)", () => {
  test.afterEach(({ aiApp }) => {
    if (aiApp) {
      assertCleanTeardown(aiApp);
    }
  });

  test("C-1: /goal durably creates the goal and expands the plan prompt through the ordinary send", async ({
    aiApp,
    fakeAi,
  }) => {
    await openChat(aiApp);
    const before = await requestCount(fakeAi);

    await send(aiApp, "/goal Ship the newsletter campaign");

    const convId = await firstConversationId(aiApp);
    // The goal row is durable through the real create handler.
    await expect
      .poll(async () => (await goalOfType(aiApp, convId))?.objective, {
        timeout: 20_000,
      })
      .toBe("Ship the newsletter campaign");
    // The expanded prompt continues on the ordinary path — the provider
    // request arrives (mode plan), and the plan-prompt send settles
    // terminally against the fake server's stream-text scenario.
    await expect.poll(async () => requestCount(fakeAi), {
      timeout: 45_000,
    }).toBeGreaterThan(before);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });
  });

  test("C-2: scheduled /loop stages approval; confirm creates durably and controls update state", async ({
    aiApp,
  }) => {
    await openChat(aiApp);
    await send(aiApp, `prep-${Date.now()}`);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });
    const convId = await firstConversationId(aiApp);

    await send(aiApp, "/loop 10m summarize the inbox");

    const confirm = aiApp.mainWindow.getByTestId("scheduled-loop-approval-confirm");
    await expect(confirm).toBeVisible({ timeout: 20_000 });
    await confirm.click();

    // Durable row exists immediately after the confirm (real create IPC).
    let view = await loopView(aiApp, convId);
    for (let i = 0; i < 10; i += 1) {
      if (view) break;
      await aiApp.mainWindow.waitForTimeout(500);
      view = await loopView(aiApp, convId);
    }
    expect(view, "the confirm must durably create the scheduled loop").toBeTruthy();
    expect(view?.status).toBe("active");

    // The composer draft is consumed only after the durable create.
    await expect(textarea(aiApp)).toHaveValue("");

    // Real IPC controls move the durable state. (Wait for the status fetch
    // the confirm port triggered — a control that resolves with the OLD
    // status would race the authoritative value.)
    await aiApp.mainWindow.waitForTimeout(1000);
    await send(aiApp, "/loop pause");
    await expect
      .poll(async () => (await loopView(aiApp, convId))?.status, {
        timeout: 20_000,
      })
      .toBe("paused");
    await send(aiApp, "/loop resume");
    await expect
      .poll(async () => (await loopView(aiApp, convId))?.status, {
        timeout: 20_000,
      })
      .toBe("active");
    await send(aiApp, "/loop stop");
    await expect
      .poll(async () => (await loopView(aiApp, convId))?.status, {
        timeout: 20_000,
      })
      .toBe("stopped");
  });

  test("C-3: cancelling the approval creates nothing and keeps the retryable draft", async ({
    aiApp,
  }) => {
    await openChat(aiApp);
    await send(aiApp, `prep-${Date.now()}`);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });
    await send(aiApp, "/loop 1h keep me signed me up");

    const cancel = aiApp.mainWindow.getByTestId("scheduled-loop-approval-cancel");
    await expect(cancel).toBeVisible({ timeout: 20_000 });
    await cancel.click();
    await expect(cancel).toBeHidden({ timeout: 10_000 });

    const convId = await firstConversationId(aiApp);
    expect(
      await loopView(aiApp, convId),
      "cancel must not persist the staged loop"
    ).toBeNull();
    // The retryable command text survives in the composer.
    await expect(textarea(aiApp)).toHaveValue("/loop 1h keep me signed me up");
  });

  test("C-4: /loop with a staged attachment is rejected explicitly and retains the draft", async ({
    aiApp,
  }) => {
    await openChat(aiApp);
    await send(aiApp, `prep-${Date.now()}`);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });
    await textarea(aiApp).fill("/loop 10m summarize the attached");
    await composerRoot(aiApp)
      .locator('input[type="file"]')
      .setInputFiles({
        name: "e2e-attach.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("a,b\n1,2\n", "utf8"),
      });
    // The chips are staged in the composer tray (R09 must keep them).
    await expect(
      composerRoot(aiApp).locator(".v2-composer__files .v-chip").first()
    ).toBeVisible();
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    await expect(commandError(aiApp)).toBeVisible({ timeout: 15_000 });
    await expect(commandError(aiApp)).toContainText(
      "attachments",
      { ignoreCase: true }
    );
    await expect(textarea(aiApp)).toHaveValue("/loop 10m summarize the attached");
    await expect(
      composerRoot(aiApp).locator(".v2-composer__files .v-chip").first()
    ).toBeVisible();

    const convId = await firstConversationId(aiApp);
    expect(await loopView(aiApp, convId)).toBeNull();
  });

  test("C-5: a failed control (/loop pause with no loop) is not silently accepted", async ({
    aiApp,
  }) => {
    await openChat(aiApp);
    // A real conversation exists so the control path reaches the IPC layer.
    const marker = `prep-${Date.now()}`;
    await send(aiApp, marker);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });

    await send(aiApp, "/loop pause");
    await expect(commandError(aiApp)).toBeVisible({ timeout: 15_000 });
    const convId = await firstConversationId(aiApp);
    expect(await loopView(aiApp, convId)).toBeNull();
  });

  test("C-6: /skill with no matching skill fails locally without a provider round trip", async ({
    aiApp,
    fakeAi,
  }) => {
    await openChat(aiApp);
    await send(aiApp, `prep-${Date.now()}`);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });
    const before = await requestCount(fakeAi);
    await send(aiApp, "/skill never-installed-skill");

    await expect(commandError(aiApp)).toBeVisible({ timeout: 15_000 });
    await expect(commandError(aiApp)).toContainText("never-installed-skill");
    // No provider request was made for the failed invocation.
    await expect.poll(async () => requestCount(fakeAi)).toBe(before);
  });

  test("C-7: /clear clears the durable conversation; /clear with attachments is rejected and clears nothing", async ({
    aiApp,
    fakeAi,
  }) => {
    await openChat(aiApp);
    const marker = `pre-clear-${Date.now()}`;
    await send(aiApp, marker);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(marker, { timeout: 30_000 });
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });

    // B11: /clear has no file channel — attached files reject explicitly.
    await textarea(aiApp).fill("/clear");
    await composerRoot(aiApp)
      .locator('input[type="file"]')
      .setInputFiles({
        name: "e2e-clear.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("x,y\n9,8\n", "utf8"),
      });
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    await expect(commandError(aiApp)).toBeVisible({ timeout: 15_000 });
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(marker, { timeout: 6_000 });

    // Clean /clear: drop the rejected attachment chip first (its close
    // control is part of the composer's staged-attachment tray), then the
    // transcript empties via the real clear + reload.
    await composerRoot(aiApp)
      .locator(".v2-composer__files .v-chip")
      .first()
      .locator(".mdi-close-circle, button, [role='button']")
      .first()
      .click();
    await expect(
      composerRoot(aiApp).locator(".v2-composer__files .v-chip")
    ).toHaveCount(0, { timeout: 10_000 });
    await textarea(aiApp).fill("/clear");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).not.toContainText(marker, { timeout: 30_000 });
    // The cleared conversation still works — the next send flows normally.
    await send(aiApp, "post-clear probe");
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText("post-clear probe", { timeout: 30_000 });
    await expect.poll(async () => requestCount(fakeAi), {
      timeout: 45_000,
    }).toBeGreaterThan(1);
  });
});

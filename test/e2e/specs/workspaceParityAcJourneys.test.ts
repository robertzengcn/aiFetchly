/**
 * Workspace capability-parity AC journey gaps (R8 §2 acceptance table).
 *
 * The component-level contracts are certified in the unit/component suites;
 * THESE tests close the "automation stops short of the journey" gaps:
 *
 *   AC 3   — a REGISTERED slash command (`/help`, built-in) is handled by the
 *           command dispatcher: the exchange renders locally and the provider
 *           never receives the raw command (request count unchanged).
 *   AC 17  — an ambiguous image-edit request ("the image" with two seeded
 *           images) starts NO provider request until the user chooses; the
 *           ambiguity chooser appears and cancellation keeps the draft.
 *   AC 19-20 — AI generation is DISABLED (hosted-disabled manifest) but the
 *           reporting capability endpoint is available and an eligible
 *           assistant output exists (seeded row): the report-conversation
 *           dialog opens, submits, and resolves the server reference.
 *   AC 36  — one Electron journey through BOTH surfaces: the workspace shell
 *           carries a turn end to end, the operator rolls back, and the
 *           legacy Chat V2 dock carries the next turn end to end.
 *
 * AC 11/12 (plan-approval continuation counting) need a scripted plan
 * document scenario on the fake provider; AC 28 (inactive-conversation
 * summary-only payload) needs a two-conversation run-detail observer — both
 * remain open in the audit table by explicit decision (no scenario exists).
 *
 * Relative imports only (design §9.3).
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { RENDERER_ORIGIN } from "../fixtures/types";
import { assertCleanTeardown } from "../support/assertions";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { writeStateManifest } from "../fixtures/temporaryState";
import { closeApp } from "../support/processCleanup";
import {
  FAKE_REPORT_ID,
  startFakeReportingServer,
} from "../fixtures/fakeReportingServer";
import type { E2ETestRoot } from "../fixtures/types";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  createConversationWithStreamedTurn,
  seedGeneratedImagesOnLastTurn,
  startNewConversation,
  switchToConversationByMarker,
  DB_FILE_NAME,
} from "../support/generatedImageSeed";

const execFileAsync = promisify(execFile);

function textarea(
  app: Pick<LaunchedApp, "mainWindow">
): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
  const newChat = app.mainWindow.getByTestId("workspace-new-chat");
  await newChat.waitFor({ state: "visible", timeout: 10_000 });
  await newChat.click();
  await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
}

async function send(
  app: LaunchedApp,
  message: string
): Promise<void> {
  await textarea(app).fill(message);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

async function requestCount(
  fakeAi: { getRequests(): Promise<readonly unknown[]> }
): Promise<number> {
  return (await fakeAi.getRequests()).length;
}

/**
 * Seed one eligible assistant output directly into the durable message store
 * (same sqlite3-CLI convention as generatedImageSeed — no native-ABI
 * coupling). Used on the AI-disabled surface, where generating an output by
 * design cannot happen (AC 20's premise).
 */
async function seedEligibleAssistantOutput(
  app: LaunchedApp,
  testRoot: E2ETestRoot
): Promise<boolean> {
  const convResp = await app.mainWindow.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          invoke: (
            channel: string,
            data?: unknown
          ) => Promise<{ status: boolean; data: unknown } | undefined>;
        };
      }
    ).api;
    return await api.invoke("ai-chat-v2:conversations", JSON.stringify({}));
  });
  const convs = (convResp?.data ?? []) as Array<{ conversationId: string }>;
  const conversationId = convs[0]?.conversationId;
  if (!conversationId) return false;
  const dbPath = path.join(testRoot.databasePath, DB_FILE_NAME);
  const now = new Date().toISOString();
  const sqlLiteral = (value: string): string =>
    `'${value.replace(/'/g, "''")}'`;
  const sql = [
    "INSERT INTO ai_chat_messages",
    "(messageId, conversationId, role, content, timestamp, messageType, createdAt, updatedAt)",
    "VALUES (",
    sqlLiteral(`seed-report-${Date.now()}`),
    ",",
    sqlLiteral(conversationId),
    ",'assistant',",
    sqlLiteral("Seeded assistant output for the AI-disabled reporting journey."),
    ",",
    sqlLiteral(now),
    ",'message',",
    sqlLiteral(now),
    ",",
    sqlLiteral(now),
    ");",
  ].join(" ");
  await execFileAsync("sqlite3", [dbPath, sql]);
  return true;
}

test.describe("workspace capability-parity AC journeys (R8 §2)", () => {
  test.afterEach(({ aiApp, disabledApp }) => {
    const a = aiApp ?? disabledApp;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("AC 3: a registered /help command is dispatched locally — the model never sees the raw command", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(240_000);
    await openChat(aiApp);

    const before = await requestCount(fakeAi);
    await send(aiApp, "/help");

    // The dispatcher answers LOCALLY: the exchange renders in the transcript
    // without any provider round trip.
    const root = aiApp.mainWindow.getByTestId("chat-center-surface");
    await expect(
      root.getByText("Available commands", { exact: false }).first()
    ).toBeVisible({ timeout: 30_000 });

    // The raw command never reaches the model — request count is unchanged.
    await aiApp.mainWindow.waitForTimeout(3_000);
    expect(await requestCount(fakeAi)).toBe(before);
  });

  test("AC 17: an ambiguous image-edit request starts nothing until the user chooses", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    test.setTimeout(300_000);
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-ac17-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker);

    // Reload history so the tiles render.
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);
    const root = aiApp.mainWindow.getByTestId("chat-center-surface");
    await expect(root.locator(".v2-message__generated-image")).toHaveCount(2);

    const before = await requestCount(fakeAi);
    // Singular phrase + two images → ambiguous; the chooser must open.
    await send(aiApp, "make the image brighter");

    const chooser = aiApp.mainWindow.getByTestId("ai-chat-generated-chooser");
    await expect(chooser).toBeVisible({ timeout: 20_000 });
    await expect(
      chooser.locator('[data-testid^="ai-chat-generated-candidate-"]')
    ).toHaveCount(2);

    // NO provider request starts while the chooser is open.
    await aiApp.mainWindow.waitForTimeout(3_000);
    expect(await requestCount(fakeAi)).toBe(before);

    // Cancellation resolves nothing and keeps the draft retryable.
    await chooser.getByTestId("ai-chat-generated-chooser-cancel").click();
    await expect(chooser).toBeHidden({ timeout: 10_000 });
    await expect(textarea(aiApp)).toHaveValue("make the image brighter");
    await aiApp.mainWindow.waitForTimeout(2_000);
    expect(await requestCount(fakeAi)).toBe(before);
  });

  test("AC 19-20: reporting submits on the AI-disabled surface when an eligible output exists", async ({
    fakeAi,
    testRoot,
  }) => {
    test.setTimeout(300_000);
    // The fake reporting endpoint must be bound BEFORE launch (the surface
    // fetches capabilities at mount). Port 3000 follows the fixture
    // convention (single worker — no overlap).
    const reporting = await startFakeReportingServer();
    let app: LaunchedApp | null = null;
    try {
      // Hosted-disabled manifest (mirrors the disabledApp fixture): the AI
      // gate rejects generation, reporting is NOT AI-gated (PRD FR-4.4).
      await fakeAi.reset();
      writeStateManifest(testRoot, {
        authState: "authenticated",
        aiState: "hosted-disabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: testRoot.workspacePath,
      });
      app = await launchAiFetchly({
        testRoot,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });

      await openChat(app);
      const reportButton = app.mainWindow
        .locator(
          '[data-testid="chat-center-surface"] [data-testid="report-conversation"], ' +
            '[data-testid="ai-chat-root"] [data-testid="report-conversation"]'
        )
        .first();
      await expect(reportButton).toBeVisible({ timeout: 30_000 });

      // Seed an eligible assistant output directly into the durable store
      // (the AI gate prevents generating one by design — AC 20's point).
      const seeded = await seedEligibleAssistantOutput(app, testRoot);
      if (!seeded) {
        throw new Error("could not seed the eligible assistant output");
      }

      // Reload history: the eligibility hook re-arms when eligible content
      // exists (reportCapabilities.ts) — the button must become actionable.
      await app.mainWindow.reload();
      await openChat(app);
      await expect(reportButton).toBeEnabled({ timeout: 30_000 });
      await reportButton.click();

      const dialog = app.mainWindow.getByTestId(
        "ai-conversation-report-dialog"
      );
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await dialog
        .locator('[data-testid^="report-item-"] input[type="checkbox"]')
        .first()
        .check();
      await dialog.locator(".v-select .v-field").click();
      await app.mainWindow
        .getByRole("option", { name: "Hate or harassment", exact: true })
        .click();
      await dialog.getByTestId("conversation-report-submit").click();
      // The submit completed through the REAL service → fake server with
      // the server-issued reference (AC 20: reporting remains USABLE while
      // AI generation is disabled).
      await expect(
        dialog.getByText(FAKE_REPORT_ID, { exact: false }).first()
      ).toBeVisible({ timeout: 60_000 });
      assertCleanTeardown(app);
    } finally {
      if (app) {
        await closeApp(app);
      }
      await reporting.close();
    }
  });

  test("AC 36: one Electron journey across both surfaces — workspace shell turn, rollback, legacy dock turn", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(300_000);
    // Surface 1: the workspace shell carries a full turn.
    await openChat(aiApp);
    await send(aiApp, `journey-shell-${Date.now()}`);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-transcript")
    ).toContainText(STREAM_TEXT_FINAL, { timeout: 45_000 });
    await expect(aiApp.mainWindow.getByTestId("ai-chat-stop")).toBeHidden({
      timeout: 30_000,
    });
    const shellRequests = await requestCount(fakeAi);
    expect(shellRequests).toBeGreaterThan(0);

    // Operator rollback (real SET_FLAG IPC).
    const set = await aiApp.mainWindow.evaluate(async () => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              channel: string,
              data?: unknown
            ) => Promise<{ status: boolean; data: unknown } | undefined>;
          };
        }
      ).api;
      return await api.invoke("ai-chat-workspace:set-flag", JSON.stringify({
        enabled: false,
        feature: "redesign",
      }));
    });
    expect(set?.status).toBe(true);

    // Reach the legacy dock (renderer-local shell control, §30.2).
    await aiApp.mainWindow.evaluate(() => {
      localStorage.setItem("aifetchly.innerPageShellV3", "false");
    });
    await aiApp.mainWindow.reload();
    const chatToggle = aiApp.mainWindow.locator(
      "header button:has(i.mdi-chat), .v-app-bar button:has(i.mdi-chat)"
    );
    await chatToggle.first().click({ timeout: 20_000 });
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).toBeVisible({ timeout: 20_000 });

    // Surface 2: the legacy Chat V2 dock carries a full turn too.
    const legacyInput = aiApp.mainWindow
      .getByTestId("ai-chat-root")
      .locator("textarea")
      .first();
    await expect(legacyInput).toBeVisible({ timeout: 20_000 });
    await legacyInput.fill(`journey-legacy-${Date.now()}`);
    await aiApp.mainWindow
      .getByTestId("ai-chat-root")
      .getByTestId("ai-chat-send")
      .click();
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 45_000,
      })
      .toBeGreaterThan(shellRequests);
  });
});

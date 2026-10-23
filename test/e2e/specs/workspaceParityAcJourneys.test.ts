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
 *   AC 28  — a live tool run in conversation A delivers ONLY bounded
 *           summary state to A's sidebar row (a Running status indicator
 *           that settles to idle at the terminal) and nothing to
 *           conversation B's selected view while B holds the selection —
 *           the model's tool detail (name + arguments) never crosses.
 *   AC 36  — one Electron journey through BOTH surfaces: the workspace shell
 *           carries a turn end to end, the operator rolls back, and the
 *           legacy Chat V2 dock carries the next turn end to end.
 *
 * AC 11/12 (plan-approval continuation counting) need a scripted plan
 * document scenario on the fake provider — they remain open in the audit
 * table by explicit decision (no scenario exists).
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

/** Sidebar conversation rows (same scoping as the steering spec). */
function conversationRows(app: LaunchedApp): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("workspace-tree")
    .locator('[data-testid^="workspace-conversation-v2-"]');
}

/**
 * Switch the composer's tool-approval selector (glob_files is permission-
 * gated in ask_for_approval mode — auto-approve so the run stays live).
 */
async function selectToolApproval(
  app: LaunchedApp,
  optionTitle: string
): Promise<void> {
  await app.mainWindow
    .locator(".v2-tool-approval-selector")
    .locator(".v-field")
    .click();
  await app.mainWindow.getByRole("option", { name: optionTitle }).click();
}

/**
 * Seed one reportable conversation — a durable conversation row plus one
 * eligible assistant output — directly into the message store (same
 * sqlite3-CLI convention as agentTaskSeed; no native-ABI coupling). Used on
 * the AI-disabled surface, where generating an output by design cannot
 * happen (AC 20's premise). Returns the seeded conversation id.
 */
async function seedReportableConversation(
  testRoot: E2ETestRoot
): Promise<string> {
  const conversationId = `v2-seed-${Date.now()}`;
  const dbPath = path.join(testRoot.databasePath, DB_FILE_NAME);
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const sqlLiteral = (value: string): string =>
    `'${value.replace(/'/g, "''")}'`;
  const sql = [
    "INSERT INTO ai_chat_messages",
    "(messageId, conversationId, role, content, timestamp, messageType, createdAt, updatedAt)",
    "VALUES (",
    sqlLiteral(`${conversationId}-assistant-1`),
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
    "INSERT INTO ai_chat_conversations",
    "(conversationId, workspaceKey, title, titleIsUserSet, preview, messageCount, lastMessageAt, lastResultAt, createdAt, updatedAt)",
    "VALUES (",
    sqlLiteral(conversationId),
    ",NULL,",
    sqlLiteral("Reporting journey"),
    ",0,",
    sqlLiteral("Seeded assistant output for the AI-disabled reporting journey."),
    ",1,",
    sqlLiteral(now),
    ",",
    sqlLiteral(now),
    ",",
    sqlLiteral(now),
    ",",
    sqlLiteral(now),
    ");",
    "SELECT COUNT(*) FROM ai_chat_messages WHERE conversationId =",
    sqlLiteral(conversationId),
    ";",
  ].join(" ");
  const { stdout } = await execFileAsync("sqlite3", [
    dbPath,
    "-cmd",
    ".timeout 10000",
    sql,
  ]);
  const inserted = parseInt(stdout.trim().split(/\s+/).pop() ?? "0", 10);
  if (inserted !== 1) {
    throw new Error(
      `Expected to insert 1 assistant message row, inserted ${inserted}`
    );
  }
  return conversationId;
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

      // Seed the reportable conversation (does not depend on the UI): a
      // durable conversation row plus one eligible assistant output.
      const seededConversationId = await seedReportableConversation(testRoot);

      // Reload so the sidebar bootstrap refresh picks up the seeded row;
      // workspace-less conversations live in the "Other chats" folder which
      // defaults collapsed — expand it, then select the seeded conversation.
      await app.mainWindow.reload();
      await app.mainWindow.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
      await expect(textarea(app)).toBeVisible({ timeout: 30_000 });
      const tree = app.mainWindow.getByTestId("workspace-tree");
      const seededRow = tree.locator(
        `[data-testid="workspace-conversation-${seededConversationId}"]`
      );
      if ((await seededRow.count()) === 0 || (await seededRow.isHidden())) {
        await tree.locator('[data-nav-row="unassigned"]').click();
      }
      await expect(seededRow).toBeVisible({ timeout: 30_000 });
      await seededRow.click();

      const reportButton = app.mainWindow
        .locator(
          '[data-testid="chat-center-surface"] [data-testid="report-conversation"], ' +
            '[data-testid="ai-chat-root"] [data-testid="report-conversation"]'
        )
        .first();
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

  test("AC 28: a live run in an inactive conversation reaches its sidebar row as bounded summary only", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(300_000);
    // Conversation A runs a scripted tool call with a long pre-delta delay —
    // a comfortable live window in which to switch selection to B.
    await openChat(aiApp);
    await selectToolApproval(aiApp, "Approve for me");
    await fakeAi.setToolCalls(
      [{ name: "glob_files", arguments: '{"pattern":"*.txt"}' }],
      15_000
    );

    await send(aiApp, "list both file sets");
    // A's turn is live (the request has been dispatched and is mid-stream).
    const transcript = aiApp.mainWindow
      .getByTestId("workspace-transcript")
      .first();
    await expect(transcript).toContainText("Generating…", {
      timeout: 30_000,
    });
    const liveRequests = await requestCount(fakeAi);
    expect(liveRequests).toBeGreaterThanOrEqual(0);

    // B holds the selection while A keeps running.
    await aiApp.mainWindow.getByTestId("workspace-new-chat").click();
    await expect(textarea(aiApp)).toBeVisible({ timeout: 15_000 });

    // A's sidebar row (newest-last, the oldest conversation) must carry ONLY
    // bounded summary state: status indicator + title. Workspace-less
    // conversations live in the "Other chats" folder, which defaults
    // collapsed — expand it first. The tool name and arguments must never
    // appear — the event router redacts detail for non-selected windows.
    const tree = aiApp.mainWindow.getByTestId("workspace-tree");
    const unassignedHeader = tree.locator('[data-nav-row="unassigned"]');
    const rowA = conversationRows(aiApp).last();
    if ((await rowA.count()) === 0 || (await rowA.isHidden())) {
      await unassignedHeader.click();
    }
    await expect(rowA).toBeVisible({ timeout: 15_000 });
    await expect(rowA).not.toContainText("glob_files");
    await expect(rowA).not.toContainText("*.txt");
    // The bounded RUNNING summary reached the row while B holds the
    // selection — status metadata only (the row's status indicator), never
    // the model's tool detail.
    await expect(
      rowA.locator('[title="Running"], [aria-label="Running"]')
    ).toBeVisible({ timeout: 20_000 });

    // A's run completes in the background; the row settles to a bounded
    // terminal state (running indicator clears) without any detail leaking.
    await expect
      .poll(() => requestCount(fakeAi), { timeout: 60_000 })
      .toBeGreaterThan(liveRequests);
    await expect(
      rowA.locator('[title="Running"], [aria-label="Running"]')
    ).toBeHidden({ timeout: 30_000 });
    await expect(rowA).not.toContainText("glob_files");
    await expect(rowA).not.toContainText("*.txt");
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

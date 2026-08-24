/**
 * Workspace-less generated-image editing flow (E2E, task 14).
 *
 * Covers the UI-level contract of "Use as reference" on rendered generated
 * images without any workspace tools involved:
 *   - a seeded history assistant message carrying
 *     `metadata.generatedImages` renders numbered image tiles with
 *     Use-as-reference / Edit actions;
 *   - clicking the action populates the composer reference tray, with badge
 *     numbers following SELECTION order (not document order);
 *   - tray state is isolated per conversation (new conversation clears the
 *     visible tray; switching back restores it);
 *   - sending an edit request ("add a dog beside the lion") completes against
 *     the FakeOpenAI loopback server, persists
 *     `metadata.generatedImageReferences` on the user turn, never surfaces a
 *     workspace_required tool card, and clears the tray on success.
 *
 * Seeding strategy (deterministic, no live image backend): the harness's
 * FakeOpenAI scenarios stream text only — there is no `delta.images`
 * scenario. A real streamed turn creates the conversation + assistant row,
 * then the spec writes valid PNG files under the redirected userData root and
 * rewrites that row's `metadata.generatedImages` via better-sqlite3 in the
 * Electron MAIN process (correct ABI; test process never loads the native
 * module). Rendering, reference resolution (GeneratedImageReferenceService
 * reads those exact files from disk) and persistence all run through the real
 * production paths.
 *
 * The full generate→edit round-trip (live/stubbed IMAGE generation) is marked
 * `test.fixme` below — see the comment on that test for what is missing.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { E2ETestRoot } from "../fixtures/types";
import type { Locator } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/** Must match the seeded USEREMAIL in src/main-process/e2e/E2EStateSeeder.ts. */
const E2E_USER_EMAIL = "e2e@aifetchly.test";

/** URL-encoded form used inside protocol URLs (encodeURIComponent of the
 * normalized email), matching buildGeneratedImageProtocolUrl exactly. */
const E2E_USER_EMAIL_URL_PART = "e2e%40aifetchly.test";

const GENERATED_IMAGE_PROTOCOL_HOST =
  "aifetchly-generated-image://local/";

/** Directory name under userData — matches AI_CHAT_GENERATED_IMAGE_DIR. */
const GENERATED_IMAGE_DIR = "ai-chat-generated-images";

/** SQLite file created by SqliteDb under USERSDBPATH (the database dir). */
const DB_FILE_NAME = "scraper.db";

/** Minimal valid 1x1 transparent PNG (well-known constant bytes). */
const ONE_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

interface GeneratedImageMetadataEntry {
  readonly type: "image";
  readonly delivery: "local_file";
  readonly url: string;
  readonly local_path: string;
  readonly file_name: string;
  readonly mime_type: "image/png";
  readonly download_required: false;
  readonly width: number;
  readonly height: number;
}

interface SeedSqlPayload {
  readonly dbPath: string;
  readonly betterSqlite3EntryPath: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly metadataJson: string;
}

interface SeedSqlResult {
  readonly changes: number;
  readonly loadedFrom: string;
}

interface HistoryMessageView {
  readonly id: string;
  readonly role: string;
  readonly messageType?: string;
  readonly content?: string;
  readonly metadata?: {
    readonly source?: string;
    readonly generatedImageReferences?: readonly unknown[];
  } | null;
}

interface SeededGeneratedImageTurn {
  readonly conversationId: string;
  readonly assistantMessageId: string;
  readonly updatedRows: number;
}

/** The composer's real <textarea> (first one — Vuetify adds a hidden
 * measurement textarea). Mirrors aiChat.test.ts. */
function composerTextarea(app: LaunchedApp): Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

/** Open the AI chat dock and wait for the composer to be actionable. */
async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composerTextarea(app)).toBeVisible({ timeout: 30_000 });
}

/**
 * Read conversation id + last persisted chat-v2 assistant message id through
 * the REAL history IPC (same bridge usage as persistence.test.ts).
 */
async function readLatestAssistantTurn(
  app: LaunchedApp
): Promise<{ conversationId: string; assistantMessageId: string }> {
  const result = await app.mainWindow.evaluate(async () => {
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
    const convResp = await api.invoke(
      "ai-chat-v2:conversations",
      JSON.stringify({})
    );
    const convs = (convResp?.data ?? []) as Array<{
      conversationId: string;
    }>;
    if (convs.length === 0) {
      return null;
    }
    const histResp = await api.invoke(
      "ai-chat-v2:history",
      JSON.stringify({ conversationId: convs[0].conversationId })
    );
    const histData = (histResp?.data ?? {}) as {
      messages?: HistoryMessageView[];
    };
    const messages = histData.messages ?? [];
    const assistants = messages.filter(
      (m) =>
        m.role === "assistant" &&
        m.messageType === "message" &&
        m.metadata?.source === "chat-v2"
    );
    const last = assistants[assistants.length - 1];
    if (!last) {
      return null;
    }
    return {
      conversationId: convs[0].conversationId,
      assistantMessageId: last.id,
    };
  });
  if (!result) {
    throw new Error(
      "No persisted chat-v2 assistant message found after streamed turn"
    );
  }
  return result;
}

/**
 * Deterministically turn the latest streamed assistant message into a
 * generated-image message:
 *   1. write two real PNG files under the redirected userData root using the
 *      exact layout the production storage service produces;
 *   2. rewrite the row's metadata.generatedImages with protocol URLs pointing
 *      at those files (better-sqlite3 runs in the Electron main process so
 *      the native module matches Electron's ABI).
 * Returns the seeded turn identity + the number of updated rows.
 */
async function seedGeneratedImagesOnLastTurn(
  app: LaunchedApp,
  testRoot: E2ETestRoot
): Promise<SeededGeneratedImageTurn> {
  const { conversationId, assistantMessageId } = await readLatestAssistantTurn(
    app
  );

  const messageDir = path.join(
    testRoot.userDataPath,
    GENERATED_IMAGE_DIR,
    E2E_USER_EMAIL,
    conversationId,
    assistantMessageId
  );
  fs.mkdirSync(messageDir, { recursive: true });

  const pngBytes = Buffer.from(ONE_PX_PNG_BASE64, "base64");
  const entries: GeneratedImageMetadataEntry[] = [];
  for (let index = 1; index <= 2; index += 1) {
    const fileName = index === 1 ? "lion.png" : "savanna.png";
    const filePath = path.join(messageDir, `image-${index}.png`);
    fs.writeFileSync(filePath, pngBytes);
    const protocolUrl =
      `${GENERATED_IMAGE_PROTOCOL_HOST}${E2E_USER_EMAIL_URL_PART}/` +
      `${encodeURIComponent(conversationId)}/` +
      `${encodeURIComponent(assistantMessageId)}/` +
      `${encodeURIComponent(`image-${index}.png`)}`;
    entries.push({
      type: "image",
      delivery: "local_file",
      url: protocolUrl,
      local_path: filePath,
      file_name: fileName,
      mime_type: "image/png",
      download_required: false,
      width: 1,
      height: 1,
    });
  }

  const metadataJson = JSON.stringify({
    source: "chat-v2",
    finishReason: "stop",
    generatedImages: entries,
  });

  // Resolve WITHOUT loading the native binding in the test process (it is
  // rebuilt for Electron's ABI); the main process require() loads it fine.
  const betterSqlite3EntryPath = path.join(
    process.cwd(),
    "node_modules",
    "better-sqlite3",
    "lib",
    "index.js"
  );

  const payload: SeedSqlPayload = {
    dbPath: path.join(testRoot.databasePath, DB_FILE_NAME),
    betterSqlite3EntryPath,
    messageId: assistantMessageId,
    conversationId,
    metadataJson,
  };

  const result: SeedSqlResult = await app.electronApp.evaluate(
    ({ app: electronApp }, sqlPayload: SeedSqlPayload) => {
      void electronApp;
      let DatabaseModule: unknown;
      try {
        DatabaseModule = require(sqlPayload.betterSqlite3EntryPath);
      } catch {
        DatabaseModule = require("better-sqlite3");
      }
      const Database = DatabaseModule as {
        new (
          filePath: string,
          options?: { readonly timeout?: number }
        ): {
          prepare(sql: string): {
            run(...args: readonly string[]): { readonly changes: number };
          };
          close(): void;
        };
      };
      const db = new Database(sqlPayload.dbPath, { timeout: 10_000 });
      try {
        const runResult = db
          .prepare(
            "UPDATE ai_chat_messages SET metadata = ? WHERE message_id = ? AND conversation_id = ?"
          )
          .run(
            sqlPayload.metadataJson,
            sqlPayload.messageId,
            sqlPayload.conversationId
          );
        return { changes: runResult.changes, loadedFrom: "electron-main" };
      } finally {
        db.close();
      }
    },
    payload
  );

  if (result.changes !== 1) {
    throw new Error(
      `Expected to update exactly 1 message row, updated ${result.changes}`
    );
  }

  return {
    conversationId,
    assistantMessageId,
    updatedRows: result.changes,
  };
}

/** Open the conversation-history dialog and select the conversation whose
 * title contains `marker`, which reloads history through the real IPC. */
async function switchToConversationByMarker(
  app: LaunchedApp,
  marker: string
): Promise<void> {
  await app.mainWindow.getByTitle("Conversation history").click();
  const listItem = app.mainWindow
    .locator(".v-list-item")
    .filter({ hasText: marker })
    .first();
  await expect(listItem).toBeVisible({ timeout: 30_000 });
  await listItem.click();
  await expect(composerTextarea(app)).toBeVisible({ timeout: 30_000 });
}

/** Create a fresh (workspace-less) conversation view. */
async function startNewConversation(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("new-conversation").click();
  await expect(app.mainWindow.getByTestId("ai-chat-generated-ref-tray")).toHaveCount(
    0
  );
}

/** Run one deterministic text turn so a real conversation exists. */
async function createConversationWithStreamedTurn(
  app: LaunchedApp,
  marker: string
): Promise<void> {
  await openChat(app);
  await composerTextarea(app).fill(marker);
  await app.mainWindow.getByTestId("ai-chat-send").click();
  await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
    STREAM_TEXT_FINAL,
    { timeout: 30_000 }
  );
  await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeEnabled({
    timeout: 30_000,
  });
}

test.describe("Workspace-less generated-image editing (Electron integration)", () => {
  test.afterEach(({ app, aiApp }) => {
    const a = aiApp ?? app;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("seeded generated images render actions; tray numbering follows selection order; tray is per-conversation", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-genimg-order-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);

    await seedGeneratedImagesOnLastTurn(aiApp, testRoot);

    // Leave and re-enter the conversation so history reloads through the real
    // history IPC and the renderer maps metadata.generatedImages to tiles.
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
    const imageBlocks = root.locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(2);

    // Numbered badges reflect the document position of each generated image.
    const tileBadges = root.locator(".v2-message__generated-image-index");
    await expect(tileBadges.nth(0)).toHaveText("1");
    await expect(tileBadges.nth(1)).toHaveText("2");

    // Message-level actions are present on every generated image.
    for (let index = 0; index < 2; index += 1) {
      await expect(
        imageBlocks
          .nth(index)
          .getByRole("button", { name: "Use as reference" })
      ).toBeVisible();
      await expect(
        imageBlocks.nth(index).getByRole("button", { name: "Edit" })
      ).toBeVisible();
    }

    // Select in REVERSE document order: the tray must number chips by
    // selection order (badge 1 = savanna.png selected first), not by the
    // order images appear in the message.
    await imageBlocks
      .nth(1)
      .getByRole("button", { name: "Use as reference" })
      .click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-tray")
    ).toBeVisible();

    await imageBlocks
      .nth(0)
      .getByRole("button", { name: "Use as reference" })
      .click();

    const chips = aiApp.mainWindow.getByTestId("ai-chat-generated-ref-chip");
    await expect(chips).toHaveCount(2);
    const chipBadges = chips.locator(".v2-composer__generated-ref-badge");
    await expect(chipBadges.nth(0)).toHaveText("1");
    await expect(chipBadges.nth(1)).toHaveText("2");
    const chipNames = chips.locator(".v2-composer__generated-ref-name");
    await expect(chipNames.nth(0)).toHaveText("savanna.png");
    await expect(chipNames.nth(1)).toHaveText("lion.png");

    // Conversation-switch isolation: a new conversation starts with an empty
    // tray; switching back restores THIS conversation's selection untouched.
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-chip")
    ).toHaveCount(2);
    await expect(chipNames.nth(0)).toHaveText("savanna.png");
    await expect(chipNames.nth(1)).toHaveText("lion.png");

    // The clear-all control empties the tray and removes it from the DOM.
    await aiApp.mainWindow.getByTestId("ai-chat-generated-ref-clear").click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-tray")
    ).toHaveCount(0);
  });

  test("sending an edit request with a referenced image completes without workspace_required and persists references", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-genimg-edit-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot);

    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const imageBlocks = aiApp.mainWindow
      .getByTestId("ai-chat-root")
      .locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(2);

    await imageBlocks
      .nth(0)
      .getByRole("button", { name: "Use as reference" })
      .click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-chip")
    ).toHaveCount(1);

    const requestsBefore = (await fakeAi.getRequests()).length;

    await composerTextarea(aiApp).fill("add a dog beside the lion");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    // The edit turn reached the fake provider through the real
    // renderer -> preload -> IPC -> engine -> provider path.
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(requestsBefore);

    // The turn completes (composer actionable again)…
    await expect(composerTextarea(aiApp)).toBeEnabled({ timeout: 30_000 });

    // …no workspace_required card/text ever appears — this flow must stay
    // workspace-less end to end.
    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
    await expect(root.locator(".workspace-required-card")).toHaveCount(0);
    await expect(root).not.toContainText(
      "An approved workspace is required first."
    );

    // Success clears the conversation's reference selection.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-tray")
    ).toHaveCount(0);

    // The user turn persisted generatedImageReferences through the engine —
    // proof the tray contents were attached to the outgoing request.
    const persistedRefs = await aiApp.mainWindow.evaluate(async () => {
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
      const convResp = await api.invoke(
        "ai-chat-v2:conversations",
        JSON.stringify({})
      );
      const convs = (convResp?.data ?? []) as Array<{
        conversationId: string;
      }>;
      if (convs.length === 0) return [];
      const histResp = await api.invoke(
        "ai-chat-v2:history",
        JSON.stringify({ conversationId: convs[0].conversationId })
      );
      const histData = (histResp?.data ?? {}) as {
        messages?: HistoryMessageView[];
      };
      const messages = histData.messages ?? [];
      const usersWithRefs = messages.filter(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.metadata?.generatedImageReferences) &&
          (m.metadata?.generatedImageReferences?.length ?? 0) > 0
      );
      return usersWithRefs.map(
        (m) => m.metadata?.generatedImageReferences?.length ?? 0
      );
    });
    expect(persistedRefs.length).toBeGreaterThanOrEqual(1);
    expect(persistedRefs[persistedRefs.length - 1]).toEqual(1);
  });

  // TODO(task-14): enable once the FakeOpenAI harness gains an IMAGE scenario
  // (e.g. "stream-generated-image" emitting a delta.images b64_json frame).
  // The current fake server streams text/tool calls only, so the live
  // generate→edit round-trip cannot run deterministically here.
  //
  // MANUAL VERIFICATION (performed on the feature branch): generate an image
  // from a plain conversation, click "Use as reference" on the rendered
  // image, send "add a dog beside the lion" and confirm (a) no
  // workspace_required tool card appears, (b) a second image renders, and
  // (c) selecting two images before sending yields tray badges ①② in
  // selection order.
  //
  // Steps the enabled test will drive (all stubbed, no live backend):
  // 1. setScenario("stream-generated-image"); send "draw a lion".
  // 2. Expect one .v2-message__generated-image tile with actions visible.
  // 3. Click "Use as reference"; assert the tray chip appears.
  // 4. Send "add a dog beside the lion"; poll fakeAi.getRequests() and assert
  //    the second request carries the reference (messageCount grows and the
  //    engine logs generated_image_references) once the redacted request log
  //    exposes reference counts.
  // 5. Assert no workspace_required text and a SECOND image tile renders.
  test.fixme("full generate → use-as-reference → edit round-trip", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-text"); // placeholder until an image scenario exists
    await createConversationWithStreamedTurn(
      aiApp,
      `e2e-genimg-roundtrip-${Date.now()}`
    );
  });
});

/**
 * Shared helpers for generated-image E2E specs.
 *
 * Deterministic, no live image backend: a real streamed turn creates the
 * conversation + assistant row, then the helper writes PNG files under the
 * redirected userData root and rewrites that row's `metadata.generatedImages`
 * through the sqlite3 CLI from the test process (no native-ABI coupling with
 * the Electron main bundle). Rendering, reference resolution
 * (GeneratedImageReferenceService reads those exact files from disk) and
 * persistence all run through the real production paths.
 */

import type { LaunchedApp } from "../fixtures/electronApp";
import type { E2ETestRoot } from "../fixtures/types";
import { expect, type Locator } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";

const execFileAsync = promisify(execFile);

/** Must match the seeded USEREMAIL in src/main-process/e2e/E2EStateSeeder.ts. */
export const E2E_USER_EMAIL = "e2e@aifetchly.test";

/** URL-encoded form used inside protocol URLs (encodeURIComponent of the
 * normalized email), matching buildGeneratedImageProtocolUrl exactly. */
export const E2E_USER_EMAIL_URL_PART = "e2e%40aifetchly.test";

export const GENERATED_IMAGE_PROTOCOL_HOST =
  "aifetchly-generated-image://local/";

/** Directory name under userData — matches AI_CHAT_GENERATED_IMAGE_DIR. */
export const GENERATED_IMAGE_DIR = "ai-chat-generated-images";

/** SQLite file created by SqliteDb under USERSDBPATH (the database dir). */
export const DB_FILE_NAME = "scraper.db";

/** Minimal valid 1x1 transparent PNG (well-known constant bytes). */
export const ONE_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Minimal valid 1x1 red PNG — a SECOND distinct image for order assertions. */
export const RED_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export interface GeneratedImageMetadataEntry {
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

/** One image to seed: display name + the PNG bytes written to disk. */
export interface SeedableImage {
  readonly fileName: string;
  readonly pngBase64: string;
}

export interface HistoryMessageView {
  readonly id: string;
  readonly role: string;
  readonly messageType?: string;
  readonly content?: string;
  readonly metadata?: {
    readonly source?: string;
    readonly generatedImageReferences?: readonly unknown[];
  } | null;
}

export interface SeededGeneratedImageTurn {
  readonly conversationId: string;
  readonly assistantMessageId: string;
  readonly updatedRows: number;
}

/** The composer's real <textarea> (first one — Vuetify adds a hidden
 * measurement textarea). Mirrors aiChat.test.ts. */
export function composerTextarea(app: LaunchedApp): Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

/** Open the AI chat dock and wait for the composer to be actionable. */
export async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composerTextarea(app)).toBeVisible({ timeout: 30_000 });
}

/**
 * Read conversation id + last persisted chat-v2 assistant message id through
 * the REAL history IPC (same bridge usage as persistence.test.ts).
 */
export async function readLatestAssistantTurn(
  app: LaunchedApp,
  marker: string
): Promise<{ conversationId: string; assistantMessageId: string }> {
  const result = await app.mainWindow.evaluate(async (titleMarker: string) => {
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
      title: string;
    }>;
    // Target the conversation created by THIS test via its unique marker.
    // The conversation TITLE is derived from the assistant reply, not the
    // user message, so locate the conversation whose HISTORY contains a user
    // message with the exact marker text — never a positional index.
    let target: { conversationId: string } | null = null;
    let messages: HistoryMessageView[] = [];
    for (const conv of convs) {
      const histResp = await api.invoke(
        "ai-chat-v2:history",
        JSON.stringify({ conversationId: conv.conversationId })
      );
      const histData = (histResp?.data ?? {}) as {
        messages?: HistoryMessageView[];
      };
      const convMessages = histData.messages ?? [];
      const hasMarker = convMessages.some(
        (m) => m.role === "user" && m.content === titleMarker
      );
      if (hasMarker) {
        target = conv;
        messages = convMessages;
        break;
      }
    }
    if (!target) {
      return null;
    }
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
      conversationId: target.conversationId,
      assistantMessageId: last.id,
    };
  }, marker);
  if (!result) {
    throw new Error(
      "No persisted chat-v2 assistant message found after streamed turn"
    );
  }
  return result;
}

/**
 * Deterministically turn the latest streamed assistant message into a
 * generated-image message carrying `images` (default: two named images with
 * distinct PNG bytes so order/exclusion assertions are possible).
 * Returns the seeded turn identity + the number of updated rows.
 */
export async function seedGeneratedImagesOnLastTurn(
  app: LaunchedApp,
  testRoot: E2ETestRoot,
  marker: string,
  images: readonly SeedableImage[] = [
    { fileName: "lion.png", pngBase64: ONE_PX_PNG_BASE64 },
    { fileName: "savanna.png", pngBase64: RED_PX_PNG_BASE64 },
  ]
): Promise<SeededGeneratedImageTurn> {
  const { conversationId, assistantMessageId } = await readLatestAssistantTurn(
    app,
    marker
  );

  const messageDir = path.join(
    testRoot.userDataPath,
    GENERATED_IMAGE_DIR,
    E2E_USER_EMAIL,
    conversationId,
    assistantMessageId
  );
  fs.mkdirSync(messageDir, { recursive: true });

  const entries: GeneratedImageMetadataEntry[] = images.map((image, index) => {
    const filePath = path.join(messageDir, `image-${index + 1}.png`);
    fs.writeFileSync(filePath, Buffer.from(image.pngBase64, "base64"));
    const protocolUrl =
      `${GENERATED_IMAGE_PROTOCOL_HOST}${E2E_USER_EMAIL_URL_PART}/` +
      `${encodeURIComponent(conversationId)}/` +
      `${encodeURIComponent(assistantMessageId)}/` +
      `${encodeURIComponent(`image-${index + 1}.png`)}`;
    return {
      type: "image",
      delivery: "local_file",
      url: protocolUrl,
      local_path: filePath,
      file_name: image.fileName,
      mime_type: "image/png",
      download_required: false,
      width: 1,
      height: 1,
    };
  });

  const metadataJson = JSON.stringify({
    source: "chat-v2",
    finishReason: "stop",
    generatedImages: entries,
  });

  // Rewrite the row's metadata through the sqlite3 CLI from the TEST process:
  // the app's node_modules better-sqlite3 is rebuilt for Electron's ABI (the
  // test process cannot load it), the E2E main bundle keeps `require`
  // module-scoped (Playwright's global-scope evaluate cannot reach it), and
  // dynamic import needs a callback Electron does not register. The CLI has
  // none of those constraints. The metadata rides a temp file via readfile()
  // so no SQL quoting hazards exist, and a busy timeout rides out the app's
  // own short-lived writes.
  const dbPath = path.join(testRoot.databasePath, DB_FILE_NAME);
  const metaFile = path.join(
    testRoot.rootPath,
    `seed-meta-${assistantMessageId}.json`
  );
  fs.writeFileSync(metaFile, metadataJson, "utf8");
  const sqlLiteral = (value: string): string =>
    `'${value.replace(/'/g, "''")}'`;
  const sql =
    `UPDATE ai_chat_messages SET metadata = CAST(readfile(${sqlLiteral(
      metaFile
    )}) AS TEXT) ` +
    `WHERE messageId = ${sqlLiteral(assistantMessageId)} ` +
    `AND conversationId = ${sqlLiteral(conversationId)}; ` +
    `SELECT changes();`;
  let changes = 0;
  try {
    const { stdout } = await execFileAsync("sqlite3", [
      dbPath,
      "-cmd",
      ".timeout 10000",
      sql,
    ]);
    changes = parseInt(stdout.trim(), 10) || 0;
  } finally {
    fs.rmSync(metaFile, { force: true });
  }

  if (changes !== 1) {
    throw new Error(
      `Expected to update exactly 1 message row, updated ${changes}`
    );
  }

  return {
    conversationId,
    assistantMessageId,
    updatedRows: changes,
  };
}

/** Open the conversation-history dialog and select the conversation whose
 * title contains `marker`, which reloads history through the real IPC. */
export async function switchToConversationByMarker(
  app: LaunchedApp,
  marker: string
): Promise<void> {
  // The dialog lists conversations by TITLE (derived from the assistant
  // reply, not the marker), so resolve the target's title through the real
  // history IPC first. Tests that switch back run in a fresh root with the
  // seeded conversation as the only one, so a title match is unambiguous.
  const title = await app.mainWindow.evaluate(async (titleMarker: string) => {
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
      title: string;
    }>;
    for (const conv of convs) {
      const histResp = await api.invoke(
        "ai-chat-v2:history",
        JSON.stringify({ conversationId: conv.conversationId })
      );
      const histData = (histResp?.data ?? {}) as {
        messages?: HistoryMessageView[];
      };
      const hasMarker = (histData.messages ?? []).some(
        (m) => m.role === "user" && m.content === titleMarker
      );
      if (hasMarker) return conv.title;
    }
    return null;
  }, marker);
  if (!title) {
    throw new Error(`No conversation found containing marker ${marker}`);
  }

  await app.mainWindow.getByTitle("Conversation history").click();
  const listItem = app.mainWindow
    .locator(".v-list-item")
    .filter({ hasText: title })
    .first();
  await expect(listItem).toBeVisible({ timeout: 30_000 });
  await listItem.click();
  await expect(composerTextarea(app)).toBeVisible({ timeout: 30_000 });
}

/** Create a fresh (workspace-less) conversation view. */
export async function startNewConversation(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("new-conversation").click();
  await expect(
    app.mainWindow.getByTestId("ai-chat-generated-ref-tray")
  ).toHaveCount(0);
}

/** Run one deterministic text turn so a real conversation exists. */
export async function createConversationWithStreamedTurn(
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
  // The composer returns to an actionable state (the send BUTTON stays
  // disabled while the composer is empty — disable-on-empty is correct).
  await expect(composerTextarea(app)).not.toBeDisabled({ timeout: 30_000 });
}

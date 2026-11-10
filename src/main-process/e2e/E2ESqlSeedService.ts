/**
 * E2E-only SQL seeding bridge (design §8.3 companion).
 *
 * Playwright's `electronApp.evaluate` runs serialized callbacks in a realm
 * WITHOUT the CommonJS `require` global and WITHOUT a dynamic-import
 * callback, so specs cannot load `better-sqlite3` themselves. This module
 * runs inside the E2E main bundle (normal module loading, Electron's native
 * ABI) and exposes a narrow, explicitly-typed seeding hook on `globalThis`
 * for specs to call from `evaluate`.
 *
 * Only the message-metadata rewrite the generated-image specs need is
 * exposed — deliberately NOT a generic SQL runner.
 */

import Database from "better-sqlite3";

export interface E2EMessageMetadataSeedPayload {
  readonly dbPath: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly metadataJson: string;
}

export interface E2EMessageMetadataSeedResult {
  readonly changes: number;
}

/**
 * Rewrite ONE ai_chat_messages row's metadata (columns are camelCase per
 * TypeORM's DefaultNamingStrategy — see src/entity/AIChatMessage.entity.ts).
 */
export function e2eUpdateMessageMetadata(
  payload: E2EMessageMetadataSeedPayload
): E2EMessageMetadataSeedResult {
  const db = new Database(payload.dbPath, { timeout: 10_000 });
  try {
    const runResult = db
      .prepare(
        "UPDATE ai_chat_messages SET metadata = ? WHERE messageId = ? AND conversationId = ?"
      )
      .run(payload.metadataJson, payload.messageId, payload.conversationId);
    return { changes: runResult.changes };
  } finally {
    db.close();
  }
}

/** Typed shape of the `globalThis.__aifetchlyE2eSeed` hook. */
export interface E2ESeedBridge {
  readonly updateMessageMetadata: typeof e2eUpdateMessageMetadata;
}

/** Install the bridge (called once from E2EMain under AIFETCHLY_E2E). */
export function installE2ESeedBridge(): void {
  const globalScope = globalThis as Record<string, unknown>;
  if (globalScope.__aifetchlyE2eSeed !== undefined) {
    return; // idempotent — E2EMain may re-run under HMR-like relaunches
  }
  globalScope.__aifetchlyE2eSeed = {
    updateMessageMetadata: e2eUpdateMessageMetadata,
  } satisfies E2ESeedBridge;
}

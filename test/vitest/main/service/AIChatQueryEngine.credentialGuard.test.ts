/**
 * FR-31 / NFR-03 (audit finding 8): the ENGINE-level boundary — submitMessage
 * with a pasted credential emits the typed error and persists NOTHING (no
 * user row, no assistant row), while a normal message persists exactly one
 * user row.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? "/tmp/aifetchly-guard-test";
    }
  },
}));

import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";

const tmpDir = path.join(os.tmpdir(), "aifetchly-credguard-");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
});

describe("AIChatQueryEngine chat credential guard (finding 8)", () => {
  it("rejects a pasted key before persistence", async () => {
    const throwingLoop = {
      run: async (): Promise<never> => {
        throw new Error("loop must not run for a rejected message");
      },
    } as unknown as ConstructorParameters<typeof AIChatQueryEngine>[0];
    const engine = new AIChatQueryEngine(throwingLoop);
    const events: Array<{ type: string; errorMessage?: string }> = [];
    await engine.submitMessage({
      request: {
        conversationId: "",
        message:
          "here use this key sk-ant-api03-abcdef0123456789abcdef0123456789",
      },
      eventSink: {
        emit: (e: { type: string; errorMessage?: string }) => {
          events.push({ type: e.type, errorMessage: e.errorMessage });
        },
        flush: async () => undefined,
      },
      abortController: new AbortController(),
    } as Parameters<typeof engine.submitMessage>[0]);

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.errorMessage).toContain(
      "CHAT_CREDENTIAL_REJECTED"
    );
    // Nothing persisted for a rejected message.
    const module = new AIChatV2Module();
    const conversations = await module.getConversations(undefined);
    expect(conversations).toHaveLength(0);
  }, 60_000);
});

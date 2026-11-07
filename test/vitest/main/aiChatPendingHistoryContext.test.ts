import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import { AIChatPendingMessageModel } from "@/model/AIChatPendingMessage.model";

const tmpDir = path.join(os.tmpdir(), "aifetchly-pending-history");

vi.mock("electron", () => ({ app: { getPath: () => tmpDir } }));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

/**
 * FR-HIS-002 / design §12.11 (capability parity): a send accepted while the
 * conversation is busy must carry its selected archive context (opaque ids +
 * retry-stable submission identity) through the durable pending row and
 * replay it into the engine request at dispatch — silently dropping it would
 * execute the turn without the context the user selected.
 */
describe("AIChatPendingMessageModule history-context persistence", () => {
  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.startsWith("scraper.db")) {
        try {
          fs.unlinkSync(path.join(tmpDir, f));
        } catch {
          // ignore
        }
      }
    }
    (SqliteDb as unknown as { instance: unknown }).instance = null;
    (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
      null;
    (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
    process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  });

  it("persists historySelectionIds + submissionId and replays them at dispatch", async () => {
    const module = new AIChatPendingMessageModule();
    await SqliteDb.ensureInitialized();

    const created = await module.createPendingMessage({
      clientRequestId: "cr-history-1",
      request: {
        conversationId: "v2-history-ctx",
        message: "summarize the selected passages",
        historySelectionIds: ["src-1", "src-2"],
        submissionId: "11111111-2222-3333-4444-555555555555",
      },
    });
    expect(created.conversationId).toBe("v2-history-ctx");

    const model = new AIChatPendingMessageModel(tmpDir);
    const row = await model.getByPendingMessageId(created.pendingMessageId);
    expect(row).not.toBeNull();

    const moduleAny = module as unknown as {
      rebuildTurnInputs(row: unknown): Promise<{
        request: {
          historySelectionIds?: readonly string[];
          submissionId?: string;
        };
      }>;
    };
    const inputs = await moduleAny.rebuildTurnInputs(row);
    expect(inputs.request.historySelectionIds).toEqual(["src-1", "src-2"]);
    expect(inputs.request.submissionId).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
  });

  it("round-trips a request WITHOUT history context unchanged (no phantom fields)", async () => {
    const module = new AIChatPendingMessageModule();
    await SqliteDb.ensureInitialized();

    await module.createPendingMessage({
      clientRequestId: "cr-history-2",
      request: {
        conversationId: "v2-history-ctx-2",
        message: "plain queued message",
      },
    });

    const model = new AIChatPendingMessageModel(tmpDir);
    const views = await model.listByConversation("v2-history-ctx-2");
    expect(views).toHaveLength(1);
    const moduleAny = module as unknown as {
      rebuildTurnInputs(row: unknown): Promise<{
        request: {
          historySelectionIds?: readonly string[];
          submissionId?: string;
        };
      }>;
    };
    const inputs = await moduleAny.rebuildTurnInputs(views[0]);
    expect(inputs.request.historySelectionIds).toBeUndefined();
    expect(inputs.request.submissionId).toBeUndefined();
  });
});

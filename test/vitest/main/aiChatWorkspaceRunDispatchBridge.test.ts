import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatWorkspaceRunDispatchBridge } from "@/service/AIChatWorkspaceRunDispatchBridge";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import { AIChatTurnQueueService } from "@/service/AIChatTurnQueueService";
import type { AIChatTurnQueueEngine } from "@/service/AIChatTurnQueueService";
import type { AIChatTurnTerminalEvent } from "@/service/AIChatQueryEvents";
import { AIChatRunModel } from "@/model/AIChatRun.model";

const tmpDir = path.join(os.tmpdir(), "aifetchly-run-bridge");

vi.mock("electron", () => ({ app: { getPath: () => tmpDir } }));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

/**
 * T1 (audit; design AD-001..004): the queue/run identity bridge.
 *
 * Identity mapping under test (audit item 4):
 *   clientRequestId → pendingMessageId (unique index)
 *   pendingMessageId → run.sourceId (bridge, idempotent)
 *   userMessageId    = user-pending-<pendingMessageId>
 *   assistantMessageId = assistant-pending-<pendingMessageId>
 *
 * Invariants: one accepted send → one pending row → at most one
 * non-terminal interactive run; the queue is the single dispatch authority
 * (one submitPersistedUserMessage per pending row); restart recovery never
 * contacts the provider.
 */
describe("AIChatWorkspaceRunDispatchBridge (T1, AD-002/003)", () => {
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
    SqliteDb.getInstance(tmpDir);
  });

  it("mints the envelope at claim with sourceId = pendingMessageId, idempotently", async () => {
    await SqliteDb.ensureInitialized();
    const bridge = new AIChatWorkspaceRunDispatchBridge(new AIChatRunModule());
    const first = await bridge.schedule({
      pendingMessageId: "pending-aaa",
      conversationId: "v2-conv-1",
      resourceClass: "general",
    });
    expect(first).not.toBeNull();

    // Second claim of the same row reuses the SAME envelope (invariant 2).
    const second = await bridge.schedule({
      pendingMessageId: "pending-aaa",
      conversationId: "v2-conv-1",
      resourceClass: "general",
    });
    expect(second?.runId).toBe(first?.runId);

    // Durable linkage: exactly one interactive run carries the source id.
    const model = new AIChatRunModel(tmpDir);
    const rows = await model.findBySourceId("interactive", "pending-aaa");
    expect(rows?.runId).toBe(first?.runId);
    expect(rows?.status).toBe("running");
  });

  it("refuses a conversation-mismatched envelope (no cross-linked execution)", async () => {
    await SqliteDb.ensureInitialized();
    const bridge = new AIChatWorkspaceRunDispatchBridge(new AIChatRunModule());
    const first = await bridge.schedule({
      pendingMessageId: "pending-bbb",
      conversationId: "v2-conv-a",
      resourceClass: "general",
    });
    expect(first).not.toBeNull();
    // The same pending id claimed under a DIFFERENT conversation is refused.
    const mismatch = await bridge.schedule({
      pendingMessageId: "pending-bbb",
      conversationId: "v2-conv-b",
      resourceClass: "general",
    });
    expect(mismatch).toBeNull();
  });

  it("finishRun persists the terminal state exactly once", async () => {
    await SqliteDb.ensureInitialized();
    const runModule = new AIChatRunModule();
    const bridge = new AIChatWorkspaceRunDispatchBridge(runModule);
    const { runId } = (await bridge.schedule({
      pendingMessageId: "pending-ccc",
      conversationId: "v2-conv-c",
      resourceClass: "general",
    }))!;
    await bridge.finishRun(runId, "completed");
    const model = new AIChatRunModel(tmpDir);
    expect((await model.getByRunId(runId))?.status).toBe("completed");
    // Idempotent: a replayed terminal is ignored (terminal rows immutable).
    await bridge.finishRun(runId, "failed");
    expect((await model.getByRunId(runId))?.status).toBe("completed");
  });
});

describe("queue dispatch through the bridge (T1: one dispatch authority)", () => {
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
    SqliteDb.getInstance(tmpDir);
  });

  function makeEngine(): AIChatTurnQueueEngine & {
    persistedSubmits: Array<{ request: { message: string } }>;
  } {
    const persistedSubmits: Array<{ request: { message: string } }> = [];
    const statuses = new Map<string, string>();
    return {
      persistedSubmits,
      submitPersistedUserMessage(input: {
        request: { conversationId?: string; message: string };
      }): Promise<AIChatTurnTerminalEvent> {
        persistedSubmits.push({ request: input.request });
        return Promise.resolve({
          type: "completed",
          conversationId: input.request.conversationId ?? "",
          assistantMessageId: "assistant-pending-x",
        });
      },
      submitMessage(): Promise<void> {
        return Promise.reject(
          new Error("coordinator-style submitMessage must NOT run for queue turns")
        );
      },
      stopActiveTurn(): void {
        /* unused */
      },
      getConversationRuntimeStatus(conversationId: string): "idle" {
        statuses.get(conversationId);
        return "idle";
      },
    } as unknown as AIChatTurnQueueEngine & {
      persistedSubmits: Array<{ request: { message: string } }>;
    };
  }

  it("an IDLE send becomes a pending row, mints one envelope, and dispatches exactly once", async () => {
    await SqliteDb.ensureInitialized();
    const engine = makeEngine();
    const runModule = new AIChatRunModule();
    const bridge = new AIChatWorkspaceRunDispatchBridge(runModule);
    const service = new AIChatTurnQueueService({
      engine,
      pendingModule: new AIChatPendingMessageModule(),
      eventSink: { emit: () => undefined },
      streamSinkFactory: () => ({ emit: () => undefined }) as never,
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => false,
      dispatchBridge: bridge,
    });

    // forceQueue FALSE = idle send (the workspace handler's new path).
    const receipt = await service.submit({
      forceQueue: false,
      clientRequestId: "cr-t1-idle-1",
      request: {
        conversationId: "v2-t1-idle",
        message: "hello from the idle path",
      },
    });
    expect(receipt.pendingMessage).not.toBeNull();
    // Let the scheduled drain complete.
    await new Promise((r) => setTimeout(r, 50));

    // ONE engine submission for the message — the queue is the authority.
    expect(engine.persistedSubmits).toHaveLength(1);
    expect(engine.persistedSubmits[0].request.message).toBe(
      "hello from the idle path"
    );

    // Identity chain: pending row → run envelope by sourceId.
    const model = new AIChatRunModel(tmpDir);
    const run = await model.findBySourceId(
      "interactive",
      receipt.pendingMessage!.pendingMessageId
    );
    expect(run).not.toBeNull();
    expect(run?.status).toBe("completed"); // bridge terminal mapping ran
  });

  it("a duplicate clientRequestId cannot create a second job (identity invariant)", async () => {
    await SqliteDb.ensureInitialized();
    const engine = makeEngine();
    const service = new AIChatTurnQueueService({
      engine,
      pendingModule: new AIChatPendingMessageModule(),
      eventSink: { emit: () => undefined },
      streamSinkFactory: () => ({ emit: () => undefined }) as never,
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => false,
    });
    const first = await service.submit({
      forceQueue: true, // keep queued: no dispatch, pure identity check
      clientRequestId: "cr-t1-dedupe",
      request: { conversationId: "v2-t1-dedupe", message: "only once" },
    });
    const second = await service.submit({
      forceQueue: true,
      clientRequestId: "cr-t1-dedupe", // SAME identity — a send-button retry
      request: { conversationId: "v2-t1-dedupe", message: "only once" },
    });
    expect(first.pendingMessage?.pendingMessageId).toBe(
      second.pendingMessage?.pendingMessageId
    );
  });
});

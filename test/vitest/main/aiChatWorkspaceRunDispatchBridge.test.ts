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
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";

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

  /**
   * R01 (audit): admissions dispatched while another claim pumps must be
   * consumable by their own pending claim — never discarded. Here B's
   * retry pump admits the higher-priority C: B stays unadmitted, and C's
   * admission is preserved as consumable ownership that C's own next
   * submission-claim consumes (the defect left C durably queued forever
   * while it held the scheduler slot).
   */
  it("records cross-candidate pump admissions and hands them to their claim", async () => {
    await SqliteDb.ensureInitialized();
    const scheduler = new AIChatExecutionScheduler({ generalCapacity: 1 });
    const bridge = new AIChatWorkspaceRunDispatchBridge(
      new AIChatRunModule(),
      scheduler
    );
    const occupied = (
      await bridge.schedule({
        pendingMessageId: "pending-r01-occupied",
        conversationId: "v2-r01-occupied",
        resourceClass: "general",
      })
    )!;
    expect(occupied.admitted).toBe(true);
    const deferredCandidate = (
      await bridge.schedule({
        pendingMessageId: "pending-r01-c",
        conversationId: "v2-r01-c",
        resourceClass: "general",
      })
    )!;
    expect(deferredCandidate.admitted).toBe(false);

    // C becomes the selected conversation; then the slot frees and B claims.
    scheduler.setSelectedConversation("v2-r01-c");
    await bridge.finishRun(occupied.runId, "completed");
    const retried = await bridge.schedule({
      pendingMessageId: "pending-r01-b",
      conversationId: "v2-r01-b",
      resourceClass: "general",
    });
    expect(retried?.admitted).toBe(false);

    // The preserved ownership: C holds the slot (dispatched cross-candidate)
    // while its durable envelope stayed queued without an executer.
    const model = new AIChatRunModel(tmpDir);
    expect(scheduler.isActive(deferredCandidate.runId)).toBe(true);
    expect((await model.getByRunId(deferredCandidate.runId))?.status).toBe(
      "queued"
    );

    // C's own submission-claim consumes the preserved admission: admitted.
    const cClaim = await bridge.schedule({
      pendingMessageId: "pending-r01-c",
      conversationId: "v2-r01-c",
      resourceClass: "general",
    });
    expect(cClaim?.runId).toBe(deferredCandidate.runId);
    expect(cClaim?.admitted).toBe(true);
    expect((await model.getByRunId(deferredCandidate.runId))?.status).toBe(
      "running"
    );

    // Cleanup: no scheduler slots or recorded admissions leak.
    await bridge.finishRun(deferredCandidate.runId, "completed");
    bridge.cancelDeferred(retried!.runId);
    await bridge.finishRun(retried!.runId, "cancelled");
    expect(scheduler.stats().active).toBe(0);
    expect(scheduler.stats().queued).toBe(0);
  });

  /**
   * R01: admitDeferred's own pump must also record other candidates'
   * admissions (the discarded `() => undefined` callback of the defect) so
   * the dispatched candidate's own submission-claim can consume it.
   */
  it("records admissions pumped by admitDeferred for their own claims", async () => {
    await SqliteDb.ensureInitialized();
    const scheduler = new AIChatExecutionScheduler({ generalCapacity: 1 });
    const bridge = new AIChatWorkspaceRunDispatchBridge(
      new AIChatRunModule(),
      scheduler
    );
    const occupied = (
      await bridge.schedule({
        pendingMessageId: "pending-r01d-occupied",
        conversationId: "v2-r01d-occupied",
        resourceClass: "general",
      })
    )!;
    const candidate = (
      await bridge.schedule({
        pendingMessageId: "pending-r01d-c",
        conversationId: "v2-r01d-c",
        resourceClass: "general",
      })
    )!;
    const other = (
      await bridge.schedule({
        pendingMessageId: "pending-r01d-d",
        conversationId: "v2-r01d-d",
        resourceClass: "general",
      })
    )!;
    expect(candidate.admitted).toBe(false);
    expect(other.admitted).toBe(false);

    // D is selected; the slot frees; C's admitDeferred pump dispatches D
    // (cross-candidate) while C itself stays unadmitted this attempt.
    scheduler.setSelectedConversation("v2-r01d-d");
    await bridge.finishRun(occupied.runId, "completed");
    expect(await bridge.admitDeferred(candidate.runId)).toBe(false);

    // D's own submission-claim consumes the preserved admission.
    const model = new AIChatRunModel(tmpDir);
    expect(
      (
        await bridge.schedule({
          pendingMessageId: "pending-r01d-d",
          conversationId: "v2-r01d-d",
          resourceClass: "general",
        })
      )?.admitted
    ).toBe(true);
    expect((await model.getByRunId(other.runId))?.status).toBe("running");

    // Cleanup.
    await bridge.finishRun(other.runId, "completed");
    bridge.cancelDeferred(candidate.runId);
    await bridge.finishRun(candidate.runId, "cancelled");
    expect(scheduler.stats().active).toBe(0);
    expect(scheduler.stats().queued).toBe(0);
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

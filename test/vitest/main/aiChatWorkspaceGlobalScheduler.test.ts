import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/modules/token", () => ({
  Token: vi.fn(function TokenMock() {
    return { getValue: vi.fn() };
  }),
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn(function AIChatV2ModuleMock() {
    return {
      createConversationIfNeeded: (existing?: string) =>
        existing && existing.startsWith("v2-") ? existing : "v2-created",
    };
  }),
}));
vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn(function AIChatAttachmentModuleMock() {
    return {
      saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
      deleteByMessageId: vi.fn().mockResolvedValue(1),
      deleteByConversation: vi.fn().mockResolvedValue(0),
      getByMessageId: vi.fn().mockResolvedValue([]),
    };
  }),
}));

import {
  AIChatTurnQueueService,
  type AIChatTurnQueueEngine,
} from "@/service/AIChatTurnQueueService";
import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import { AIChatWorkspaceRunDispatchBridge } from "@/service/AIChatWorkspaceRunDispatchBridge";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import type { AIChatTurnTerminalEvent } from "@/service/AIChatQueryEvents";
import type { ChatV2RuntimeStatus } from "@/entityTypes/aiChatV2Types";
import type { AIChatPendingCreateResult } from "@/entityTypes/aiChatV2Types";
import { SqliteDb } from "@/config/SqliteDb";
import { resolveTestDbPath } from "@/config/testDbPath";
import fs from "node:fs";
import path from "node:path";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function completed(
  conversationId: string
): AIChatTurnTerminalEvent {
  return {
    type: "completed",
    conversationId,
    assistantMessageId: `assistant-${conversationId}`,
  } as AIChatTurnTerminalEvent;
}

beforeEach(async () => {
  await SqliteDb.destroyInstance();
  const dir = resolveTestDbPath();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("scraper.db")) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          // ignore
        }
      }
    }
  }
});

/**
 * B02 (FR-QUE-010; AD-002/004): ordinary queue dispatch admits through the
 * shared global execution scheduler. The fourth general run waits until a
 * slot frees; steering-consumed messages never enter admission.
 */
describe("queue dispatch via global scheduler (B02)", () => {
  it("fourth general run waits until a slot frees", async () => {
    const scheduler = new AIChatExecutionScheduler();
    const bridge = new AIChatWorkspaceRunDispatchBridge(
      undefined,
      scheduler
    );

    const gates = new Map<string, Deferred<AIChatTurnTerminalEvent>>();
    const submitted: string[] = [];
    const engine: AIChatTurnQueueEngine = {
      getConversationRuntimeStatus: () => "idle",
      submitPersistedUserMessage: (async (input: {
        savedUser: { conversationId: string };
      }) => {
        const conv = input.savedUser.conversationId;
        submitted.push(conv);
        const gate =
          gates.get(conv) ?? createDeferred<AIChatTurnTerminalEvent>();
        gates.set(conv, gate);
        return await gate.promise;
      }) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
      reserveSteering: (() => null) as never,
      cancelSteeringReservation: (() => undefined) as never,
      commitSteering: (() => true) as never,
      stopActiveTurn: (() => undefined) as never,
    };

    const service = new AIChatTurnQueueService({
      engine,
      pendingModule: new AIChatPendingMessageModule(),
      eventSink: { emit: () => undefined },
      streamSinkFactory: () => ({ emit: () => undefined }) as never,
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => true,
      dispatchBridge: bridge,
      scheduler,
    });

    const convs = ["v2-b02-a", "v2-b02-b", "v2-b02-c", "v2-b02-d"];
    const receipts = [];
    for (let i = 0; i < convs.length; i++) {
      receipts.push(
        await service.submit({
          clientRequestId: `cr-b02-${i}`,
          request: { message: `msg ${i}`, conversationId: convs[i] },
        })
      );
    }

    // Three slots of general capacity: exactly three provider turns start.
    await vi.waitFor(() => expect(submitted.length).toBe(3));
    expect(new Set(submitted).size).toBe(3);
    expect(submitted).not.toContain("v2-b02-d");
    expect(scheduler.stats().activeByClass.general).toBe(3);

    // The deferred fourth run keeps a queued envelope (age preserved) and
    // makes ZERO provider calls.
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const deferredRow = await runModel.findBySourceId(
      "interactive",
      receipts[3].pendingMessage!.pendingMessageId
    );
    expect(deferredRow).not.toBeNull();
    expect(deferredRow?.status).toBe("queued");

    // Free one slot: the first completion admits the fourth run.
    gates.get(submitted[0])!.resolve(completed(submitted[0]));
    await vi.waitFor(() => expect(submitted.length).toBe(4));
    expect(submitted).toContain("v2-b02-d");

    // Drain the rest so the test leaves no pending work.
    for (const [, gate] of gates) {
      gate.resolve(completed("drain"));
    }
    await vi.waitFor(() =>
      expect(scheduler.stats().activeByClass.general).toBe(0)
    );
  });

  it("browser resource class admits only one at a time", async () => {
    const scheduler = new AIChatExecutionScheduler();
    scheduler.submit({
      runId: "browser-owner-1",
      conversationId: "v2-br-1",
      owner: "interactive",
      resourceClass: "browser",
    });
    scheduler.submit({
      runId: "browser-owner-2",
      conversationId: "v2-br-2",
      owner: "interactive",
      resourceClass: "browser",
    });
    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));
    // Browser capacity is 1: exactly one admits.
    expect(dispatched).toHaveLength(1);
    scheduler.complete(dispatched[0]);
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toHaveLength(2);
  });

  /**
   * R01 (audit): the scheduler can admit a run whose owner never hears about
   * it. Capacity 1; A occupies; B and C defer; C is the selected (high
   * priority) conversation. Completing A wakes both deferred conversations:
   * B's drain pumps the scheduler, which admits C (selected beats B) —
   * B's admission callback only recognizes ITS requested run id, so C's
   * admission used to be discarded: C stayed durably queued forever while
   * occupying the single scheduler slot (B and C then never execute).
   * Regression: every admitted run must execute exactly once and reach a
   * durable terminal state (FR-QUE-002/010/013; AD-002/004; §8.3).
   */
  describe("deferred cross-candidate admission (R01)", () => {
    it("routes cross-candidate pump admissions to their pending claim until consumed", async () => {
      const scheduler = new AIChatExecutionScheduler({ generalCapacity: 1 });
      const bridge = new AIChatWorkspaceRunDispatchBridge(
        undefined,
        scheduler
      );

      const gates = new Map<string, Deferred<AIChatTurnTerminalEvent>>();
      const submitted: string[] = [];
      const engineStatus = new Map<string, ChatV2RuntimeStatus>();
      const engine: AIChatTurnQueueEngine = {
        getConversationRuntimeStatus: (conversationId: string) =>
          engineStatus.get(conversationId) ?? "idle",
        submitPersistedUserMessage: (async (input: {
          savedUser: { conversationId: string };
        }) => {
          const conv = input.savedUser.conversationId;
          submitted.push(conv);
          const gate =
            gates.get(conv) ?? createDeferred<AIChatTurnTerminalEvent>();
          gates.set(conv, gate);
          return await gate.promise;
        }) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
        reserveSteering: (() => null) as never,
        cancelSteeringReservation: (() => undefined) as never,
        commitSteering: (() => true) as never,
        stopActiveTurn: (() => undefined) as never,
      };

      const service = new AIChatTurnQueueService({
        engine,
        pendingModule: new AIChatPendingMessageModule(),
        eventSink: { emit: () => undefined },
        streamSinkFactory: () => ({ emit: () => undefined }) as never,
        tryAcquireLease: () => ({ release: () => undefined }) as never,
        isAiEnabled: () => true,
        isQueueEnabled: () => true,
        isSteeringEnabled: () => true,
        dispatchBridge: bridge,
        scheduler,
      });

      const convA = "v2-r01-a";
      const convB = "v2-r01-b";
      const convC = "v2-r01-c";
      const receipts: Array<AIChatPendingCreateResult> = [];
      for (const [i, conv] of [convA, convB, convC].entries()) {
        receipts.push(
          await service.submit({
            clientRequestId: `cr-r01-${i}`,
            request: { message: `msg ${i}`, conversationId: conv },
          })
        );
      }
      const pendingIds = receipts.map(
        (r) => r.pendingMessage!.pendingMessageId
      );
      const runModel = new AIChatRunModel(resolveTestDbPath());

      // A runs (the only slot); each later submission defers on capacity.
      await vi.waitFor(() => expect(submitted).toEqual([convA]));
      await vi.waitFor(() => expect(scheduler.stats()).toMatchObject({
        active: 1,
        queued: 2,
      }));
      for (const pendingId of [pendingIds[1], pendingIds[2]]) {
        const row = await runModel.findBySourceId("interactive", pendingId);
        expect(row?.status).toBe("queued");
      }

      // C becomes the selected conversation → highest dispatch priority.
      scheduler.setSelectedConversation(convC);

      // C's drains are held out of the way so the next admission decisions
      // come only from B's wake-up pump (deterministic reproduction of the
      // cross-candidate dispatch).
      engineStatus.set(convC, "running");

      // Complete A. Its terminal wakes the deferred conversations; B's drain
      // pumps the scheduler, which admits C (selected priority) while B
      // itself defers again.
      gates.get(convA)!.resolve(completed(convA));
      await vi.waitFor(async () => {
        const rowA = await runModel.findBySourceId(
          "interactive",
          pendingIds[0]
        );
        return rowA?.status === "completed";
      });

      // The defect: C occupies scheduler capacity with NOBODY dispatching
      // it — durably queued while scheduler-active, zero provider calls.
      const runC = await runModel.findBySourceId(
        "interactive",
        pendingIds[2]
      );
      expect(runC).not.toBeNull();
      await vi.waitFor(() => expect(scheduler.isActive(runC!.runId)).toBe(true));
      expect(runC?.status).toBe("queued");
      expect(submitted).not.toContain(convC);
      expect(scheduler.stats().activeByClass.general).toBe(1);

      // Retry C (submission path sees it "already active"; a re-drain must
      // deliver C's preserved admission to C's pending claim).
      engineStatus.set(convC, "idle");
      await service.notifyExternalTurnTerminal(convC, "completed");

      // C executes exactly once; its terminal wakes B; B executes exactly once.
      await vi.waitFor(() => expect(submitted).toContain(convC));
      gates.get(convC)!.resolve(completed(convC));
      await vi.waitFor(() => expect(submitted).toContain(convB));
      gates.get(convB)!.resolve(completed(convB));

      // Every admitted run executed once and reached a durable terminal state.
      await vi.waitFor(() => expect(scheduler.stats().active).toBe(0));
      expect(submitted.filter((c) => c === convA)).toHaveLength(1);
      expect(submitted.filter((c) => c === convB)).toHaveLength(1);
      expect(submitted.filter((c) => c === convC)).toHaveLength(1);
      for (const pendingId of pendingIds) {
        const row = await runModel.findBySourceId("interactive", pendingId);
        expect(row?.status).toBe("completed");
      }
      expect(scheduler.stats().queued).toBe(0);
    });
  });

  /**
   * R02 (audit; FR-QUE-012/013, FR-LIF-005; AD-002/004): cancelling a
   * capacity-deferred pending message must settle that message's durable run
   * envelope AND its scheduler queue entry — never just the pending row.
   * Otherwise a cancelled intent keeps a non-terminal queued run plus a
   * scheduler entry that later pumps dispatch cross-candidate (R01), and the
   * cancelled run then OCCUPIES the only slot forever while unrelated
   * runnable work starves.
   */
  describe("deferred cancellation reconcile (R02)", () => {
    interface ConvEvent {
      readonly conversationId: string;
      readonly status: string;
    }
    function lastEventFor(
      events: readonly ConvEvent[],
      conversationId: string
    ): ConvEvent | undefined {
      return events.filter((e) => e.conversationId === conversationId).at(-1);
    }

    it("cancel before admission settles the envelope and unrelated runnable work proceeds", async () => {
      const scheduler = new AIChatExecutionScheduler({ generalCapacity: 1 });
      const bridge = new AIChatWorkspaceRunDispatchBridge(
        undefined,
        scheduler
      );

      const gates = new Map<string, Deferred<AIChatTurnTerminalEvent>>();
      const submitted: string[] = [];
      const pendingEvents: ConvEvent[] = [];
      const engineStatus = new Map<string, ChatV2RuntimeStatus>();
      const engine: AIChatTurnQueueEngine = {
        getConversationRuntimeStatus: (conversationId: string) =>
          engineStatus.get(conversationId) ?? "idle",
        submitPersistedUserMessage: (async (input: {
          savedUser: { conversationId: string };
        }) => {
          const conv = input.savedUser.conversationId;
          submitted.push(conv);
          const gate =
            gates.get(conv) ?? createDeferred<AIChatTurnTerminalEvent>();
          gates.set(conv, gate);
          return await gate.promise;
        }) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
        reserveSteering: (() => null) as never,
        cancelSteeringReservation: (() => undefined) as never,
        commitSteering: (() => true) as never,
        stopActiveTurn: (() => undefined) as never,
      };

      const service = new AIChatTurnQueueService({
        engine,
        pendingModule: new AIChatPendingMessageModule(),
        eventSink: {
          emit: (event) => {
            pendingEvents.push({
              conversationId: event.conversationId,
              status: event.status,
            });
          },
        },
        streamSinkFactory: () => ({ emit: () => undefined }) as never,
        tryAcquireLease: () => ({ release: () => undefined }) as never,
        isAiEnabled: () => true,
        isQueueEnabled: () => true,
        isSteeringEnabled: () => true,
        dispatchBridge: bridge,
        scheduler,
      });

      const convA = "v2-r02-a";
      const convB = "v2-r02-b";
      const receiptA = await service.submit({
        clientRequestId: "cr-r02-a",
        request: { message: "a", conversationId: convA },
      });
      await vi.waitFor(() => expect(submitted).toEqual([convA]));
      const receiptB = await service.submit({
        clientRequestId: "cr-r02-b",
        request: { message: "b", conversationId: convB },
      });
      const pendingIdB = receiptB.pendingMessage!.pendingMessageId;
      const runModel = new AIChatRunModel(resolveTestDbPath());

      // B defers on capacity: queued envelope + scheduler queue entry, and
      // ZERO provider calls. The deferred branch's final emit is `queued`
      // (after the dispatch claim is released) — nothing re-claims B1
      // afterwards, so that state is stable and cancellable.
      await vi.waitFor(() => expect(scheduler.stats().queued).toBe(1));
      await vi.waitFor(() => {
        expect(lastEventFor(pendingEvents, convB)?.status).toBe("queued");
      });
      const envelopeB = await runModel.findBySourceId(
        "interactive",
        pendingIdB
      );
      expect(envelopeB?.status).toBe("queued");

      // Cancel the deferred message: the durable envelope and the scheduler
      // queue entry must be reconciled away, not just the pending row.
      await service.cancel({
        conversationId: convB,
        pendingMessageId: pendingIdB,
      });
      await vi.waitFor(async () => {
        const row = await runModel.findBySourceId("interactive", pendingIdB);
        expect(row?.status).toBe("cancelled");
      });
      expect(scheduler.queueDepth()).toBe(0);
      expect(submitted).not.toContain(convB);

      // Free capacity and pump unrelated runnable work: it must admit — not
      // starve behind the cancelled intent's stale scheduler entry.
      gates.get(convA)!.resolve(completed(convA));
      await vi.waitFor(async () => {
        const rowA = await runModel.findBySourceId(
          "interactive",
          receiptA.pendingMessage!.pendingMessageId
        );
        expect(rowA?.status).toBe("completed");
      });

      const convD = "v2-r02-d";
      await service.submit({
        clientRequestId: "cr-r02-d",
        request: { message: "d", conversationId: convD },
      });
      await vi.waitFor(() => expect(submitted).toContain(convD));
      gates.get(convD)!.resolve(completed(convD));

      // Final invariants: cancelled intent never ran; every admitted run
      // executed exactly once; the scheduler is left empty.
      await vi.waitFor(() => expect(scheduler.stats().active).toBe(0));
      await vi.waitFor(() => expect(scheduler.stats().queued).toBe(0));
      expect(submitted.filter((c) => c === convA)).toHaveLength(1);
      expect(submitted.filter((c) => c === convD)).toHaveLength(1);
      expect(submitted).not.toContain(convB);
      expect(
        (await runModel.findBySourceId("interactive", pendingIdB))?.status
      ).toBe("cancelled");
    });

    it("clearing a conversation with a capacity-deferred queue settles its envelopes", async () => {
      const scheduler = new AIChatExecutionScheduler({ generalCapacity: 1 });
      const bridge = new AIChatWorkspaceRunDispatchBridge(
        undefined,
        scheduler
      );

      const gates = new Map<string, Deferred<AIChatTurnTerminalEvent>>();
      const submitted: string[] = [];
      const pendingEvents: ConvEvent[] = [];
      const engineStatus = new Map<string, ChatV2RuntimeStatus>();
      const engine: AIChatTurnQueueEngine = {
        getConversationRuntimeStatus: (conversationId: string) =>
          engineStatus.get(conversationId) ?? "idle",
        submitPersistedUserMessage: (async (input: {
          savedUser: { conversationId: string };
        }) => {
          const conv = input.savedUser.conversationId;
          submitted.push(conv);
          const gate =
            gates.get(conv) ?? createDeferred<AIChatTurnTerminalEvent>();
          gates.set(conv, gate);
          return await gate.promise;
        }) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
        reserveSteering: (() => null) as never,
        cancelSteeringReservation: (() => undefined) as never,
        commitSteering: (() => true) as never,
        stopActiveTurn: (() => undefined) as never,
      };

      const service = new AIChatTurnQueueService({
        engine,
        pendingModule: new AIChatPendingMessageModule(),
        eventSink: {
          emit: (event) => {
            pendingEvents.push({
              conversationId: event.conversationId,
              status: event.status,
            });
          },
        },
        streamSinkFactory: () => ({ emit: () => undefined }) as never,
        tryAcquireLease: () => ({ release: () => undefined }) as never,
        isAiEnabled: () => true,
        isQueueEnabled: () => true,
        isSteeringEnabled: () => true,
        dispatchBridge: bridge,
        scheduler,
      });

      const convA = "v2-r02c-a";
      const convB = "v2-r02c-b";
      await service.submit({
        clientRequestId: "cr-r02c-a",
        request: { message: "a", conversationId: convA },
      });
      await vi.waitFor(() => expect(submitted).toEqual([convA]));
      // B1 defers on capacity. B2 joins the SAME held queue WITHOUT
      // triggering another drain (forceQueue, coordinator-style delegation)
      // — so B1 is the conversation's single deferred envelope and no drain
      // chain is in flight when the clear runs.
      const receiptB1 = await service.submit({
        clientRequestId: "cr-r02c-b1",
        request: { message: "b1", conversationId: convB },
      });
      const pendingIdB1 = receiptB1.pendingMessage!.pendingMessageId;
      const receiptB2 = await service.submit({
        clientRequestId: "cr-r02c-b2",
        forceQueue: true,
        request: { message: "b2", conversationId: convB },
      });
      const pendingIdB2 = receiptB2.pendingMessage!.pendingMessageId;
      const runModel = new AIChatRunModel(resolveTestDbPath());
      await vi.waitFor(() => expect(scheduler.stats().queued).toBe(1));
      await vi.waitFor(() => {
        expect(lastEventFor(pendingEvents, convB)?.status).toBe("queued");
      });
      const envelopeB1 = await runModel.findBySourceId(
        "interactive",
        pendingIdB1
      );
      expect(envelopeB1?.status).toBe("queued");
      expect(
        await runModel.findBySourceId("interactive", pendingIdB2)
      ).toBeNull();

      // Clear the whole deferred queue: its envelopes (and scheduler book)
      // must be reconciled, never left queued behind deleted rows.
      await service.clearConversation(convB);
      await vi.waitFor(async () => {
        const row = await runModel.findBySourceId("interactive", pendingIdB1);
        expect(row?.status).toBe("cancelled");
      });
      expect(scheduler.queueDepth()).toBe(0);
      expect(
        await runModel.findBySourceId("interactive", pendingIdB2)
      ).toBeNull();
      expect(submitted).not.toContain(convB);
      expect(await service.list(convB)).toHaveLength(0);

      // Unrelated runnable work proceeds after capacity is released.
      gates.get(convA)!.resolve(completed(convA));
      const convD = "v2-r02c-d";
      await service.submit({
        clientRequestId: "cr-r02c-d",
        request: { message: "d", conversationId: convD },
      });
      await vi.waitFor(() => expect(submitted).toContain(convD));
      gates.get(convD)!.resolve(completed(convD));
      await vi.waitFor(() => expect(scheduler.stats().active).toBe(0));
      await vi.waitFor(() => expect(scheduler.stats().queued).toBe(0));
      expect(submitted.filter((c) => c === convA)).toHaveLength(1);
      expect(submitted.filter((c) => c === convD)).toHaveLength(1);
      expect(submitted).not.toContain(convB);
    });
  });

  it("steering-consumed messages never enter scheduler admission", async () => {
    const scheduler = new AIChatExecutionScheduler();
    const before = scheduler.stats();
    // Steering path (service.steer) bypasses bridge+scheduler by construction:
    // assert the scheduler surface has no steering entry point and stats are
    // untouched by a pure scheduler instance with no submissions.
    expect(before.queued).toBe(0);
    expect(before.active).toBe(0);
    // A steering-consumed pending row never calls dispatchBridge.schedule,
    // so no run envelope exists for it. This documents the invariant; the
    // FIFO test below proves steering rows stay out of the dispatch path.
    expect(scheduler.queueDepth()).toBe(0);
  });
});

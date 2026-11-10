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
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatWorkspaceRunDispatchBridge } from "@/service/AIChatWorkspaceRunDispatchBridge";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatTurnTerminalEvent,
} from "@/service/AIChatQueryEvents";
import { SqliteDb } from "@/config/SqliteDb";
import { resolveTestDbPath } from "@/config/testDbPath";
import fs from "node:fs";
import path from "node:path";

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

function parkedTerminal(
  type: "paused_for_permission" | "paused_for_plan_question",
  conversationId: string
): AIChatTurnTerminalEvent {
  return { type, conversationId, assistantMessageId: "a-parked" } as AIChatTurnTerminalEvent;
}

function completedTerminal(conversationId: string): AIChatTurnTerminalEvent {
  return {
    type: "completed",
    conversationId,
    assistantMessageId: `assistant-${conversationId}`,
  } as AIChatTurnTerminalEvent;
}

function makeHarness(nextTerminal: () => AIChatTurnTerminalEvent) {
  const scheduler = new AIChatExecutionScheduler();
  const bridge = new AIChatWorkspaceRunDispatchBridge(undefined, scheduler);
  const submitted: string[] = [];
  const engine: AIChatTurnQueueEngine = {
    getConversationRuntimeStatus: () => "idle",
    submitPersistedUserMessage: (async (input: {
      savedUser: { conversationId: string };
    }) => {
      submitted.push(input.savedUser.conversationId);
      return nextTerminal();
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
  return { scheduler, bridge, service, submitted };
}

/**
 * B04: parked and pre-turn-failed runs settle their durable envelopes.
 * Every parked outcome (grant completion / cancel) and every promotion
 * failure ends with exactly one correctly-settled envelope, released
 * lease/capacity, and (for promotion failure) zero provider turns beyond
 * the failed claim.
 */
describe("parked + pre-turn-failed run settlement (B04)", () => {
  it("permission park uses awaiting_permission and grant completion settles completed + drains follower", async () => {
    const conv = "v2-b04-perm";
    let calls = 0;
    const { service, submitted } = makeHarness(() => {
      calls += 1;
      // First dispatch parks; the follower (after grant) completes.
      return calls === 1
        ? parkedTerminal("paused_for_permission", conv)
        : completedTerminal(conv);
    });

    const first = await service.submit({
      clientRequestId: "cr-b04-p1",
      request: { message: "needs permission", conversationId: conv },
    });
    await vi.waitFor(() => expect(submitted.length).toBe(1));

    const runModel = new AIChatRunModel(resolveTestDbPath());
    const parked = await runModel.findBySourceId(
      "interactive",
      first.pendingMessage!.pendingMessageId
    );
    expect(parked?.status).toBe("awaiting_permission");

    // A follower queued behind the parked turn.
    await service.submit({
      forceQueue: true,
      clientRequestId: "cr-b04-p2",
      request: { message: "follower", conversationId: conv },
    });

    // Permission grant resumes OUTSIDE the queue; its terminal settles the
    // SAME envelope and drains the follower.
    await service.notifyExternalTurnTerminal(conv, "completed");
    await vi.waitFor(() => expect(submitted.length).toBe(2));
    const settled = await runModel.getByRunId(parked!.runId);
    expect(settled?.status).toBe("completed");
    // Exactly one envelope for the parked source id.
    const again = await runModel.findBySourceId(
      "interactive",
      first.pendingMessage!.pendingMessageId
    );
    expect(again?.runId).toBe(parked!.runId);
  });

  it("plan-question park uses awaiting_user and cancel settles cancelled + holds follower", async () => {
    const conv = "v2-b04-plan";
    let calls = 0;
    const { service, submitted } = makeHarness(() => {
      calls += 1;
      return parkedTerminal("paused_for_plan_question", conv);
    });

    const first = await service.submit({
      clientRequestId: "cr-b04-q1",
      request: { message: "needs answer", conversationId: conv },
    });
    await vi.waitFor(() => expect(submitted.length).toBe(1));

    const runModel = new AIChatRunModel(resolveTestDbPath());
    const parked = await runModel.findBySourceId(
      "interactive",
      first.pendingMessage!.pendingMessageId
    );
    expect(parked?.status).toBe("awaiting_user");

    await service.submit({
      forceQueue: true,
      clientRequestId: "cr-b04-q2",
      request: { message: "follower", conversationId: conv },
    });

    await service.notifyExternalTurnTerminal(conv, "cancelled");
    const settled = await runModel.getByRunId(parked!.runId);
    expect(settled?.status).toBe("cancelled");
    // Follower held (paused), never dispatched.
    expect(submitted.length).toBe(1);
    const views = await service.list(conv);
    expect(views.some((v) => v.status === "paused")).toBe(true);
  });

  it("promotion failure settles the envelope as failed with zero provider turns", async () => {
    const conv = "v2-b04-promote";
    const { service, submitted } = makeHarness(() => completedTerminal(conv));
    // Force the post-claim promotion to fail (B04 pre-turn failure).
    const promoteSpy = vi.spyOn(
      (service as unknown as { deps: { pendingModule: AIChatPendingMessageModule } }).deps
        .pendingModule,
      "promoteDispatchToUserMessage"
    );
    promoteSpy.mockRejectedValueOnce(new Error("boom"));

    const receipt = await service.submit({
      clientRequestId: "cr-b04-f1",
      request: { message: "will fail promote", conversationId: conv },
    });
    await vi.waitFor(async () => {
      const views = await service.list(conv);
      return expect(
        views.some((v) => v.status === "failed")
      ).toBe(true);
    });

    // Zero provider turns: admission preceded promotion, execution never ran.
    expect(submitted.length).toBe(0);
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const run = await runModel.findBySourceId(
      "interactive",
      receipt.pendingMessage!.pendingMessageId
    );
    expect(run?.status).toBe("failed");
    promoteSpy.mockRestore();
  });
});

/**
 * R03 (audit; FR-PER-005/006, FR-PLN-002, FR-REC-008, FR-LIF-004; design
 * §8.4/9.3/13.3): a queue-backed parked turn's resumed engine continuation
 * streams through the retained terminal gate, so the queue must settle the
 * parked envelope DURABLY and then release the gate's buffered terminal
 * exactly once (persistence before publication). A persistence failure must
 * publish nothing and retain the continuation for retry/recovery.
 *
 * The harness uses the actual queue + real bridge/run module/scheduler and a
 * fake engine whose submit path parks while RETAINING the given sink — the
 * same mechanics AIChatQueryEngine's pending permission/question maps use.
 */
describe("resumed parked turns keep terminal stream publication (R03)", () => {
  interface PublishedEvent {
    readonly event: AIChatQueryEvent;
    readonly publishStep: number;
  }

  interface ResumedParkHarness {
    readonly service: AIChatTurnQueueService;
    readonly published: PublishedEvent[];
    readonly persistGate: { failNext: number; commitStep: number };
    readonly sinkFlushes: { count: number };
    readonly engineState: { turnCount: number };
    /** Emits a non-terminal chunk through the resumed engine's retained sink. */
    readonly emitResumedChunk: () => void;
    /** Emits the resumed continuation's terminal through the retained sink. */
    readonly finishResumedWith: (
      type: "complete" | "cancelled" | "error"
    ) => void;
    /** Mirrors engine.stopConversation's parked-turn cancel emission. */
    readonly stopResumedContinuation: (conversationId?: string) => void;
  }

  function makeResumedParkHarness(
    conversationId: string
  ): ResumedParkHarness {
    const scheduler = new AIChatExecutionScheduler();
    const runModule = new AIChatRunModule();
    const bridge = new AIChatWorkspaceRunDispatchBridge(runModule, scheduler);
    const published: PublishedEvent[] = [];
    const sinkFlushes = { count: 0 };
    const persistGate: { failNext: number; commitStep: number } = {
      failNext: 0,
      commitStep: 0,
    };

    // One shared monotonic counter: the same clock stamps durable commits
    // and downstream publications, so a publish step strictly above the
    // commit step proves persistence-before-publication on this thread.
    const seq = { step: 0 };
    const recordSink = (): AIChatQueryEventSink => {
      return {
        emit: (event: AIChatQueryEvent): void => {
          seq.step += 1;
          published.push({ event, publishStep: seq.step });
        },
        flush: (): Promise<void> => {
          sinkFlushes.count += 1;
          return Promise.resolve();
        },
      };
    };

    const origTransition =
      runModule.transition.bind(runModule) as AIChatRunModule["transition"];
    vi.spyOn(runModule, "transition").mockImplementation(
      async (
        runId: Parameters<AIChatRunModule["transition"]>[0],
        next: Parameters<AIChatRunModule["transition"]>[1],
        patch: Parameters<AIChatRunModule["transition"]>[2]
      ) => {
        if (persistGate.failNext > 0) {
          persistGate.failNext -= 1;
          throw new Error("db unavailable");
        }
        const row = await origTransition(runId, next, patch);
        persistGate.commitStep = ++seq.step;
        return row;
      }
    );

    // The engine's parked turn state: the queue-gated sink is retained in the
    // pending map, exactly like AIChatQueryEngine's pendingPermissions /
    // pendingPlanQuestions entries (the resumed continuation reuses it).
    let retainedSink: AIChatQueryEventSink | null = null;
    const engineState = { turnCount: 0 };
    const engine: AIChatTurnQueueEngine = {
      getConversationRuntimeStatus: () => "idle",
      submitPersistedUserMessage: (async (input: {
        savedUser: { conversationId: string };
        eventSink: AIChatQueryEventSink;
      }) => {
        engineState.turnCount += 1;
        retainedSink = input.eventSink;
        return parkedTerminal("paused_for_permission", conversationId);
      }) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
      reserveSteering: (() => null) as never,
      cancelSteeringReservation: (() => undefined) as never,
      commitSteering: (() => true) as never,
      stopActiveTurn: ((activeConversationId?: string) => {
        const sink = retainedSink;
        retainedSink = null;
        if (sink) {
          sink.emit({
            type: "cancelled",
            conversationId: activeConversationId ?? conversationId,
            messageId: "a-parked",
            fullContent: "",
          });
        }
      }) as AIChatTurnQueueEngine["stopActiveTurn"],
    };

    const service = new AIChatTurnQueueService({
      engine,
      pendingModule: new AIChatPendingMessageModule(),
      eventSink: { emit: () => undefined },
      streamSinkFactory: () => recordSink(),
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => true,
      dispatchBridge: bridge,
      scheduler,
    });

    return {
      service,
      published,
      persistGate,
      sinkFlushes,
      engineState,
      emitResumedChunk: () => {
        if (!retainedSink) throw new Error("resumed turn not parked");
        retainedSink.emit({
          type: "token",
          conversationId,
          messageId: "a-parked",
          contentDelta: "resumed",
        });
      },
      finishResumedWith: (type: "complete" | "cancelled" | "error") => {
        if (!retainedSink) throw new Error("resumed turn not parked");
        const base = {
          conversationId,
          messageId: "a-parked",
        };
        if (type === "complete") {
          retainedSink.emit({ type: "complete", ...base, fullContent: "resumed output" });
          return;
        }
        if (type === "cancelled") {
          retainedSink.emit({ type: "cancelled", ...base, fullContent: "resumed partial" });
          return;
        }
        retainedSink.emit({ type: "error", ...base, errorMessage: "resumed boom" });
      },
      stopResumedContinuation: () => {
        engine.stopActiveTurn(conversationId);
      },
    };
  }

  async function submitParkedTurn(
    service: AIChatTurnQueueService,
    conversationId: string,
    clientRequestId: string,
    engineState: { turnCount: number }
  ): Promise<string> {
    const receipt = await service.submit({
      clientRequestId,
      request: { message: "needs permission", conversationId },
    });
    // The dispatch drain is async: wait for the engine call that parks.
    await vi.waitFor(() => expect(engineState.turnCount).toBe(1));
    return receipt.pendingMessage!.pendingMessageId;
  }

  it("resumed grant completion publishes complete exactly once after durable settlement", async () => {
    const conv = "v2-r03-ok";
    const h = makeResumedParkHarness(conv);
    const pendingId = await submitParkedTurn(h.service, conv, "cr-r03-ok", h.engineState);
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const parked = await runModel.findBySourceId("interactive", pendingId);
    expect(parked?.status).toBe("awaiting_permission");

    // Live resumed stream flows straight through the gate while parked.
    h.emitResumedChunk();
    expect(h.published.some((p) => p.event.type === "token")).toBe(true);

    // The resumed turn ended: its terminal arrives at the gate BEFORE the
    // queue settles, so it can only be published once settlement commits.
    h.finishResumedWith("complete");
    expect(h.published.some((p) => p.event.type === "complete")).toBe(false);

    await h.service.notifyExternalTurnTerminal(conv, "completed");

    const completes = h.published.filter((p) => p.event.type === "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0].publishStep).toBeGreaterThan(h.persistGate.commitStep);
    const settled = await runModel.getByRunId(parked!.runId);
    expect(settled?.status).toBe("completed");
    // Exactly one gate flush carried the buffered terminal downstream.
    expect(h.sinkFlushes.count).toBe(1);

    // A follow-up notification never re-publishes or re-flushes.
    await h.service.notifyExternalTurnTerminal(conv, "completed");
    expect(h.published.filter((p) => p.event.type === "complete")).toHaveLength(1);
    expect(h.sinkFlushes.count).toBe(1);
  });

  it("resumed failure publishes error exactly once after durable failed settlement", async () => {
    const conv = "v2-r03-err";
    const h = makeResumedParkHarness(conv);
    const pendingId = await submitParkedTurn(h.service, conv, "cr-r03-err", h.engineState);
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const parked = await runModel.findBySourceId("interactive", pendingId);

    h.finishResumedWith("error");
    await h.service.notifyExternalTurnTerminal(conv, "failed");

    const errors = h.published.filter((p) => p.event.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].publishStep).toBeGreaterThan(h.persistGate.commitStep);
    const settled = await runModel.getByRunId(parked!.runId);
    expect(settled?.status).toBe("failed");
    expect(h.sinkFlushes.count).toBe(1);
  });

  it("resumed cancellation publishes cancelled exactly once after durable cancelled settlement", async () => {
    const conv = "v2-r03-cancel";
    const h = makeResumedParkHarness(conv);
    const pendingId = await submitParkedTurn(h.service, conv, "cr-r03-cx", h.engineState);
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const parked = await runModel.findBySourceId("interactive", pendingId);

    h.finishResumedWith("cancelled");
    await h.service.notifyExternalTurnTerminal(conv, "cancelled");

    const cancelled = h.published.filter((p) => p.event.type === "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].publishStep).toBeGreaterThan(h.persistGate.commitStep);
    const settled = await runModel.getByRunId(parked!.runId);
    expect(settled?.status).toBe("cancelled");
    expect(h.sinkFlushes.count).toBe(1);
  });

  it("failed persistence holds publication until the recovery retry settles", async () => {
    const conv = "v2-r03-recover";
    const h = makeResumedParkHarness(conv);
    const pendingId = await submitParkedTurn(h.service, conv, "cr-r03-rec", h.engineState);
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const parked = await runModel.findBySourceId("interactive", pendingId);
    expect(h.persistGate.failNext).toBe(0);
    h.persistGate.failNext = 1;

    h.finishResumedWith("complete");
    await h.service.notifyExternalTurnTerminal(conv, "completed");

    // Nothing published before persistence recovers; retry info retained.
    expect(h.published.some((p) => p.event.type === "complete")).toBe(false);
    expect(h.sinkFlushes.count).toBe(0);
    const mid = await runModel.getByRunId(parked!.runId);
    expect(mid?.status).toBe("awaiting_permission");

    // Recovery: the continuation is retried, settles durably, then flushes.
    await h.service.notifyExternalTurnTerminal(conv, "completed");

    const completes = h.published.filter((p) => p.event.type === "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0].publishStep).toBeGreaterThan(h.persistGate.commitStep);
    const settled = await runModel.getByRunId(parked!.runId);
    expect(settled?.status).toBe("completed");
    expect(h.sinkFlushes.count).toBe(1);
  });

  it("clearing the conversation settles the parked turn cancelled and publishes its buffered cancelled once", async () => {
    const conv = "v2-r03-clear";
    const h = makeResumedParkHarness(conv);
    const pendingId = await submitParkedTurn(h.service, conv, "cr-r03-clr", h.engineState);
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const parked = await runModel.findBySourceId("interactive", pendingId);

    h.stopResumedContinuation(conv);
    await h.service.clearConversation(conv);

    const cancelled = h.published.filter((p) => p.event.type === "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].publishStep).toBeGreaterThan(h.persistGate.commitStep);
    const settled = await runModel.getByRunId(parked!.runId);
    expect(settled?.status).toBe("cancelled");
    expect(h.sinkFlushes.count).toBe(1);
  });
});

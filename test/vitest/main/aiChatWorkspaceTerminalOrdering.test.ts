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
  AIChatTerminalGate,
  type AIChatTurnQueueEngine,
} from "@/service/AIChatTurnQueueService";
import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import { AIChatWorkspaceRunDispatchBridge } from "@/service/AIChatWorkspaceRunDispatchBridge";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatTurnTerminalEvent,
} from "@/service/AIChatQueryEvents";
import { AIChatRunModel } from "@/model/AIChatRun.model";
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

function completedTerminal(conversationId: string): AIChatTurnTerminalEvent {
  return {
    type: "completed",
    conversationId,
    assistantMessageId: `assistant-${conversationId}`,
  } as AIChatTurnTerminalEvent;
}

/**
 * B05: durable terminal transition precedes terminal publication. The engine
 * emits its `complete` sink event DURING submit; the gate must hold it until
 * the run row commits. On DB failure nothing successful publishes and the
 * queue does not advance.
 */
describe("durable terminal precedes publication (B05)", () => {
  it("gate holds terminal sink events until flush", async () => {
    const seen: AIChatQueryEvent[] = [];
    const downstream: AIChatQueryEventSink = { emit: (e) => seen.push(e) };
    const gate = new AIChatTerminalGate(downstream);
    gate.emit({
      type: "token",
      conversationId: "c",
      messageId: "m",
      contentDelta: "hi",
    } as AIChatQueryEvent);
    gate.emit({
      type: "complete",
      conversationId: "c",
      messageId: "m",
      fullContent: "hi",
    } as AIChatQueryEvent);
    // Token streams immediately; complete is buffered.
    expect(seen.map((e) => e.type)).toEqual(["token"]);
    await gate.flush();
    expect(seen.map((e) => e.type)).toEqual(["token", "complete"]);
  });

  it("success path publishes complete only after the run row is terminal", async () => {
    const conv = "v2-b05-ok";
    const seen: AIChatQueryEvent[] = [];
    const scheduler = new AIChatExecutionScheduler();
    const bridge = new AIChatWorkspaceRunDispatchBridge(undefined, scheduler);
    const engine: AIChatTurnQueueEngine = {
      getConversationRuntimeStatus: () => "idle",
      submitPersistedUserMessage: (async (input: {
        eventSink: AIChatQueryEventSink;
        savedUser: { conversationId: string };
      }) => {
        // Engine emits terminal DURING the call (before returning).
        input.eventSink.emit({
          type: "complete",
          conversationId: conv,
          messageId: "m",
          fullContent: "done",
        } as AIChatQueryEvent);
        return completedTerminal(conv);
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
      streamSinkFactory: () => ({
        emit: (e: AIChatQueryEvent) => seen.push(e),
      }) as AIChatQueryEventSink,
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => true,
      dispatchBridge: bridge,
      scheduler,
    });

    const receipt = await service.submit({
      clientRequestId: "cr-b05-ok",
      request: { message: "hello", conversationId: conv },
    });
    await vi.waitFor(() =>
      expect(seen.map((e) => e.type)).toContain("complete")
    );
    // Terminal callbacks observe a persisted terminal row.
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const run = await runModel.findBySourceId(
      "interactive",
      receipt.pendingMessage!.pendingMessageId
    );
    expect(run?.status).toBe("completed");
  });

  it("DB failure publishes no terminal and drains nothing further", async () => {
    const conv = "v2-b05-fail";
    const seen: AIChatQueryEvent[] = [];
    const scheduler = new AIChatExecutionScheduler();
    const runModule = new AIChatRunModule();
    const bridge = new AIChatWorkspaceRunDispatchBridge(runModule, scheduler);
    // Inject terminal persistence failure AFTER admission+execution: the
    // strict terminal commit reports false (DB down at commit time).
    vi.spyOn(bridge, "finishRunStrict").mockResolvedValueOnce(false);
    const submitted: string[] = [];
    const engine: AIChatTurnQueueEngine = {
      getConversationRuntimeStatus: () => "idle",
      submitPersistedUserMessage: (async (input: {
        eventSink: AIChatQueryEventSink;
        savedUser: { conversationId: string };
      }) => {
        submitted.push(input.savedUser.conversationId);
        input.eventSink.emit({
          type: "complete",
          conversationId: conv,
          messageId: "m",
          fullContent: "done",
        } as AIChatQueryEvent);
        return completedTerminal(conv);
      }) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
      reserveSteering: (() => null) as never,
      cancelSteeringReservation: (() => undefined) as never,
      commitSteering: (() => true) as never,
      stopActiveTurn: (() => undefined) as never,
    };
    const pendingEvents: string[] = [];
    const service = new AIChatTurnQueueService({
      engine,
      pendingModule: new AIChatPendingMessageModule(),
      eventSink: {
        emit: (e) => pendingEvents.push(e.status),
      },
      streamSinkFactory: () => ({
        emit: (e: AIChatQueryEvent) => seen.push(e),
      }) as AIChatQueryEventSink,
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => true,
      dispatchBridge: bridge,
      scheduler,
    });

    await service.submit({
      clientRequestId: "cr-b05-f1",
      request: { message: "first", conversationId: conv },
    });
    // Queue a follower behind the failing turn.
    await service.submit({
      forceQueue: true,
      clientRequestId: "cr-b05-f2",
      request: { message: "follower", conversationId: conv },
    });

    await vi.waitFor(() => expect(pendingEvents).toContain("failed"));
    // No successful terminal publication …
    expect(seen.map((e) => e.type)).not.toContain("complete");
    // … and no silent next-run drain: only the first turn executed and the
    // follower never advances (stays queued). Note the failed row's user
    // delivery ('sent' at promote time) still stands — the failure signal
    // is the pending 'failed' event with RUN_TERMINAL_PERSIST_FAILED.
    expect(submitted).toHaveLength(1);
    const views = await service.list(conv);
    expect(
      views.some((v) => v.content === "follower" && v.status === "queued")
    ).toBe(true);
    vi.restoreAllMocks();
  });
});

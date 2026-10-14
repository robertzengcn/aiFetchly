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

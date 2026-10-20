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

/**
 * B06: queue-backed turns carry the REAL durable run id in event envelopes
 * and selection snapshots, with bounded background summaries (no
 * transcript/tool bodies). Background success/error/permission attention
 * updates A's sidebar only; B gets no private detail.
 */
describe("queue run identity + background summaries (B06)", () => {
  it("detail sink identity matches the durable envelope; summaries stay scoped to A", async () => {
    const convA = "v2-b06-a";
    const convB = "v2-b06-b";
    const scheduler = new AIChatExecutionScheduler();
    const bridge = new AIChatWorkspaceRunDispatchBridge(undefined, scheduler);
    const sinkIdentities: Array<{ runId: string; conversationId: string } | undefined> = [];
    const summaries: Array<{
      conversationId: string;
      runId: string | null;
      reason: string;
      sourceRunId?: string | null;
    }> = [];
    const engine: AIChatTurnQueueEngine = {
      getConversationRuntimeStatus: () => "idle",
      submitPersistedUserMessage: (async () => ({
        type: "completed",
        conversationId: convA,
        assistantMessageId: "a1",
      })) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
      reserveSteering: (() => null) as never,
      cancelSteeringReservation: (() => undefined) as never,
      commitSteering: (() => true) as never,
      stopActiveTurn: (() => undefined) as never,
    };
    const service = new AIChatTurnQueueService({
      engine,
      pendingModule: new AIChatPendingMessageModule(),
      eventSink: { emit: () => undefined },
      streamSinkFactory: (identity) => {
        sinkIdentities.push(identity);
        return { emit: () => undefined } as AIChatQueryEventSink;
      },
      summarySink: (input) => summaries.push({ ...input }),
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => true,
      dispatchBridge: bridge,
      scheduler,
    });

    const receipt = await service.submit({
      clientRequestId: "cr-b06-1",
      request: { message: "hello A", conversationId: convA },
    });
    await vi.waitFor(() =>
      expect(
        summaries.some((s) => s.reason === "run_completed")
      ).toBe(true)
    );

    // Durable envelope exists and the sink identity matches it exactly.
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const run = await runModel.findBySourceId(
      "interactive",
      receipt.pendingMessage!.pendingMessageId
    );
    expect(run).not.toBeNull();
    expect(sinkIdentities.length).toBeGreaterThan(0);
    expect(sinkIdentities[0]?.runId).toBe(run!.runId);
    expect(sinkIdentities[0]?.conversationId).toBe(convA);

    // Summaries are scoped to A with the real run id; B gets nothing.
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      expect(s.conversationId).toBe(convA);
      expect(s.runId).toBe(run!.runId);
    }
    // Bounded: reason-only + the accepted append identity (audit R03), no
    // transcript/tool bodies.
    for (const s of summaries) {
      expect(Object.keys(s).sort()).toEqual([
        "conversationId",
        "reason",
        "runId",
        "sourceRunId",
      ]);
      expect(String(s.sourceRunId)).toMatch(/^pending-/);
    }
    expect(summaries.map((s) => s.reason)).toContain("run_started");
    expect(summaries.map((s) => s.reason)).toContain("run_completed");
    void convB;
  });

  it("parked permission emits permission_required with the durable run id", async () => {
    const conv = "v2-b06-perm";
    const scheduler = new AIChatExecutionScheduler();
    const bridge = new AIChatWorkspaceRunDispatchBridge(undefined, scheduler);
    const summaries: Array<{ conversationId: string; runId: string | null; reason: string }> = [];
    const engine: AIChatTurnQueueEngine = {
      getConversationRuntimeStatus: () => "idle",
      submitPersistedUserMessage: (async (input: {
        savedUser: { conversationId: string };
      }) =>
        ({
          type: "paused_for_permission",
          conversationId: input.savedUser.conversationId,
          assistantMessageId: "a-parked",
        })) as AIChatTurnQueueEngine["submitPersistedUserMessage"],
      reserveSteering: (() => null) as never,
      cancelSteeringReservation: (() => undefined) as never,
      commitSteering: (() => true) as never,
      stopActiveTurn: (() => undefined) as never,
    };
    const service = new AIChatTurnQueueService({
      engine,
      pendingModule: new AIChatPendingMessageModule(),
      eventSink: { emit: () => undefined },
      streamSinkFactory: () => ({ emit: (_e: AIChatQueryEvent) => undefined }) as AIChatQueryEventSink,
      summarySink: (input) => summaries.push({ ...input }),
      tryAcquireLease: () => ({ release: () => undefined }) as never,
      isAiEnabled: () => true,
      isQueueEnabled: () => true,
      isSteeringEnabled: () => true,
      dispatchBridge: bridge,
      scheduler,
    });

    const receipt = await service.submit({
      clientRequestId: "cr-b06-p1",
      request: { message: "needs permission", conversationId: conv },
    });
    await vi.waitFor(() =>
      expect(
        summaries.some((s) => s.reason === "permission_required")
      ).toBe(true)
    );
    const runModel = new AIChatRunModel(resolveTestDbPath());
    const run = await runModel.findBySourceId(
      "interactive",
      receipt.pendingMessage!.pendingMessageId
    );
    const perm = summaries.find((s) => s.reason === "permission_required")!;
    expect(perm.conversationId).toBe(conv);
    expect(perm.runId).toBe(run!.runId);
    expect(run?.status).toBe("awaiting_permission");
  });
});

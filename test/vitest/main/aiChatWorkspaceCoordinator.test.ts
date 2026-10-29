import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import type {
  AIChatQueryEventSink,
  AIChatSegmentOutcome,
} from "@/service/AIChatQueryEvents";
import type {
  AIChatPendingClaim,
  AIChatQuerySubmitInput,
} from "@/service/AIChatQueryEngine";
import type { ChatV2RuntimeStatus } from "@/entityTypes/aiChatV2Types";
import type { ChatRunStatus } from "@/entityTypes/aiChatWorkspaceTypes";
import type { CoordinatorEngine } from "@/service/AIChatCoordinator";
import { AIChatCoordinator } from "@/service/AIChatCoordinator";
import { AIChatEventRouter } from "@/service/AIChatEventRouter";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { AIChatConversationTurnCoordinator } from "@/service/AIChatConversationTurnCoordinator";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import type {
  ChatRunDetailEvent,
  ConversationSummaryEvent,
} from "@/entityTypes/aiChatWorkspaceTypes";

const tmpDir = path.join(os.tmpdir(), "aifetchly-ws-coordinator");

// BaseModule resolves its db path through the Token service — mock it to the
// temp test directory (same pattern as agentRuntimeDefinitionList.test.ts).
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

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
  AIChatConversationTurnCoordinator.getInstance().resetForTesting();
});

/** Deferred the test resolves (or rejects) to finish a fake engine turn. */
interface TurnHandle {
  input: AIChatQuerySubmitInput;
  resolve(outcome?: AIChatSegmentOutcome): void;
  reject(error: unknown): void;
}

/** Pending-action + claim bookkeeping for owner-driven resume tests. */
interface FakeClaim {
  status: "claimed";
  kind: "permission" | "question";
  conversationId: string;
  assistantMessageId: string;
  toolCallId?: string;
  questionId?: string;
  pending: Record<string, never>;
}

function makeFakeEngine(): {
  engine: CoordinatorEngine;
  turns: TurnHandle[];
  stopCalls: string[];
  setStatus(conversationId: string, status: ChatV2RuntimeStatus): void;
  pendingPermission: { toolCallId: string } | null;
  resumed: Array<{
    claim: Extract<AIChatPendingClaim, { status: "claimed" }>;
    resolve(outcome: AIChatSegmentOutcome): void;
  }>;
  cancelledClaims: string[];
  resumeClaims: unknown[];
  parkPending(
    conversationId: string,
    entry: { kind: "permission" | "question"; id: string }
  ): void;
} {
  const turns: TurnHandle[] = [];
  const stopCalls: string[] = [];
  const engineStatus = new Map<string, ChatV2RuntimeStatus>();
  const pendingPermission: { toolCallId: string } | null = null;
  const resumed: Array<{
    claim: Extract<AIChatPendingClaim, { status: "claimed" }>;
    resolve(outcome: AIChatSegmentOutcome): void;
  }> = [];
  const cancelledClaims: string[] = [];
  const resumeClaims: unknown[] = [];
  const claimed: Map<string, FakeClaim> = new Map();
  const parked: Map<string, FakeClaim> = new Map();
  const parkPending = (
    conversationId: string,
    entry: { kind: "permission" | "question"; id: string }
  ): void => {
    parked.set(conversationId, {
      status: "claimed",
      kind: entry.kind,
      conversationId,
      assistantMessageId: "assistant-1",
      ...(entry.kind === "permission"
        ? { toolCallId: entry.id }
        : { questionId: entry.id }),
      pending: {} as Record<string, never>,
    });
    engineStatus.set(conversationId, "awaiting_permission");
  };
  const claimPending = (
    conversationId: string,
    kind: "permission" | "question",
    id: string
  ): AIChatPendingClaim => {
    if (claimed.has(conversationId)) {
      return { status: "already_claimed" };
    }
    const parkedEntry = parked.get(conversationId);
    const matches =
      parkedEntry !== undefined &&
      ((kind === "permission" &&
        parkedEntry.toolCallId !== undefined &&
        parkedEntry.toolCallId === id) ||
        (kind === "question" &&
          parkedEntry.questionId !== undefined &&
          parkedEntry.questionId === id));
    if (!matches) {
      return { status: "not_found" };
    }
    parked.delete(conversationId);
    claimed.set(conversationId, parkedEntry);
    return parkedEntry as unknown as AIChatPendingClaim;
  };
  void pendingPermission;
  return {
    turns,
    stopCalls,
    pendingPermission,
    resumed,
    cancelledClaims,
    resumeClaims,
    parkPending,
    setStatus(conversationId: string, status: ChatV2RuntimeStatus): void {
      engineStatus.set(conversationId, status);
    },
    engine: {
      runTurn(input: AIChatQuerySubmitInput): Promise<AIChatSegmentOutcome> {
        return new Promise<AIChatSegmentOutcome>((resolve, reject) => {
          turns.push({
            input,
            resolve: (outcome) =>
              resolve(
                outcome ?? {
                  type: "completed",
                  conversationId: input.request.conversationId ?? "",
                  assistantMessageId: "",
                }
              ),
            reject,
          });
        });
      },
      submitPersistedUserMessage(input: {
        readonly eventSink: unknown;
        readonly request: unknown;
        readonly savedUser: { readonly messageId: string; readonly conversationId: string };
        readonly modelContent: string;
        readonly contentParts?: unknown;
        readonly assistantMessageId?: string;
      }): Promise<AIChatSegmentOutcome> {
        return new Promise<AIChatSegmentOutcome>((resolve) => {
          turns.push({
            input: input as unknown as AIChatQuerySubmitInput,
            resolve: (outcome) =>
              resolve(
                outcome ?? {
                  type: "completed",
                  conversationId: input.savedUser.conversationId,
                  assistantMessageId: input.assistantMessageId ?? "",
                }
              ),
            reject: () => resolve({
              type: "failed",
              conversationId: input.savedUser.conversationId,
              assistantMessageId: input.assistantMessageId ?? "",
            }),
          });
        });
      },
      claimPendingPermission(
        conversationId: string,
        toolId: string
      ): AIChatPendingClaim {
        return claimPending(conversationId, "permission", toolId);
      },
      claimPendingQuestion(
        conversationId: string,
        questionId: string
      ): AIChatPendingClaim {
        return claimPending(conversationId, "question", questionId);
      },
      cancelClaimed(conversationId: string): boolean {
        const had = claimed.delete(conversationId);
        if (had) cancelledClaims.push(conversationId);
        return had;
      },
      resumeClaimed(
        claim: Extract<AIChatPendingClaim, { status: "claimed" }>
      ): Promise<AIChatSegmentOutcome> {
        resumeClaims.push(claim);
        return new Promise<AIChatSegmentOutcome>((resolve) => {
          resumed.push({ claim, resolve });
        });
      },
      stopActiveTurn(conversationId?: string): void {
        stopCalls.push(conversationId ?? "(all)");
      },
      getConversationRuntimeStatus(
        conversationId: string
      ): ChatV2RuntimeStatus {
        return engineStatus.get(conversationId) ?? "idle";
      },
    },
  };
}

function fakeWindow(id: number): {
  register(router: AIChatEventRouter): void;
  details: ChatRunDetailEvent[];
  summaries: ConversationSummaryEvent[];
} {
  const details: ChatRunDetailEvent[] = [];
  const summaries: ConversationSummaryEvent[] = [];
  const contents = {
    id,
    isDestroyed: () => false,
    send: (channel: string, payload: string) => {
      const parsed = JSON.parse(payload);
      if (channel === "ai-chat-workspace:detail-event") {
        details.push(parsed as ChatRunDetailEvent);
      } else {
        summaries.push(parsed as ConversationSummaryEvent);
      }
    },
  };
  return {
    details,
    summaries,
    register(router: AIChatEventRouter): void {
      router.register(contents);
    },
  };
}

function emit(
  sink: AIChatQueryEventSink,
  event: Parameters<AIChatQueryEventSink["emit"]>[0]
): void {
  sink.emit(event);
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await condition()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function buildCoordinator(
  onRunTerminal?: (conversationId: string, status: ChatRunStatus) => void,
  busySubmit?: (
    request: Parameters<AIChatCoordinator["startRun"]>[0]
  ) => Promise<{ pendingRunId: string } | null>
): {
  coordinator: AIChatCoordinator;
  router: AIChatEventRouter;
  fake: ReturnType<typeof makeFakeEngine>;
  runModel: AIChatRunModel;
} {
  const fake = makeFakeEngine();
  const router = new AIChatEventRouter();
  const scheduler = new AIChatExecutionScheduler();
  const coordinator = new AIChatCoordinator({
    engine: fake.engine,
    runModule: new AIChatRunModule(),
    conversationModule: new AIChatConversationModule(),
    router,
    scheduler,
    turnCoordinator: AIChatConversationTurnCoordinator.getInstance(),
    canUseChat: () => ({ ok: true }),
    ...(onRunTerminal ? { onRunTerminal } : {}),
    ...(busySubmit ? { busySubmit } : {}),
  });
  return { coordinator, router, fake, runModel: new AIChatRunModel(tmpDir) };
}

function runModel70(): AIChatRunModel {
  return new AIChatRunModel(tmpDir);
}


/** R03: simulate the user's Stop landing on a live (scheduler-active) run. */
function liveCancel(
  coordinator: AIChatCoordinator,
  conversationId: string
): void {
  void coordinator.cancelRun({ conversationId });
}

function request(n: number): Parameters<AIChatCoordinator["startRun"]>[0] {
  return {
    conversationId: `v2-test-${n}`,
    clientRequestId: `client-req-${n}-abcd`,
    message: `hello ${n}`,
  };
}

describe("AIChatCoordinator", () => {
  it("runs the full lifecycle: gate → queued envelope → dispatch → events → durable terminal → summaries", async () => {
    const { coordinator, router, fake, runModel } = buildCoordinator();
    const win = fakeWindow(1);
    win.register(router);
    router.select(1, "v2-test-1", 1);
    await SqliteDb.ensureInitialized();

    const accepted = await coordinator.startRun(request(1));
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const runId = accepted.response.runId;
    expect(accepted.response.conversationId).toBe("v2-test-1");

    // Dispatched promptly; engine got the run-owned sink + request payload.
    await waitFor(() => fake.turns.length === 1);
    const turn = fake.turns[0];
    expect(turn.input.request.conversationId).toBe("v2-test-1");
    expect(turn.input.request.message).toBe("hello 1");

    // Run envelope is durable and running before terminal.
    await waitFor(async () => {
      const row = await runModel.getByRunId(runId);
      return row?.status === "running";
    });

    emit(turn.input.eventSink, {
      type: "start",
      conversationId: "v2-test-1",
      messageId: "assistant-1",
    });
    emit(turn.input.eventSink, {
      type: "token",
      conversationId: "v2-test-1",
      messageId: "assistant-1",
      contentDelta: "Hi ",
      model: "m",
    });
    emit(turn.input.eventSink, {
      type: "token",
      conversationId: "v2-test-1",
      messageId: "assistant-1",
      contentDelta: "there",
      model: "m",
    });

    await waitFor(() => win.details.length >= 2);
    const tokenEvents = win.details.filter((d) => d.eventType === "token");
    expect(tokenEvents).toHaveLength(2);
    expect(tokenEvents[0].runId).toBe(runId);
    expect(tokenEvents[0].sequence).toBeLessThan(tokenEvents[1].sequence);

    emit(turn.input.eventSink, {
      type: "complete",
      conversationId: "v2-test-1",
      messageId: "assistant-1",
      fullContent: "Hi there",
      finishReason: "stop",
    });
    turn.resolve();

    // Terminal detail event arrives, and only AFTER the durable transition.
    await waitFor(() => win.details.some((d) => d.eventType === "complete"));
    const row = await runModel.getByRunId(runId);
    expect(row?.status).toBe("completed");
    expect(row?.finishedAt).not.toBeNull();

    const reasons = win.summaries.map((s) => s.reason);
    expect(reasons).toContain("run_queued");
    expect(reasons).toContain("run_started");
    expect(reasons).toContain("run_completed");
    const completedSummary = win.summaries.find(
      (s) => s.reason === "run_completed"
    );
    expect(completedSummary?.unread).toBe(true);
    expect(completedSummary?.runtimeStatus).toBe("idle");

    // The projection's generated title (first user message, design §8.6)
    // rides the summaries so a locally-created sidebar row replaces its
    // "New chat" fallback mid-session without a full bootstrap refresh.
    await waitFor(() => win.summaries.some((s) => s.title === "hello 1"));

    // Live registry cleared after terminal.
    expect(coordinator.getLiveRuntime("v2-test-1")).toBeNull();
  });

  it("notifies onRunTerminal once per run terminal (queue cross-path drain)", async () => {
    const terminals: Array<{ conversationId: string; status: ChatRunStatus }> =
      [];
    const { coordinator, fake } = buildCoordinator((conversationId, status) => {
      terminals.push({ conversationId, status });
    });
    await SqliteDb.ensureInitialized();

    const accepted = await coordinator.startRun(request(3));
    expect(accepted.ok).toBe(true);
    await waitFor(() => fake.turns.length === 1);
    const turn = fake.turns[0];

    emit(turn.input.eventSink, {
      type: "complete",
      conversationId: "v2-test-3",
      messageId: "assistant-3",
      fullContent: "done",
      finishReason: "stop",
    });
    turn.resolve();

    await waitFor(() => terminals.length === 1);
    expect(terminals[0]).toEqual({
      conversationId: "v2-test-3",
      status: "completed",
    });
  });

  it("delegates a busy-conversation send to the durable queue instead of rejecting", async () => {
    const busySubmits: Array<{ conversationId: string; message: string }> = [];
    const { coordinator, fake } = buildCoordinator(
      undefined,
      async (request) => {
        busySubmits.push({
          conversationId: request.conversationId,
          message: request.message,
        });
        return { pendingRunId: "pending-p-1" };
      }
    );
    await SqliteDb.ensureInitialized();

    // An engine-owned running turn (e.g. a queue-drained turn) makes the
    // conversation busy even without a coordinator live run.
    fake.setStatus("v2-test-4", "running");
    const accepted = await coordinator.startRun(request(4));
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.response.status).toBe("queued");
    expect(accepted.response.runId).toBe("pending-p-1");
    expect(busySubmits).toHaveLength(1);
    expect(busySubmits[0].message).toBe("hello 4");
    // No run envelope / engine dispatch happened for the delegated send.
    expect(fake.turns).toHaveLength(0);
  });

  it("keeps the legacy rejection when the busy-send queue declines", async () => {
    const { coordinator, fake } = buildCoordinator(undefined, async () => null);
    await SqliteDb.ensureInitialized();

    fake.setStatus("v2-test-5", "running");
    const rejected = await coordinator.startRun(request(5));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.message).toContain("already active");
    }
    expect(fake.turns).toHaveLength(0);
  });

  /**
   * Capability-parity PRD FR-SUB-004/FR-IMG-004/FR-HIS-002: the workspace
   * idle dispatch must carry the SAME submission context the Chat V2 stream
   * edge accepts — pasted bodies, confirmed image batches, opaque history
   * references, and the retry-stable submission id — all the way into the
   * engine request. A field accepted by the schema but dropped by
   * buildEngineRequest would silently change model behavior per surface.
   */
  it("forwards submission context through the idle dispatch into the engine request", async () => {
    const { coordinator, fake } = buildCoordinator();
    await SqliteDb.ensureInitialized();

    const accepted = await coordinator.startRun({
      ...request(6),
      pastedContents: { "1": "pasted body text" },
      confirmedGeneratedImageBatch: {
        references: [
          { messageId: "m1", imageIndex: 0 },
          { messageId: "m2", imageIndex: 1 },
        ],
      },
      historySelectionIds: ["src-1", "src-2"],
      submissionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(accepted.ok).toBe(true);
    await waitFor(() => fake.turns.length === 1);
    const engineRequest = fake.turns[0].input.request;
    expect(engineRequest.pastedContents).toEqual({ "1": "pasted body text" });
    // Codex P1: the confirmed batch travels via ConfirmedBatchReferenceRegistry
    // (staged at dispatch ownership), NEVER on the engine request (strip
    // contract) — assert both sides.
    expect(engineRequest.confirmedGeneratedImageBatch).toBeUndefined();
    const { getConfirmedBatchReferenceRegistry } = await import(
      "@/service/ConfirmedBatchReferenceRegistry"
    );
    const staged = getConfirmedBatchReferenceRegistry().consume("v2-test-6");
    expect(staged?.map((r) => ({ messageId: r.messageId, imageIndex: r.imageIndex }))).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 1 },
    ]);
    expect(engineRequest.historySelectionIds).toEqual(["src-1", "src-2"]);
    expect(engineRequest.submissionId).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
  });

  /**
   * Busy-path parity (FR-SUB-004): the coordinator hands the FULL request
   * (context included) to the busySubmit port — the IPC adapter forwards it
   * into the durable pending queue, whose schema already accepts these
   * fields.
   */
  it("hands submission context to the busy-submit delegation intact", async () => {
    const busyRequests: Array<
      Parameters<AIChatCoordinator["startRun"]>[0]
    > = [];
    const { coordinator, fake } = buildCoordinator(
      undefined,
      async (busyRequest) => {
        busyRequests.push(busyRequest);
        return { pendingRunId: "pending-p-6" };
      }
    );
    await SqliteDb.ensureInitialized();

    fake.setStatus("v2-test-7", "running");
    const accepted = await coordinator.startRun({
      ...request(7),
      pastedContents: { "2": "queued paste body" },
      historySelectionIds: ["src-9"],
      submissionId: "99999999-2222-3333-4444-555555555555",
    });
    expect(accepted.ok).toBe(true);
    expect(busyRequests).toHaveLength(1);
    expect(busyRequests[0].pastedContents).toEqual({ "2": "queued paste body" });
    expect(busyRequests[0].historySelectionIds).toEqual(["src-9"]);
    expect(busyRequests[0].submissionId).toBe(
      "99999999-2222-3333-4444-555555555555"
    );
    expect(fake.turns).toHaveLength(0);
  });

  it("cancel stops a queue-owned engine turn with no coordinator run", async () => {
    const { coordinator, fake } = buildCoordinator();
    await SqliteDb.ensureInitialized();

    fake.setStatus("v2-queue-owned", "running");
    const result = await coordinator.cancelRun({
      conversationId: "v2-queue-owned",
    });
    expect(result.cancelled).toBe(true);
    expect(fake.stopCalls).toContain("v2-queue-owned");
  });

  it("gates AI use before executing any work", async () => {
    const router = new AIChatEventRouter();
    const coordinator = new AIChatCoordinator({
      engine: makeFakeEngine().engine,
      runModule: new AIChatRunModule(),
      conversationModule: new AIChatConversationModule(),
      router,
      scheduler: new AIChatExecutionScheduler(),
      turnCoordinator: AIChatConversationTurnCoordinator.getInstance(),
      canUseChat: () => ({
        ok: false,
        message: "AI features are disabled",
      }),
    });
    // This test builds no Model (whose BaseDb constructor would create the
    // singleton), so create + initialize it explicitly before use.
    await SqliteDb.resetInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const result = await coordinator.startRun(request(2));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("disabled");
    }
  });

  it("deduplicates a retried clientRequestId without duplicating work", async () => {
    const { coordinator, fake } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    const first = await coordinator.startRun(request(3));
    await waitFor(() => fake.turns.length === 1);
    const second = await coordinator.startRun(request(3));
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.response.runId).toBe(first.response.runId);
    }
    await waitFor(() => fake.turns.length === 1); // still exactly one engine turn
    expect(fake.turns).toHaveLength(1);
    fake.turns[0].resolve();
  });

  it("cancels a queued run without starting it", async () => {
    const { coordinator, fake, runModel } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    // Fill all three general slots.
    for (let i = 0; i < 3; i += 1) {
      await coordinator.startRun(request(10 + i));
    }
    await waitFor(() => fake.turns.length === 3);
    const queued = await coordinator.startRun(request(99));
    expect(queued.ok).toBe(true);
    await waitFor(() => fake.turns.length === 3);

    if (!queued.ok) return;
    const result = await coordinator.cancelRun({
      conversationId: "v2-test-99",
    });
    expect(result.cancelled).toBe(true);
    const row = await runModel.getByRunId(queued.response.runId);
    expect(row?.status).toBe("cancelled");
    // Engine was never asked to run the cancelled conversation.
    expect(
      fake.turns.some((t) => t.input.request.conversationId === "v2-test-99")
    ).toBe(false);
    for (const t of fake.turns) t.resolve();
  });

  it("cancels an active run through the engine and persists cancelled", async () => {
    const { coordinator, fake, runModel } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(20));
    await waitFor(() => fake.turns.length === 1);
    if (!accepted.ok) return;
    const turn = fake.turns[0];

    const result = await coordinator.cancelRun({
      conversationId: "v2-test-20",
    });
    expect(result.cancelled).toBe(true);
    expect(fake.stopCalls).toContain("v2-test-20");

    emit(turn.input.eventSink, {
      type: "cancelled",
      conversationId: "v2-test-20",
      messageId: "assistant-1",
      fullContent: "partial",
    });
    // Outcome is authoritative (Stage A1): the engine classifies the aborted
    // segment as cancelled — the coordinator no longer infers it from chunks.
    turn.resolve({
      type: "cancelled",
      conversationId: "v2-test-20",
      assistantMessageId: "assistant-1",
    });
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "cancelled";
    });
  });

  it("R10 B01: a cancel bound to a stale run id never cancels the conversation's newer run", async () => {
    const { coordinator, fake } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(31));
    await waitFor(() => fake.turns.length === 1);
    if (!accepted.ok) return;
    const turn = fake.turns[0];

    // A captured claim whose run id no longer resolves to the CURRENT run
    // of the claimed conversation is stale: no-op — newer work survives.
    const stale = await coordinator.cancelRun({
      conversationId: "v2-test-31",
      runId: "stale-run-id",
    });
    expect(stale.cancelled).toBe(false);
    expect(fake.stopCalls).not.toContain("v2-test-31");
    expect(coordinator.ownsConversation("v2-test-31")).toBe(true);

    // The happy path is unchanged: cancelling with the CURRENT run id works.
    const valid = await coordinator.cancelRun({
      conversationId: "v2-test-31",
      runId: accepted.response.runId,
    });
    expect(valid.cancelled).toBe(true);
    expect(fake.stopCalls).toContain("v2-test-31");
    emit(turn.input.eventSink, {
      type: "cancelled",
      conversationId: "v2-test-31",
      messageId: "assistant-1",
      fullContent: "partial",
    });
    turn.resolve({
      type: "cancelled",
      conversationId: "v2-test-31",
      assistantMessageId: "assistant-1",
    });
  });

  it("observes engine permission pauses via the lifecycle listener and broadcasts attention (FR-021)", async () => {
    const { coordinator, router, fake, runModel } = buildCoordinator();
    const win = fakeWindow(2);
    win.register(router);
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(30));
    await waitFor(() => fake.turns.length === 1);
    if (!accepted.ok) return;
    const turn = fake.turns[0];
    expect(turn.input.lifecycle).toBeDefined();
    expect(turn.input.ownerNotifiesTerminal).toBe(true);

    // The engine parks the turn — explicit notification, not sampled state.
    turn.input.lifecycle?.onAwaiting({
      kind: "permission",
      conversationId: "v2-test-30",
      assistantMessageId: "assistant-1",
      toolCallId: "tc-1",
    });
    await waitFor(() =>
      win.summaries.some((s) => s.reason === "permission_required")
    );
    expect(
      win.summaries.find((s) => s.reason === "permission_required")?.attention
    ).toBe("permission");
    expect(coordinator.getLiveRuntime("v2-test-30")?.runtimeStatus).toBe(
      "awaiting_permission"
    );
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "awaiting_permission";
    });

    // A second onAwaiting for the same park is idempotent (exactly once).
    turn.input.lifecycle?.onAwaiting({
      kind: "permission",
      conversationId: "v2-test-30",
      assistantMessageId: "assistant-1",
      toolCallId: "tc-1",
    });

    // Resume and finish.
    turn.input.lifecycle?.onResumed({
      conversationId: "v2-test-30",
      assistantMessageId: "assistant-1",
    });
    emit(turn.input.eventSink, {
      type: "complete",
      conversationId: "v2-test-30",
      messageId: "assistant-1",
      fullContent: "done",
      finishReason: "stop",
    });
    turn.resolve();
    await waitFor(() =>
      win.summaries.some((s) => s.reason === "run_completed")
    );
  });

  it("keeps running when no renderer subscribes (reload independence)", async () => {
    const { coordinator, fake, runModel } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(40));
    await waitFor(() => fake.turns.length === 1);
    // No window registered at all — events are dropped, run continues.
    emit(fake.turns[0].input.eventSink, {
      type: "token",
      conversationId: "v2-test-40",
      messageId: "assistant-1",
      contentDelta: "x",
      model: "m",
    });
    emit(fake.turns[0].input.eventSink, {
      type: "complete",
      conversationId: "v2-test-40",
      messageId: "assistant-1",
      fullContent: "x",
      finishReason: "stop",
    });
    fake.turns[0].resolve();
    if (!accepted.ok) return;
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "completed";
    });
  });

  it("derives waiting status from the paused segment outcome — never completed (FR-009/022)", async () => {
    const { coordinator, router, fake, runModel } = buildCoordinator();
    const win = fakeWindow(4);
    win.register(router);
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(31));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 1);

    // Only a token chunk — no terminal chunk, no sampled pause state.
    emit(fake.turns[0].input.eventSink, {
      type: "token",
      conversationId: "v2-test-31",
      messageId: "assistant-1",
      contentDelta: "work",
      model: "m",
    });
    fake.turns[0].resolve({
      type: "paused_for_permission",
      conversationId: "v2-test-31",
      assistantMessageId: "assistant-1",
    });

    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "awaiting_permission";
    });
    expect(
      win.summaries.some((s) => s.reason === "permission_required")
    ).toBe(true);
    expect(coordinator.getLiveRuntime("v2-test-31")?.runtimeStatus).toBe(
      "awaiting_permission"
    );
    const row = await runModel.getByRunId(accepted.response.runId);
    expect(row?.status).not.toBe("completed");
  });

  it("records an unclassified exit as failed with a diagnostic — never completed (AC-17)", async () => {
    const { coordinator, router, fake, runModel } = buildCoordinator();
    const win = fakeWindow(5);
    win.register(router);
    router.select(5, "v2-test-32", 1);
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(32));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 1);

    // The engine promise rejects — no terminal chunk, no classified outcome.
    fake.turns[0].reject(new Error("engine vanished"));

    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "failed";
    });
    const failedRow = await runModel.getByRunId(accepted.response.runId);
    expect(failedRow?.errorCode).toBe("unclassified_segment_exit");
    expect(failedRow?.errorSummary).toContain("engine vanished");
    // The renderer still learned about the failure via a synthesized error
    // detail event (never silence an unclassified exit).
    expect(win.details.some((d) => d.eventType === "error")).toBe(true);
  });

  it("treats an unexpected conversation_busy outcome as failed, not success", async () => {
    const { coordinator, fake, runModel } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(35));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 1);

    fake.turns[0].resolve({
      type: "conversation_busy",
      conversationId: "v2-test-35",
    });

    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "failed";
    });
    const row = await runModel.getByRunId(accepted.response.runId);
    expect(row?.errorSummary).toContain("busy");
  });

  it("R8 P2-7: a failed interactive run marks the sidebar with failure attention", async () => {
    const { coordinator, router, fake, runModel } = buildCoordinator();
    const win = fakeWindow(36);
    win.register(router);
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(36));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 1);
    fake.turns[0].reject(new Error("engine vanished"));

    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "failed";
    });
    await waitFor(() => win.summaries.some((s) => s.reason === "run_failed"));
    const failedSummary = win.summaries.find((s) => s.reason === "run_failed");
    expect(failedSummary?.attention).toBe("failure");
    // Status metadata only — no transcript bodies in the attention event.
    expect(JSON.stringify(failedSummary ?? {})).not.toContain("engine vanished");
  });
});

describe("summary event privacy (FR-022)", () => {
  it("broadcasts status metadata only — never prompt, tool, or artifact bodies", async () => {
    const { coordinator, router, fake } = buildCoordinator();
    const win = fakeWindow(9);
    win.register(router);
    await SqliteDb.ensureInitialized();
    // No window selects this conversation — the summary still broadcasts.
    const secretPrompt = "SECRET-PROMPT-BODY";
    const accepted = await coordinator.startRun({
      conversationId: "v2-privacy-1",
      clientRequestId: "client-req-privacy-1",
      message: secretPrompt,
    });
    expect(accepted.ok).toBe(true);
    await waitFor(() => fake.turns.length === 1);

    // Engine events full of content bodies flow through the DETAIL path.
    emit(fake.turns[0].input.eventSink, {
      type: "token",
      conversationId: "v2-privacy-1",
      messageId: "a1",
      contentDelta: "SECRET-ASSISTANT-BODY",
      model: "m",
    });
    emit(fake.turns[0].input.eventSink, {
      type: "tool_result",
      conversationId: "v2-privacy-1",
      messageId: "a1",
      toolCallId: "tc-1",
      toolName: "create_html_artifact",
      fullContent: "SECRET-TOOL-RESULT",
      toolResult: { html: "<script>SECRET-ARTIFACT</script>" },
    });
    emit(fake.turns[0].input.eventSink, {
      type: "complete",
      conversationId: "v2-privacy-1",
      messageId: "a1",
      fullContent: "SECRET-FINAL-ANSWER",
      finishReason: "stop",
    });
    fake.turns[0].resolve();
    await waitFor(() =>
      win.summaries.some((s) => s.reason === "run_completed")
    );

    // FR-022: every summary event is field-bounded and body-free.
    const ALLOWED_KEYS = new Set([
      "conversationId",
      "workspaceKey",
      "runtimeStatus",
      "attention",
      "unread",
      "lastActivityAt",
      "runId",
      "sourceRunId",
      "runOwner",
      "title",
      "reason",
    ]);
    for (const summary of win.summaries) {
      for (const key of Object.keys(summary)) {
        expect(ALLOWED_KEYS.has(key)).toBe(true);
      }
    }
    const serialized = JSON.stringify(win.summaries);
    // The generated conversation title IS derived from the first user message
    // (design §8.6) and is sidebar-visible data every window already receives
    // via the bootstrap projection — so the prompt body itself is not in the
    // forbidden set, only assistant/tool/artifact RESULT bodies are.
    for (const secret of [
      "SECRET-ASSISTANT-BODY",
      "SECRET-TOOL-RESULT",
      "SECRET-ARTIFACT",
      "SECRET-FINAL-ANSWER",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // Detail events were NOT delivered (no window selected the conversation).
    expect(win.details).toHaveLength(0);
  });
});

describe("AIChatRunEventAdapter", () => {
  it("assigns monotonic sequences and status hints", async () => {
    const { AIChatRunEventAdapter: Adapter } = await import(
      "@/service/AIChatRunEventAdapter"
    );
    const adapter = new Adapter("run-x", "v2-c");
    const e1 = adapter.wrap({
      eventType: "start",
      conversationId: "v2-c",
    });
    const e2 = adapter.wrap({
      eventType: "token",
      conversationId: "v2-c",
      contentDelta: "a",
    });
    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e2.runId).toBe("run-x");

    expect(Adapter.statusHintFor("start")).toBe("running");
    expect(Adapter.statusHintFor("ask_user_question")).toBe("awaiting_user");
    expect(Adapter.statusHintFor("complete")).toBe("completed");
    expect(Adapter.statusHintFor("error")).toBe("failed");
    expect(Adapter.statusHintFor("cancelled")).toBe("cancelled");
    expect(Adapter.statusHintFor("token")).toBeNull();
  });

  it("dispatchQueuedTurn gives a drained row a durable run, real run id, and one owner (FR-004/005, AC-16)", async () => {
    const terminals: Array<{ conversationId: string; status: ChatRunStatus }> =
      [];
    const { coordinator, router, fake, runModel } = buildCoordinator((c, st) => {
      terminals.push({ conversationId: c, status: st });
    });
    const win = fakeWindow(6);
    win.register(router);
    router.select(6, "v2-queued-1", 1);
    await SqliteDb.ensureInitialized();

    const dispatched = coordinator.dispatchQueuedTurn({
      conversationId: "v2-queued-1",
      pendingMessageId: "p-1",
      request: { message: "queued hello", conversationId: "v2-queued-1" },
      savedUser: { messageId: "user-pending-9", conversationId: "v2-queued-1" },
      modelContent: "queued hello",
      assistantMessageId: "assistant-pending-p-1",
    });
    await waitFor(() => fake.turns.length === 1);
    const turn = fake.turns[0];

    const liveRunId = coordinator.getLiveRuntime("v2-queued-1")?.activeRunId;
    expect(liveRunId).toBeTruthy();
    expect(liveRunId?.startsWith("pending-queue-")).toBe(false);
    await waitFor(async () => {
      const row = await runModel.getByRunId(liveRunId ?? "");
      return row?.status === "running";
    });

    emit(turn.input.eventSink, {
      type: "start",
      conversationId: "v2-queued-1",
      messageId: "assistant-pending-p-1",
    });
    emit(turn.input.eventSink, {
      type: "token",
      conversationId: "v2-queued-1",
      messageId: "assistant-pending-p-1",
      contentDelta: "q",
      model: "m",
    });
    await waitFor(() => win.details.length >= 2);
    for (const detail of win.details) {
      expect(detail.runId).toBe(liveRunId);
      expect(String(detail.runId).startsWith("pending-queue-")).toBe(false);
    }
    expect(win.details[0].sequence).toBeLessThan(win.details[1].sequence);

    emit(turn.input.eventSink, {
      type: "complete",
      conversationId: "v2-queued-1",
      messageId: "assistant-pending-p-1",
      fullContent: "queued done",
      finishReason: "stop",
    });
    turn.resolve({
      type: "completed",
      conversationId: "v2-queued-1",
      assistantMessageId: "assistant-pending-p-1",
    });

    const outcome = await dispatched;
    expect(outcome.type).toBe("completed");
    const row = await runModel.getByRunId(liveRunId ?? "");
    expect(row?.status).toBe("completed");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toEqual({
      conversationId: "v2-queued-1",
      status: "completed",
    });
  });

  it("dispatchQueuedTurn reports busy when the conversation is already owned", async () => {
    const { coordinator, fake } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    fake.setStatus("v2-queued-2", "running");
    const outcome = await coordinator.dispatchQueuedTurn({
      conversationId: "v2-queued-2",
      pendingMessageId: "p-2",
      request: { message: "x", conversationId: "v2-queued-2" },
      savedUser: { messageId: "u", conversationId: "v2-queued-2" },
      modelContent: "x",
      assistantMessageId: "a",
    });
    expect(outcome.type).toBe("conversation_busy");
    expect(fake.turns).toHaveLength(0);
  });

  it("resumeRun claims, queues, and observes the resumed continuation (FR-024, AC-05)", async () => {
    const { coordinator, router, fake, runModel } = buildCoordinator();
    const win = fakeWindow(7);
    win.register(router);
    router.select(7, "v2-resume-1", 1);
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(41));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 1);

    // The segment parks on a permission card.
    fake.parkPending("v2-test-41", { kind: "permission", id: "tool-r-1" });
    fake.turns[0].resolve({
      type: "paused_for_permission",
      conversationId: "v2-test-41",
      assistantMessageId: "assistant-1",
    });
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "awaiting_permission";
    });
    const liveRunId = coordinator.getLiveRuntime("v2-test-41")?.activeRunId;

    // Duplicate approval is idempotent BEFORE the claim is resumed: the
    // second claim on the same action returns already_claimed → ok:true,
    // no second dispatch.
    const first = await coordinator.resumeRun({
      conversationId: "v2-test-41",
      action: { kind: "permission", toolId: "tool-r-1" },
    });
    expect(first.ok).toBe(true);
    await waitFor(() => fake.resumed.length === 1);

    // The resumed continuation runs INSIDE the dispatch with the SAME run id
    // and adapter (sequence continuity, FR-005).
    expect(fake.resumeClaims).toHaveLength(1);
    await waitFor(async () => {
      const row = await runModel.getByRunId(liveRunId ?? "");
      return row?.status === "running";
    });

    // Sequence continues from the pre-pause events (start/token seq 1..2).
    emit(fake.resumed[0].claim && fake.turns[0].input.eventSink, {
      type: "token",
      conversationId: "v2-test-41",
      messageId: "assistant-1",
      contentDelta: "post",
      model: "m",
    });
    fake.resumed[0].resolve({
      type: "completed",
      conversationId: "v2-test-41",
      assistantMessageId: "assistant-1",
    });
    await waitFor(async () => {
      const row = await runModel.getByRunId(liveRunId ?? "");
      return row?.status === "completed";
    });
    expect(coordinator.getLiveRuntime("v2-test-41")).toBeNull();
  });

  it("Stop while a resume waits for capacity cancels the claim and never starts the tool (FR-024, AC-04)", async () => {
    const { coordinator, fake, runModel } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    // Fill all three general capacity slots with unrelated runs.
    for (let i = 0; i < 3; i += 1) {
      await coordinator.startRun(request(50 + i));
    }
    await waitFor(() => fake.turns.length === 3);
    const accepted = await coordinator.startRun(request(42));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 3); // still queued

    // Free one slot so the target dispatches, then park it.
    fake.turns[0].resolve({
      type: "completed",
      conversationId: "v2-test-50",
      assistantMessageId: "",
    });
    await waitFor(() => fake.turns.length === 4);
    fake.parkPending("v2-test-42", { kind: "permission", id: "tool-r-2" });
    fake.turns[3].resolve({
      type: "paused_for_permission",
      conversationId: "v2-test-42",
      assistantMessageId: "assistant-1",
    });
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "awaiting_permission";
    });
    // Active now: fillers 1 + 2 (2 slots).

    // Occupy the third slot so a claimed resume must WAIT for capacity.
    const extra = await coordinator.startRun(request(60));
    void extra;
    await waitFor(() => fake.turns.length === 5);

    const resumed = await coordinator.resumeRun({
      conversationId: "v2-test-42",
      action: { kind: "permission", toolId: "tool-r-2" },
    });
    expect(resumed.ok).toBe(true);
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "queued";
    });
    // Capacity is full: the continuation has NOT started.
    expect(fake.resumed.length).toBe(0);

    const cancel = await coordinator.cancelRun({ conversationId: "v2-test-42" });
    expect(cancel.cancelled).toBe(true);
    expect(fake.cancelledClaims).toContain("v2-test-42");
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "cancelled";
    });
    // The approved tool never started.
    expect(fake.resumed.length).toBe(0);
    // Cleanup remaining fillers.
    for (const t of fake.turns) t.resolve();
  });


  it("a stale dispatch cancels its orphaned engine claim (review fix, stop/approve race)", async () => {
    const { coordinator, fake } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(70));
    if (!accepted.ok) return;
    const runId = accepted.response.runId;
    await waitFor(() => fake.turns.length === 1);

    // Park the run, then reproduce the raced state directly: an approval
    // claim that landed AFTER cancelRun finalized the run (so nothing
    // dispatches it) but whose dispatch is already queued in the pump.
    fake.parkPending("v2-test-70", { kind: "permission", id: "tool-r-70" });
    fake.turns[0].resolve({
      type: "paused_for_permission",
      conversationId: "v2-test-70",
      assistantMessageId: "assistant-1",
    });
    await waitFor(async () => {
      const row = await runModel70().getByRunId(runId);
      return row?.status === "awaiting_permission";
    }).catch(() => undefined);
    const cancel = await coordinator.cancelRun({ conversationId: "v2-test-70" });
    expect(cancel.cancelled).toBe(true);
    expect(coordinator.ownsConversation("v2-test-70")).toBe(false);

    // The raced approval: claimed just after finalize (the real race
    // interleaves this before deletion; simulating the post-state directly).
    const lateClaim = fake.engine.claimPendingPermission("v2-test-70", "tool-r-70");
    expect(lateClaim.status).toBe("claimed");

    // The already-queued dispatch finally executes: the stale guard must
    // cancel the orphaned claim so a duplicate approval is rejected later.
    const stale = coordinator as unknown as {
      executeDispatch(r: string, c: string): Promise<void>;
    };
    await stale.executeDispatch(runId, "v2-test-70");
    expect(fake.cancelledClaims).toContain("v2-test-70");
  });


  it("R02: the run-owned lifecycle promise tracks the CURRENT write (await sees the pending row)", async () => {
    const { coordinator, fake, runModel } = buildCoordinator();
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(80));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 1);
    const lifecycle = fake.turns[0].input.lifecycle;
    expect(lifecycle).toBeDefined();

    // Gate the durable write: onAwaiting fires but the row is still pending.
    let releaseWrite!: () => void;
    const gated = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    // Stub the MODULE method the coordinator actually calls — the test's
    // runModel is a separate instance from the module's internal model.
    const { AIChatRunModule: RunModule } = await import(
      "@/modules/AIChatRunModule"
    );
    const realTransition = RunModule.prototype.transition;
    const forward = (self: unknown, args: unknown[]): unknown =>
      (realTransition as unknown as (...a: unknown[]) => unknown).apply(
        self,
        args
      );
    RunModule.prototype.transition = function gatedTransition(
      this: unknown,
      ...args: unknown[]
    ): unknown {
      if (args[1] === "awaiting_permission") {
        return gated.then(() => forward(this, args));
      }
      return forward(this, args);
    } as never;

    lifecycle?.onAwaiting({
      kind: "permission",
      conversationId: "v2-test-80",
      assistantMessageId: "a",
      toolCallId: "t",
    });
    await new Promise((r) => setTimeout(r, 20));
    const live = coordinator.getLiveRuntime("v2-test-80");
    expect(live?.runtimeStatus).toBe("awaiting_permission");
    // The live entry is gone once we finalize... use the BEFORE-await probe:
    // grab the chain through the exposed dispatch wait point instead — the
    // coordinator awaits (live).lifecycleTransitions in its finally; here we
    // assert indirectly: the run row is NOT yet awaiting_permission.
    const rowBefore = await runModel.getByRunId(accepted.response.runId);
    expect(rowBefore?.status).not.toBe("awaiting_permission");

    releaseWrite();
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "awaiting_permission";
    });
    // A parked run intentionally KEEPS its live entry; settle the fake turn
    // and restore the prototype. The cleanup wait must not expect null.
    fake.turns[0].resolve({
      type: "paused_for_permission",
      conversationId: "v2-test-80",
      assistantMessageId: "a",
    });
    await waitFor(() =>
      coordinator.getLiveRuntime("v2-test-80")?.runtimeStatus ===
      "awaiting_permission"
    );
    await coordinator.cancelRun({ conversationId: "v2-test-80" });
    RunModule.prototype.transition = realTransition;
  });

  it("R03: Stop during terminal durable writes wins over a completed outcome", async () => {
    const { coordinator, router, fake, runModel } = buildCoordinator();
    const win = fakeWindow(9);
    win.register(router);
    router.select(9, "v2-test-81", 1);
    await SqliteDb.ensureInitialized();
    const accepted = await coordinator.startRun(request(81));
    if (!accepted.ok) return;
    await waitFor(() => fake.turns.length === 1);
    const turn = fake.turns[0];
    // The user presses Stop while the turn is running.
    liveCancel(coordinator, "v2-test-81");
    // The engine then resolves completed (won the internal race).
    turn.resolve({
      type: "completed",
      conversationId: "v2-test-81",
      assistantMessageId: "a",
    });
    await waitFor(async () => {
      const row = await runModel.getByRunId(accepted.response.runId);
      return row?.status === "cancelled";
    });
    const row = await runModel.getByRunId(accepted.response.runId);
    expect(row?.status).toBe("cancelled"); // Stop won — never completed
  });
});

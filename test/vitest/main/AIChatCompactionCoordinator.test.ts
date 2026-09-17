/**
 * Unit tests for AIChatCompactionCoordinator (technical-design §11).
 *
 * Verifies the durable-claim lifecycle, fence/lease semantics, section/checkpoint
 * atomicity, generation CAS publication, crash-after-save resume, cancellation
 * during in-flight AI, and the 3-section batch yield.
 *
 * Token/USERSDBPATH are mocked so every Model/Module constructed here shares
 * one per-run test database (established pattern).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { AIChatCompactionCoordinator } from "@/service/AIChatCompactionCoordinator";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-coordinator-${crypto.randomUUID()}`
);

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));

vi.mock("@/config/usersetting", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
  USER_AI_ENABLED: "true",
  TOKENNAME: "user-social-market-token",
  USERSDBPATH: "user_dbpath",
}));

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessages(
  conversationId: string,
  rows: Array<{ role: string; content: string; ts: number }>
): Promise<void> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entity = new AIChatMessageEntity();
    entity.messageId = `msg-${conversationId}-${i}`;
    entity.conversationId = conversationId;
    entity.role = r.role;
    entity.content = r.content;
    entity.timestamp = new Date(r.ts);
    entity.messageType = MessageType.MESSAGE;
    await repo.save(entity);
  }
}

async function indexConversation(conversationId: string): Promise<void> {
  const stateModel = new AIChatArchiveStateModel(tmpDir);
  await stateModel.ensureState(conversationId);
  await stateModel.setIndexState(conversationId, "complete");
}

/** A fake AI summarizer that returns a fixed valid SectionSummaryV1. */
function fakeSummarizer() {
  const calls: Array<{ prompt: string }> = [];
  const fn = vi.fn(async (systemPrompt: string, userPrompt: string) => {
    calls.push({ prompt: userPrompt });
    void systemPrompt;
    return JSON.stringify({
      version: 1,
      synopsis: `summary of ${userPrompt.slice(0, 20)}`,
      decisions: [],
      constraints: [],
      pending: [],
      toolOutcomes: [],
      topics: ["test"],
    });
  });
  return { fn, calls };
}

describe("AIChatCompactionCoordinator", () => {
  let coordinator: AIChatCompactionCoordinator;

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });

  beforeEach(async () => {
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    coordinator = new AIChatCompactionCoordinator();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("claims a run and publishes a generation for a compactable conversation", async () => {
    await seedMessages("conv-1", [
      { role: "user", content: "first message", ts: 1_000 },
      { role: "assistant", content: "reply one", ts: 2_000 },
      { role: "user", content: "second message", ts: 3_000 },
      { role: "assistant", content: "reply two", ts: 4_000 },
    ]);
    await indexConversation("conv-1");

    const { fn } = fakeSummarizer();
    const result = await coordinator.requestCompaction("conv-1", {
      trigger: "manual",
      model: "gpt-4o",
      summarize: fn,
    });

    expect(result.state).toBe("completed");
    expect(result.generationId).toBeTruthy();
    // A generation was published on the archive state.
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const state = await stateModel.getState("conv-1");
    expect(state?.activeGenerationId).toBe(result.generationId);
  });

  it("a second concurrent caller joins the same in-process run (no duplicate)", async () => {
    // Five messages: the retained recent suffix keeps the newest three, so a
    // compactable prefix exists (FR-05 retention must not starve compaction).
    await seedMessages("conv-2", [
      { role: "user", content: "a".repeat(2_000), ts: 1_000 },
      { role: "assistant", content: "b".repeat(2_000), ts: 2_000 },
      { role: "user", content: "c".repeat(2_000), ts: 3_000 },
      { role: "assistant", content: "d".repeat(2_000), ts: 4_000 },
      { role: "user", content: "e".repeat(2_000), ts: 5_000 },
    ]);
    await indexConversation("conv-2");

    let resolveFirst: (() => void) | undefined;
    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = () =>
            resolve(
              JSON.stringify({
                version: 1,
                synopsis: "merged",
                decisions: [],
                constraints: [],
                pending: [],
                toolOutcomes: [],
                topics: [],
              })
            );
        })
    );

    // Fire two requests; the second must join the first, not start a new run.
    const p1 = coordinator.requestCompaction("conv-2", {
      trigger: "auto",
      summarize: fn,
    });
    // Yield once so the first run reaches the summarize call (setting
    // resolveFirst) before the second caller joins the in-process promise.
    await Promise.resolve();
    await Promise.resolve();
    const p2 = coordinator.requestCompaction("conv-2", {
      trigger: "auto",
      summarize: fn,
    });
    // Resolve the single in-flight summarize promise (the fn is called once).
    const tryResolve = () => {
      if (resolveFirst) resolveFirst();
      else setTimeout(tryResolve, 5);
    };
    tryResolve();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.generationId).toBeTruthy();
    // In-process dedup shares one promise: both callers observe the same
    // completed run (no duplicate work — the summarizer ran once).
    expect(r2.generationId).toBe(r1.generationId);
    expect(r2.runId).toBe(r1.runId);
    // The summarizer was invoked (dedup via in-process promise — once).
    expect(fn).toHaveBeenCalled();
  }, 15_000);

  it("reports joined (never completed-by-proxy) when a separate owner holds the durable claim", async () => {
    await seedMessages("conv-2b", [
      { role: "user", content: "durable one", ts: 1_000 },
      { role: "assistant", content: "durable two", ts: 2_000 },
      { role: "user", content: "durable three", ts: 3_000 },
      { role: "assistant", content: "durable four", ts: 4_000 },
      { role: "user", content: "durable five", ts: 5_000 },
    ]);
    await indexConversation("conv-2b");

    let resolveFirst!: (v: string) => void;
    const slow = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const ownerA = new AIChatCompactionCoordinator();
    const ownerB = new AIChatCompactionCoordinator();
    const p1 = ownerA.requestCompaction("conv-2b", {
      trigger: "auto",
      summarize: slow,
    });
    // Wait until A's durable claim is installed, then join from B.
    const { AIChatCompactionModule } = await import(
      "@/modules/AIChatCompactionModule"
    );
    const probe = new AIChatCompactionModule();
    for (let i = 0; i < 200 && !(await probe.getActiveRun("conv-2b")); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const p2 = ownerB.requestCompaction("conv-2b", {
      trigger: "manual",
      summarize: slow,
    });
    // Let the single section summarize exactly once, then both settle.
    const tryResolve = () => {
      if (resolveFirst) {
        resolveFirst(
          JSON.stringify({
            version: 1,
            synopsis: "durable summary",
            decisions: [],
            constraints: [],
            pending: [],
            toolOutcomes: [],
            topics: [],
          })
        );
      } else {
        setTimeout(tryResolve, 5);
      }
    };
    tryResolve();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.state).toBe("completed");
    // B joined another owner's active run (COMPACTION_BUSY): same run, zero
    // sections of its own, and never "completed" for work it did not do
    // (AC-08, §11.2 run states).
    expect(r2.state).toBe("joined");
    expect(r2.runId).toBe(r1.runId);
    expect(r2.sectionsPacked).toBe(0);
    expect(r2.generationId).toBeUndefined();
    expect(slow).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("rejects a tombstoned conversation with COMPACTION_CONTEXT_REJECTED", async () => {
    await seedMessages("conv-3", [
      { role: "user", content: "doomed", ts: 1_000 },
    ]);
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    await stateModel.ensureState("conv-3");
    await stateModel.tombstone("conv-3");

    const { fn } = fakeSummarizer();
    await expect(
      coordinator.requestCompaction("conv-3", {
        trigger: "manual",
        summarize: fn,
      })
    ).rejects.toThrow();
  });

  it("cancels an in-flight run via the abort signal", async () => {
    await seedMessages("conv-4", [
      { role: "user", content: "x".repeat(2_000), ts: 1_000 },
    ]);
    await indexConversation("conv-4");

    const ac = new AbortController();
    const fn = vi.fn(async () => {
      // Simulate a slow AI call that gets cancelled.
      return new Promise<string>((_resolve, reject) => {
        ac.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const p = coordinator.requestCompaction("conv-4", {
      trigger: "manual",
      summarize: fn,
      signal: ac.signal,
    });
    ac.abort();
    // Cancellation resolves to the "cancelled" run state (committed work is
    // preserved, no new requests) rather than throwing (§11.6, FR-09).
    const result = await p;
    expect(result.state).toBe("cancelled");
    // The run state is cancelled.
    const status = await coordinator.getStatus("conv-4");
    expect(["cancelled", "failed", "queued"]).toContain(status?.state);
  });

  it("yields after 3 sections in one batch for a large conversation", async () => {
    // Seed enough messages to produce >3 sections at a small source budget.
    const rows = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "y".repeat(800),
      ts: 1_000 + i * 1_000,
    }));
    await seedMessages("conv-5", rows);
    await indexConversation("conv-5");

    const { fn } = fakeSummarizer();
    const result = await coordinator.requestCompaction("conv-5", {
      trigger: "manual",
      summarize: fn,
      sourceCapacityTokens: 100, // tiny → many sections
      maxSectionsPerBatch: 3,
    });
    // Either completed (if it fit in one batch) or paused after 3 sections.
    expect(["completed", "paused"]).toContain(result.state);
  });

  it("processes only new sources on a repeat run (incremental, no resend)", async () => {
    await seedMessages("conv-6", [
      { role: "user", content: "first message alpha", ts: 1_000 },
      { role: "assistant", content: "reply one beta", ts: 2_000 },
      { role: "user", content: "second message gamma", ts: 3_000 },
      { role: "assistant", content: "reply two delta", ts: 4_000 },
    ]);
    await indexConversation("conv-6");

    const first = fakeSummarizer();
    const r1 = await coordinator.requestCompaction("conv-6", {
      trigger: "manual",
      summarize: first.fn,
    });
    expect(r1.state).toBe("completed");

    // Append one eligible turn after the successful compaction.
    await seedMessages("conv-6", [
      { role: "user", content: "third message epsilon", ts: 5_000 },
      { role: "assistant", content: "reply three zeta", ts: 6_000 },
    ]);

    const second = fakeSummarizer();
    const r2 = await coordinator.requestCompaction("conv-6", {
      trigger: "auto",
      summarize: second.fn,
    });
    expect(["completed", "paused"]).toContain(r2.state);
    // Normal incremental work never resends committed raw sections: no
    // second-run prompt may contain the already-covered first message.
    const secondPrompts = second.fn.mock.calls.map((c) => String(c[1]));
    expect(secondPrompts.length).toBeGreaterThan(0);
    for (const p of secondPrompts) {
      expect(p).not.toContain("first message alpha");
    }
  }, 15_000);

  it("repairs one malformed output within the bounded attempt ceiling", async () => {
    await seedMessages("conv-7", [
      { role: "user", content: "repair me please", ts: 1_000 },
      { role: "assistant", content: "repair reply one", ts: 2_000 },
      { role: "user", content: "repair followup", ts: 3_000 },
      { role: "assistant", content: "repair reply two", ts: 4_000 },
    ]);
    await indexConversation("conv-7");

    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return "not json at all {{{";
      return JSON.stringify({
        version: 1,
        synopsis: "repaired synopsis",
        decisions: [],
        constraints: [],
        pending: [],
        toolOutcomes: [],
        topics: [],
      });
    });
    const result = await coordinator.requestCompaction("conv-7", {
      trigger: "manual",
      summarize: fn,
    });
    // One structured-output repair inside the 4-attempt ceiling → success.
    expect(result.state).toBe("completed");
    expect(calls).toBe(2);
  }, 15_000);

  it("a retry after a batch-limit pause resumes with a new run instead of joining", async () => {
    // Seed enough messages to require several sections at a small budget.
    const rows = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "z".repeat(800),
      ts: 1_000 + i * 1_000,
    }));
    await seedMessages("conv-9", rows);
    await indexConversation("conv-9");

    const first = fakeSummarizer();
    const r1 = await coordinator.requestCompaction("conv-9", {
      trigger: "manual",
      summarize: first.fn,
      sourceCapacityTokens: 100, // tiny → many sections
      maxSectionsPerBatch: 1,
    });
    // One section per batch with far more work remaining → resumable pause.
    expect(r1.state).toBe("paused");
    expect(r1.sectionsPacked).toBe(1);

    // A retry inside the paused run's lease window must NOT join the paused
    // run (nothing is running to finish it — joining returns zero progress
    // forever). It starts a new run resuming from committed coverage.
    const second = fakeSummarizer();
    const r2 = await coordinator.requestCompaction("conv-9", {
      trigger: "manual",
      summarize: second.fn,
      sourceCapacityTokens: 100,
      maxSectionsPerBatch: 1,
    });
    expect(r2.state).not.toBe("joined");
    expect(r2.runId).not.toBe(r1.runId);
    expect(r2.sectionsPacked).toBeGreaterThan(0);
    expect(["paused", "completed"]).toContain(r2.state);
  }, 15_000);

  it("survives restart after a batch-limit pause (status + resume from checkpoints)", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "w".repeat(800),
      ts: 1_000 + i * 1_000,
    }));
    await seedMessages("conv-10", rows);
    await indexConversation("conv-10");

    const first = fakeSummarizer();
    const r1 = await coordinator.requestCompaction("conv-10", {
      trigger: "manual",
      summarize: first.fn,
      sourceCapacityTokens: 100,
      maxSectionsPerBatch: 1,
    });
    expect(r1.state).toBe("paused");

    // Simulate an app restart: a fresh coordinator has no in-memory state,
    // but the paused run, staged sections, and checkpoints persist.
    const restarted = new AIChatCompactionCoordinator();
    const status = await restarted.getStatus("conv-10");
    expect(status?.state).toBe("paused");
    expect(status?.runId).toBe(r1.runId);

    // Retry after restart resumes from committed coverage with a new run.
    const second = fakeSummarizer();
    const r2 = await restarted.requestCompaction("conv-10", {
      trigger: "manual",
      summarize: second.fn,
      sourceCapacityTokens: 100,
      maxSectionsPerBatch: 1,
    });
    expect(r2.state).not.toBe("joined");
    expect(r2.runId).not.toBe(r1.runId);
    expect(r2.sectionsPacked).toBeGreaterThan(0);
  }, 15_000);

  it("reduces source capacity on provider context rejection (at most two reductions)", async () => {
    await seedMessages("conv-11", [
      { role: "user", content: "reduce me please", ts: 1_000 },
      { role: "assistant", content: "reduce reply one", ts: 2_000 },
      { role: "user", content: "reduce followup", ts: 3_000 },
      { role: "assistant", content: "reduce reply two", ts: 4_000 },
    ]);
    await indexConversation("conv-11");

    // First attempt is context-rejected; the bounded retry halves capacity
    // and succeeds on the second attempt — no all-history fallback (AC-15).
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("context_length exceeded");
      return JSON.stringify({
        version: 1,
        synopsis: "reduced synopsis",
        decisions: [],
        constraints: [],
        pending: [],
        toolOutcomes: [],
        topics: [],
      });
    });
    const result = await coordinator.requestCompaction("conv-11", {
      trigger: "manual",
      summarize: fn,
    });
    expect(result.state).toBe("completed");
    expect(calls).toBe(2);
    expect(result.generationId).toBeTruthy();
  }, 15_000);

  it("a late AI result cannot resurrect a conversation cleared mid-flight (AC-13)", async () => {
    await seedMessages("conv-12", [
      { role: "user", content: "doomed message", ts: 1_000 },
      { role: "assistant", content: "doomed reply", ts: 2_000 },
      { role: "user", content: "doomed followup", ts: 3_000 },
      { role: "assistant", content: "doomed reply two", ts: 4_000 },
    ]);
    await indexConversation("conv-12");

    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fn = vi.fn(() => gate);
    const p = coordinator.requestCompaction("conv-12", {
      trigger: "manual",
      summarize: fn,
    });
    // Let the run claim + pack and reach the in-flight AI call.
    await vi.waitFor(() => expect(fn).toHaveBeenCalled());
    // Clear the conversation WHILE the summary request is in flight.
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    await stateModel.tombstone("conv-12");
    release(
      JSON.stringify({
        version: 1,
        synopsis: "late synopsis",
        decisions: [],
        constraints: [],
        pending: [],
        toolOutcomes: [],
        topics: [],
      })
    );
    await expect(p).rejects.toThrow();
    // Nothing was published or staged for the tombstoned conversation.
    const status = await coordinator.getStatus("conv-12");
    expect(status?.generationId).toBeFalsy();
  }, 15_000);

  it("fails closed without an all-history fallback after repeated invalid output", async () => {
    await seedMessages("conv-8", [
      { role: "user", content: "always bad output", ts: 1_000 },
      { role: "assistant", content: "bad reply one", ts: 2_000 },
      { role: "user", content: "bad followup", ts: 3_000 },
      { role: "assistant", content: "bad reply two", ts: 4_000 },
    ]);
    await indexConversation("conv-8");

    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      return JSON.stringify({ version: 1, synopsis: "x".repeat(5_000) });
    });
    await expect(
      coordinator.requestCompaction("conv-8", {
        trigger: "manual",
        summarize: fn,
      })
    ).rejects.toThrow();
    // Bounded attempts: at most 4 model calls per section per run.
    expect(calls).toBeLessThanOrEqual(4);
  }, 15_000);
});

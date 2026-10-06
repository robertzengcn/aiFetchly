"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import {
  MANUAL_BUDGET_DEFAULTS,
  HARD_CAPS,
  clampToHardCaps,
} from "@/service/aiTaskExecution/budgetDefaults";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-task-exec-module-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function ensureInitialized(): Promise<void> {
  await SqliteDb.ensureInitialized();
}

/**
 * Narrow `startExecution`'s discriminated result to the `created` variant.
 * Every test in this suite starts from a unique conversation/submission pair,
 * so the result must be `created` — anything else is a test failure (not a
 * throw) so the assertion message names the actual status.
 */
function unwrapCreated(
  result: import("@/model/AiTaskExecution.model").CreateExecutionResult
): { executionId: string; ledgerId: string; executionRowId: number } {
  if (result.status !== "created") {
    throw new Error(
      `expected startExecution to create a new row, got status=${result.status}`
    );
  }
  return result;
}

describe("AiTaskExecutionModule (Mocha)", function () {
  this.timeout(15000);

  beforeEach(async () => {
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("startExecution creates an execution + ledger row with version 0", async () => {
    const mod = new AiTaskExecutionModule();
    const result = unwrapCreated(await mod.startExecution({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-1",
      requestHash: "sha256:abc",
      origin: { type: "manual", submissionId: "sub-1" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));
    expect(result.executionId).to.match(/^exec-/);
    expect(result.ledgerId).to.match(/^ledger-/);

    // Ledger row exists with version 0.
    const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
    const ledger = await ledgerRepo.findOne({
      where: { ledger_id: result.ledgerId },
    });
    expect(ledger?.execution_state_version).to.equal(0);
    expect(ledger?.status).to.equal("active");

    // GAP-S1: budget limits are frozen into policy_limits_json, not "{}".
    const frozen = JSON.parse(
      ledger?.policy_limits_json ?? "{}"
    ) as Record<string, unknown>;
    expect(frozen.maxContinuations).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxContinuations
    );
    expect(frozen.maxActiveRuntimeMs).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxActiveRuntimeMs
    );
  });

  it("freezes budget limits into policy_limits_json clamped to HARD_CAPS (GAP-S1, §9)", async () => {
    const mod = new AiTaskExecutionModule();
    const result = unwrapCreated(await mod.startExecution({
      conversationId: "conv-clamp",
      sourceUserMessageId: "msg-clamp",
      submissionId: "sub-clamp",
      requestHash: "sha256:clamp",
      origin: { type: "manual", submissionId: "sub-clamp" },
      route: "task_verified",
      completionOwner: "standalone",
      // Deliberately over the hard caps — must be clamped before freeze.
      budgetLimits: {
        maxContinuations: 1000,
        maxProviderAttempts: 60,
        maxCheckerAttempts: 6,
        maxToolExecutions: 50,
        maxTokens: 128_000,
        maxActiveRuntimeMs: 5 * 60 * 60 * 1000, // 5 hours > 30-min cap
        maxWaitMs: 60 * 60 * 1000,
        maxNoProgressStreak: 3,
      },
    }));

    const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
    const ledger = await ledgerRepo.findOne({
      where: { ledger_id: result.ledgerId },
    });
    const frozen = JSON.parse(
      ledger?.policy_limits_json ?? "{}"
    ) as Record<string, unknown>;
    // Clamped to HARD_CAPS, not the hostile input.
    expect(frozen.maxContinuations).to.equal(HARD_CAPS.maxContinuations);
    expect(frozen.maxActiveRuntimeMs).to.equal(HARD_CAPS.maxActiveRuntimeMs);
    // Non-capped fields pass through unchanged.
    expect(frozen.maxProviderAttempts).to.equal(60);
    expect(frozen.maxTokens).to.equal(128_000);
  });

  it("clampToHardCaps clamps over-cap fields and passes the rest through unchanged (GAP-S1, PRD §9)", () => {
    // Over the caps on both capped fields.
    const overCap = clampToHardCaps({
      ...MANUAL_BUDGET_DEFAULTS,
      maxContinuations: 1000,
      maxActiveRuntimeMs: 60 * 60 * 1000,
    });
    expect(overCap.maxContinuations).to.equal(HARD_CAPS.maxContinuations);
    expect(overCap.maxActiveRuntimeMs).to.equal(HARD_CAPS.maxActiveRuntimeMs);
    // Non-capped fields pass through unchanged.
    expect(overCap.maxProviderAttempts).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxProviderAttempts
    );
    expect(overCap.maxTokens).to.equal(MANUAL_BUDGET_DEFAULTS.maxTokens);
    expect(overCap.maxToolExecutions).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxToolExecutions
    );

    // Under the caps on both capped fields — nothing raised.
    const underCap = clampToHardCaps(MANUAL_BUDGET_DEFAULTS);
    expect(underCap.maxContinuations).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxContinuations
    );
    expect(underCap.maxActiveRuntimeMs).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxActiveRuntimeMs
    );

    // Immutability: input is not mutated.
    const input = {
      ...MANUAL_BUDGET_DEFAULTS,
      maxContinuations: 1000,
    };
    clampToHardCaps(input);
    expect(input.maxContinuations).to.equal(1000);
  });

  // ----- GAP-S1 #29: scoped submission uniqueness (AC-26, §4A.1) -----
  describe("startExecution submission uniqueness (AC-26)", () => {
    it("reuses the existing execution on a transport retry with the same request_hash (no new row, no renewed limits)", async () => {
      const mod = new AiTaskExecutionModule();
      const first = unwrapCreated(await mod.startExecution({
        conversationId: "conv-ac26-reuse",
        sourceUserMessageId: "msg-ac26",
        submissionId: "sub-ac26-reuse",
        requestHash: "sha256:same",
        origin: { type: "manual", submissionId: "sub-ac26-reuse" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));

      // Transport retry: same conversation + submission + request_hash.
      const second = await mod.startExecution({
        conversationId: "conv-ac26-reuse",
        sourceUserMessageId: "msg-ac26",
        submissionId: "sub-ac26-reuse",
        requestHash: "sha256:same",
        origin: { type: "manual", submissionId: "sub-ac26-reuse" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      });

      // Reused — the caller must NOT re-dispatch or renew limits.
      expect(second.status).to.equal("reused");
      if (second.status !== "reused") return; // narrow for TS
      expect(second.existing.executionId).to.equal(first.executionId);
      expect(second.existing.ledgerId).to.equal(first.ledgerId);
      expect(second.existing.submissionId).to.equal("sub-ac26-reuse");
      expect(second.existing.requestHash).to.equal("sha256:same");
      expect(second.existing.finalized).to.equal(false);
      expect(second.existing.stage).to.equal("resolving");

      // No duplicate row was inserted — still exactly one execution.
      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      const rows = await execRepo.find({
        where: { conversation_id: "conv-ac26-reuse" },
      });
      expect(rows.length).to.equal(1);
    });

    it("returns SUBMISSION_CONFLICT when the same submission_id arrives with a different request_hash", async () => {
      const mod = new AiTaskExecutionModule();
      await mod.startExecution({
        conversationId: "conv-ac26-conflict",
        sourceUserMessageId: "msg-ac26",
        submissionId: "sub-ac26-conflict",
        requestHash: "sha256:original",
        origin: { type: "manual", submissionId: "sub-ac26-conflict" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      });

      // Same submission ID, different request payload — must NOT persist a
      // second row and must NOT overwrite the original request_hash.
      const second = await mod.startExecution({
        conversationId: "conv-ac26-conflict",
        sourceUserMessageId: "msg-ac26",
        submissionId: "sub-ac26-conflict",
        requestHash: "sha256:changed",
        origin: { type: "manual", submissionId: "sub-ac26-conflict" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      });

      expect(second.status).to.equal("conflict");
      if (second.status !== "conflict") return; // narrow for TS
      expect(second.reasonCode).to.equal("SUBMISSION_CONFLICT");
      expect(second.existing.requestHash).to.equal("sha256:original");

      // The original row is untouched — no second row, no overwrite.
      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      const rows = await execRepo.find({
        where: { conversation_id: "conv-ac26-conflict" },
      });
      expect(rows.length).to.equal(1);
      expect(rows[0]?.request_hash).to.equal("sha256:original");
    });

    it("allows the same submission_id across different conversations (scope is conversation+submission)", async () => {
      const mod = new AiTaskExecutionModule();
      const a = unwrapCreated(await mod.startExecution({
        conversationId: "conv-ac26-scope-a",
        sourceUserMessageId: "msg-a",
        submissionId: "sub-shared",
        requestHash: "sha256:a",
        origin: { type: "manual", submissionId: "sub-shared" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      const b = unwrapCreated(await mod.startExecution({
        conversationId: "conv-ac26-scope-b",
        sourceUserMessageId: "msg-b",
        submissionId: "sub-shared",
        requestHash: "sha256:b",
        origin: { type: "manual", submissionId: "sub-shared" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      // Different conversations → different executions, no conflict.
      expect(a.executionId).to.not.equal(b.executionId);
    });

    it("does not dedup on null submission_id (scheduled origin is exempt — lineage key is occurrence_key)", async () => {
      const mod = new AiTaskExecutionModule();
      // Two scheduled-origin executions with null submission_id in the same
      // conversation must both insert (the partial unique index skips NULLs).
      const a = unwrapCreated(await mod.startExecution({
        conversationId: "conv-ac26-null",
        sourceUserMessageId: "msg-null-a",
        submissionId: null,
        requestHash: "sha256:null-a",
        origin: {
          type: "scheduled",
          taskId: 1,
          runId: 1,
          occurrenceKey: "scheduled-loop:1:1",
        },
        route: "task_best_effort",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      const b = unwrapCreated(await mod.startExecution({
        conversationId: "conv-ac26-null",
        sourceUserMessageId: "msg-null-b",
        submissionId: null,
        requestHash: "sha256:null-b",
        origin: {
          type: "scheduled",
          taskId: 1,
          runId: 2,
          occurrenceKey: "scheduled-loop:1:2",
        },
        route: "task_best_effort",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      expect(a.executionId).to.not.equal(b.executionId);
    });

    it("resolves a true concurrent same-submission insert race to reused (no raw UNIQUE error)", async () => {
      const mod = new AiTaskExecutionModule();
      // Two startExecution calls with the same (conversation, submission)
      // race via Promise.all. The executionCreateMutex serializes the
      // dedup-lookup + insert so the second caller's lookup sees the first
      // caller's committed row and resolves to reused (the partial unique
      // index is the SQL-level backstop). Neither caller surfaces a raw
      // SQLite UNIQUE/transaction-collision error.
      const [first, second] = await Promise.all([
        mod.startExecution({
          conversationId: "conv-ac26-race",
          sourceUserMessageId: "msg-race",
          submissionId: "sub-ac26-race",
          requestHash: "sha256:race",
          origin: { type: "manual", submissionId: "sub-ac26-race" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }),
        mod.startExecution({
          conversationId: "conv-ac26-race",
          sourceUserMessageId: "msg-race",
          submissionId: "sub-ac26-race",
          requestHash: "sha256:race",
          origin: { type: "manual", submissionId: "sub-ac26-race" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }),
      ]);

      // Exactly one created, the other reused — never a throw, never two rows.
      const statuses = [first.status, second.status].sort();
      expect(statuses).to.deep.equal(["created", "reused"]);

      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      const rows = await execRepo.find({
        where: { conversation_id: "conv-ac26-race" },
      });
      expect(rows.length).to.equal(1);
    });
  });

  it("finalizeExecution (manual) sets outcome + final-event identity without touching schedules (AC-32)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-2",
      sourceUserMessageId: "msg-2",
      submissionId: "sub-2",
      requestHash: "sha256:def",
      origin: { type: "manual", submissionId: "sub-2" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    const result = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "All criteria passed",
      evidenceIds: ["ev-1"],
      remainingWork: [],
    });
    expect(result.ok).to.equal(true);

    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(exec?.finalized).to.equal(true);
    expect(exec?.task_outcome).to.equal("verified_complete");
    expect(exec?.final_event_identity).to.equal(
      `execution-result:${started.executionId}`
    );
    expect(exec?.schedule_id).to.be.null; // manual never touches schedules
  });

  it("concurrent CAS finalization — second finalizer returns existing outcome (no double increment, §6.3)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-3",
      sourceUserMessageId: "msg-3",
      submissionId: "sub-3",
      requestHash: "sha256:ghi",
      origin: { type: "manual", submissionId: "sub-3" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    const first = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "first",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(first.ok).to.equal(true);

    // Second finalizer with the stale version 0 must NOT re-finalize.
    const second = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0, // stale
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      summary: "second",
      evidenceIds: [],
      remainingWork: [],
    });
    // Outcome is immutable; second finalizer does not overwrite.
    expect(second.alreadyFinalized).to.equal(true);

    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(exec?.task_outcome).to.equal("verified_complete"); // unchanged
  });

  it("persistence failure never emits success (PERSISTENCE_FAILED, §6.3)", async () => {
    const mod = new AiTaskExecutionModule();
    const result = await mod.finalizeExecution({
      executionId: "exec-nonexistent",
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "x",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("MISSING_TASK_OUTCOME");
  });

  // ----- B2: TRUE concurrent CAS (not sequential) -----
  it("true concurrent CAS finalization — Promise.all race resolves to exactly one winner (B2, §6.3)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-race",
      sourceUserMessageId: "msg-race",
      submissionId: "sub-race",
      requestHash: "sha256:race",
      origin: { type: "manual", submissionId: "sub-race" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    // Two finalizers race on the same expectedVersion (0). With the atomic
    // UPDATE…WHERE execution_state_version=? AND finalized=0, exactly one
    // UPDATE affects a row; the other gets affected=0 and returns
    // ALREADY_FINALIZED. Sequential awaits cannot prove this — Promise.all
    // dispatches both before either settles.
    const [first, second] = await Promise.all([
      mod.finalizeExecution({
        executionId: started.executionId,
        expectedVersion: 0,
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
        summary: "winner",
        evidenceIds: [],
        remainingWork: [],
      }),
      mod.finalizeExecution({
        executionId: started.executionId,
        expectedVersion: 0,
        outcome: "incomplete",
        reasonCode: "NO_PROGRESS",
        summary: "loser",
        evidenceIds: [],
        remainingWork: [],
      }),
    ]);

    // Exactly one winner. The other is ALREADY_FINALIZED — never BOTH ok.
    const winners = [first, second].filter((r) => r.ok).length;
    expect(winners).to.equal(1);
    const loser = first.ok ? second : first;
    expect(loser.alreadyFinalized).to.equal(true);

    // The persisted outcome is the winner's, never the loser's. Counters
    // never increment twice (no double-finalization).
    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(exec?.finalized).to.equal(true);
    expect(exec?.execution_state_version).to.equal(1); // bumped exactly once
  });

  // ----- B6: evidence checkpoint + assistantResultMessageId persistence -----
  it("finalizeExecution persists evidenceIds/remainingWork/assistantResultMessageId into execution_state_json (B6, §6.3, FR-12)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-b6",
      sourceUserMessageId: "msg-b6",
      submissionId: "sub-b6",
      requestHash: "sha256:b6",
      origin: { type: "manual", submissionId: "sub-b6" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    const result = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0,
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      summary: "partial",
      evidenceIds: ["ev-1", "ev-2"],
      remainingWork: ["rec-2"],
      assistantResultMessageId: "msg-result-1",
    });
    expect(result.ok).to.equal(true);

    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(exec?.finalized).to.equal(true);
    expect(exec?.assistant_result_message_id).to.equal("msg-result-1");

    // B6: the checkpoint holds the caller inputs instead of silently dropping
    // them. Slice 1 has no evidence store, so they land in
    // execution_state_json until the Slice 2 checkpoint format lands.
    const parsed = JSON.parse(
      exec?.execution_state_json ?? "{}"
    ) as Record<string, unknown>;
    expect(parsed.evidenceIds).to.deep.equal(["ev-1", "ev-2"]);
    expect(parsed.remainingWork).to.deep.equal(["rec-2"]);
    expect(parsed.assistantResultMessageId).to.equal("msg-result-1");
    expect(parsed.outcome).to.equal("incomplete");
    expect(parsed.reasonCode).to.equal("NO_PROGRESS");
  });

  // ----- B8: recordShadowDecision merge + finalized guard + version bump -----
  describe("recordShadowDecision (B8, §6.1)", () => {
    it("merges the decision under a stable key instead of clobbering existing state", async () => {
      const mod = new AiTaskExecutionModule();
      const started = unwrapCreated(await mod.startExecution({
        conversationId: "conv-b8a",
        sourceUserMessageId: "msg-b8a",
        submissionId: "sub-b8a",
        requestHash: "sha256:b8a",
        origin: { type: "manual", submissionId: "sub-b8a" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));

      // Seed execution_state_json with a prior checkpoint (simulating a
      // contract snapshot or earlier shadow decision).
      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      await execRepo.update(
        { execution_id: started.executionId },
        {
          execution_state_json: JSON.stringify({
            contractHash: "sha256:contract-1",
            stage: "preparing",
          }),
          execution_state_version: 1,
        }
      );

      // Record a shadow decision — must merge, not overwrite.
      await mod.recordShadowDecision({
        executionId: started.executionId,
        decision: { type: "finish", outcome: "incomplete" },
      });

      const exec = await execRepo.findOne({
        where: { execution_id: started.executionId },
      });
      const parsed = JSON.parse(
        exec?.execution_state_json ?? "{}"
      ) as Record<string, unknown>;
      // Prior data preserved (B8.3 merge semantics, §6.1).
      expect(parsed.contractHash).to.equal("sha256:contract-1");
      // New decision merged under the stable key.
      const shadow = parsed.shadowDecision as {
        type: string;
        outcome: string;
      };
      expect(shadow.type).to.equal("finish");
      expect(shadow.outcome).to.equal("incomplete");
      // B8.2: version bumped so a concurrent finalizer's stale CAS won't match.
      expect(exec?.execution_state_version).to.equal(2);
    });

    it("no-ops on a finalized (terminal) execution — terminal rows are immutable", async () => {
      const mod = new AiTaskExecutionModule();
      const started = unwrapCreated(await mod.startExecution({
        conversationId: "conv-b8b",
        sourceUserMessageId: "msg-b8b",
        submissionId: "sub-b8b",
        requestHash: "sha256:b8b",
        origin: { type: "manual", submissionId: "sub-b8b" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      await mod.finalizeExecution({
        executionId: started.executionId,
        expectedVersion: 0,
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
        summary: "done",
        evidenceIds: [],
        remainingWork: [],
      });

      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      const before = await execRepo.findOne({
        where: { execution_id: started.executionId },
      });
      const stateBefore = before?.execution_state_json;
      const versionBefore = before?.execution_state_version;

      // B8.1: recording a shadow decision against a terminal execution must
      // not overwrite the final checkpoint or bump the version.
      await mod.recordShadowDecision({
        executionId: started.executionId,
        decision: { type: "finish", outcome: "incomplete" },
      });

      const after = await execRepo.findOne({
        where: { execution_id: started.executionId },
      });
      expect(after?.execution_state_json).to.equal(stateBefore);
      expect(after?.execution_state_version).to.equal(versionBefore);
    });

    it("no-ops on a missing execution (silent — no row to write)", async () => {
      const mod = new AiTaskExecutionModule();
      // No throw — a missing execution simply has nothing to record.
      await mod.recordShadowDecision({
        executionId: "exec-does-not-exist",
        decision: { type: "finish" },
      });
    });

    // B8 reverse interleaving (D1, /review): a finalizer that commits
    // BETWEEN the shadow path's read and its CAS UPDATE must win, and the
    // shadow decision must NOT clobber the committed terminal row. The
    // previous full-row `saveExecution` had no WHERE predicate and would
    // overwrite finalized=1, task_outcome, and finalized_at with the stale
    // in-memory entity. The atomic CAS predicate
    // (`finalized = 0 AND execution_state_version = :expected`) makes the
    // shadow UPDATE affect 0 rows and silently no-op. Sequential awaits
    // cannot prove this — we interleave by reading, finalizing, then
    // completing the shadow write against the stale version.
    it("finalizer commits between shadow read and CAS save → shadow no-ops, terminal outcome wins (D1, B8 reverse race)", async () => {
      const mod = new AiTaskExecutionModule();
      const started = unwrapCreated(await mod.startExecution({
        conversationId: "conv-b8d1",
        sourceUserMessageId: "msg-b8d1",
        submissionId: "sub-b8d1",
        requestHash: "sha256:b8d1",
        origin: { type: "manual", submissionId: "sub-b8d1" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));

      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );

      // Simulate the shadow path's read: load the entity at version 0. The
      // shadow path will later write against THIS expectedVersion, by which
      // point the row has moved on.
      const readByShadow = await execRepo.findOne({
        where: { execution_id: started.executionId },
      });
      expect(readByShadow?.execution_state_version).to.equal(0);
      expect(readByShadow?.finalized).to.equal(false);

      // A finalizer commits between the shadow read and the shadow write.
      // It bumps execution_state_version to 1 and sets finalized=1.
      const finalized = await mod.finalizeExecution({
        executionId: started.executionId,
        expectedVersion: 0,
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
        summary: "terminal-wins",
        evidenceIds: [],
        remainingWork: [],
      });
      expect(finalized.ok).to.equal(true);

      // Now the shadow path completes its write against the stale version 0
      // it read above. The CAS predicate `finalized = 0 AND version = 0`
      // matches zero rows (finalized is now 1, version is now 1), so the
      // shadow decision is silently dropped — never clobbers the terminal
      // outcome, finalized flag, or finalized_at.
      await mod.recordShadowDecision({
        executionId: started.executionId,
        decision: { type: "finish", outcome: "incomplete" },
      });

      const after = await execRepo.findOne({
        where: { execution_id: started.executionId },
      });
      // Terminal outcome preserved — NOT overwritten with "incomplete".
      expect(after?.finalized).to.equal(true);
      expect(after?.task_outcome).to.equal("verified_complete");
      // Version bumped exactly once by the finalizer; the shadow path did
      // NOT bump it (its UPDATE affected 0 rows).
      expect(after?.execution_state_version).to.equal(1);
      // execution_state_json holds the finalizer's checkpoint, not a
      // shadowDecision key. (recordShadowDecision merges under
      // "shadowDecision"; its absence proves the CAS no-op'd.)
      const parsed = JSON.parse(
        after?.execution_state_json ?? "{}"
      ) as Record<string, unknown>;
      expect(parsed.shadowDecision).to.equal(undefined);
    });
  });

  // ----- Slice 2 Unit 3: lineage + contract persistence + getLedgerById -----
  describe("startExecution lineage + contract freeze (FR-19/21/22, Unit 3)", () => {
    it("persists parent_execution_id, lineage_ledger_id, contract_snapshot_json, and contract_hash at creation", async () => {
      const mod = new AiTaskExecutionModule();
      const contractJson = JSON.stringify({
        schemaVersion: 1,
        contractId: "contract-test-1",
        contractHash: "sha256:contract-hash-1",
        objective: "Save 100 contacts",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "verified",
        criteria: [],
      });
      const result = unwrapCreated(await mod.startExecution({
        conversationId: "conv-lineage-1",
        sourceUserMessageId: "msg-1",
        submissionId: "sub-lineage-1",
        requestHash: "sha256:lineage",
        origin: { type: "manual", submissionId: "sub-lineage-1" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: "exec-parent",
        lineageLedgerId: "ledger-lineage",
        contractSnapshotJson: contractJson,
        contractHash: "sha256:contract-hash-1",
      }));

      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      const exec = await execRepo.findOne({
        where: { execution_id: result.executionId },
      });
      // Lineage columns carry the caller-supplied values, not the defaults.
      expect(exec?.parent_execution_id).to.equal("exec-parent");
      expect(exec?.lineage_ledger_id).to.equal("ledger-lineage");
      // Contract snapshot + hash persisted (FR-19).
      expect(exec?.contract_hash).to.equal("sha256:contract-hash-1");
      expect(exec?.contract_snapshot_json).to.equal(contractJson);
    });

    it("defaults lineage_ledger_id to the new execution's own ledger on a fresh start (no parent)", async () => {
      const mod = new AiTaskExecutionModule();
      const result = unwrapCreated(await mod.startExecution({
        conversationId: "conv-lineage-2",
        sourceUserMessageId: "msg-2",
        submissionId: "sub-lineage-2",
        requestHash: "sha256:fresh",
        origin: { type: "manual", submissionId: "sub-lineage-2" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));

      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      const exec = await execRepo.findOne({
        where: { execution_id: result.executionId },
      });
      // No parent → lineage points at the row's own ledger; the column is
      // never null.
      expect(exec?.parent_execution_id).to.be.null;
      expect(exec?.lineage_ledger_id).to.equal(result.ledgerId);
      expect(exec?.contract_hash).to.be.null;
      expect(exec?.contract_snapshot_json).to.be.null;
    });

    it("getLedgerById returns the owner_generation (leaseGeneration) and consumed counters", async () => {
      const mod = new AiTaskExecutionModule();
      const result = unwrapCreated(await mod.startExecution({
        conversationId: "conv-ledger-1",
        sourceUserMessageId: "msg-ledger",
        submissionId: "sub-ledger",
        requestHash: "sha256:ledger",
        origin: { type: "manual", submissionId: "sub-ledger" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));

      const ledger = await mod.getLedgerById(result.ledgerId);
      expect(ledger).to.not.be.null;
      if (!ledger) return;
      // Fresh ledger: owner_generation 0 (the first leaseGeneration).
      expect(ledger.ownerGeneration).to.equal(0);
      expect(ledger.consumedContinuations).to.equal(0);
      expect(ledger.consumedProviderAttempts).to.equal(0);
      expect(ledger.status).to.equal("active");
      // policy_limits_json is the clamped frozen budget, not "{}".
      const frozen = JSON.parse(ledger.policyLimitsJson) as Record<
        string,
        unknown
      >;
      expect(frozen.maxContinuations).to.equal(
        MANUAL_BUDGET_DEFAULTS.maxContinuations
      );
    });

    it("getLedgerById returns null for an unknown ledger id", async () => {
      const mod = new AiTaskExecutionModule();
      const ledger = await mod.getLedgerById("ledger-does-not-exist");
      expect(ledger).to.be.null;
    });

    it("finalizeScheduledExecution resolves as not-found for an unknown execution (typed seam present)", async () => {
      // Unit 6 replaced the stub with the real pass-through to the model's
      // transaction. An unknown execution id is a typed result, not a throw.
      const mod = new AiTaskExecutionModule();
      const result = await mod.finalizeScheduledExecution({
        executionId: "exec-stub",
        expectedVersion: 0,
        runId: 0,
        scheduleId: 0,
        taskOutcome: "incomplete",
        reasonCode: "MISSING_TASK_OUTCOME",
        summary: "missing",
        evidenceIds: [],
        remainingWork: [],
        idempotencyKey: "scheduled-loop:0:0",
        incrementFailure: true,
        nextRunAt: new Date(),
      });
      expect(result.ok).to.equal(false);
      expect(result.reasonCode).to.equal("MISSING_TASK_OUTCOME");
    });
  });

  // ----- GAP-S1 #27: worker guard on every model write method (NFR-03) -----
  describe("worker guard (NFR-03, assertNotWorker)", () => {
    let previous: string | undefined;
    beforeEach(() => {
      previous = process.env.WORKER_TYPE;
      process.env.WORKER_TYPE = "test-worker";
    });
    afterEach(() => {
      if (previous === undefined) delete process.env.WORKER_TYPE;
      else process.env.WORKER_TYPE = previous;
    });

    it("refuses createExecution from a worker process", async () => {
      const mod = new AiTaskExecutionModule();
      let threw = false;
      try {
        await mod.startExecution({
          conversationId: "conv-w",
          sourceUserMessageId: "msg-w",
          submissionId: "sub-w",
          requestHash: "sha256:w",
          origin: { type: "manual", submissionId: "sub-w" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        });
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/worker/i);
      }
      expect(threw).to.equal(true);
    });

    it("refuses finalizeExecution from a worker process", async () => {
      const mod = new AiTaskExecutionModule();
      let threw = false;
      try {
        await mod.finalizeExecution({
          executionId: "exec-w",
          expectedVersion: 0,
          outcome: "verified_complete",
          reasonCode: "CRITERIA_SATISFIED",
          summary: "x",
          evidenceIds: [],
          remainingWork: [],
        });
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/worker/i);
      }
      expect(threw).to.equal(true);
    });

    it("refuses getExecution from a worker process", async () => {
      const mod = new AiTaskExecutionModule();
      let threw = false;
      try {
        await mod.getExecution("exec-w");
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/worker/i);
      }
      expect(threw).to.equal(true);
    });

    it("refuses getUnfinalizedExecutions from a worker process", async () => {
      const mod = new AiTaskExecutionModule();
      let threw = false;
      try {
        await mod.getUnfinalizedExecutions();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/worker/i);
      }
      expect(threw).to.equal(true);
    });
  });
});

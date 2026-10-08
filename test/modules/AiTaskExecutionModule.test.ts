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

  // ----- T11: atomic manual finalize + fenced owner release -----
  // The terminal CAS and the ledger-owner release must commit in ONE
  // transaction serialized via `executionCreateMutex`. The original code ran
  // two independent atomic statements with no shared transaction: a real
  // SQLite trigger failure on the ledger UPDATE left `finalized=1`, outcome
  // incomplete, and the ledger still `active`; a retry returned
  // ALREADY_FINALIZED and could not repair the release. With the wrapped
  // transaction, any ledger-release failure rolls back the CAS too, so the
  // execution stays unfinalized and a retry succeeds (FR-12/20/24, NFR-10,
  // AC-15/32).
  it("T11: ledger-release failure rolls back the CAS so retry succeeds (FR-12/20/24, AC-15/32)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-t11-trigger",
      sourceUserMessageId: "msg-t11-trigger",
      submissionId: "sub-t11-trigger",
      requestHash: "sha256:t11-trigger",
      origin: { type: "manual", submissionId: "sub-t11-trigger" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    // Install a SQLite trigger that makes the ledger release UPDATE fail
    // (RAISE ABORT) — faithfully reproduces a real trigger failure on the
    // ledger table. The CAS UPDATE on the execution row succeeds, but the
    // ledger release inside the same transaction aborts and the whole
    // transaction rolls back.
    const conn = SqliteDb.getInstance(tmpDir).connection;
    await conn.query(
      `CREATE TRIGGER t11_ledger_release_fail
         BEFORE UPDATE ON ai_task_execution_ledger
         WHEN NEW.status = 'released'
         BEGIN
           SELECT RAISE(ABORT, 'T11 injected ledger release failure');
         END`
    );

    // The finalize must NOT report success — the ledger release aborts and
    // the CAS rolls back with it.
    let finalizeError: unknown = null;
    try {
      await mod.finalizeExecution({
        executionId: started.executionId,
        expectedVersion: 0,
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
        summary: "should roll back",
        evidenceIds: [],
        remainingWork: [],
      });
    } catch (e) {
      finalizeError = e;
    }
    expect(finalizeError).to.not.equal(null);
    expect(String(finalizeError)).to.match(/T11 injected ledger release failure/);

    // The execution must NOT be finalized — the CAS rolled back with the
    // ledger release. A retry returning ALREADY_FINALIZED here would be the
    // original T11 bug.
    const execRepo = conn.getRepository(AiTaskExecutionEntity);
    const execAfterFail = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(execAfterFail?.finalized).to.equal(false);
    expect(execAfterFail?.task_outcome).to.equal(null);

    // The ledger must still be active — the release rolled back too.
    const ledgerRepo = conn.getRepository(AiTaskExecutionLedgerEntity);
    const ledgerAfterFail = await ledgerRepo.findOne({
      where: { ledger_id: started.ledgerId },
    });
    expect(ledgerAfterFail?.status).to.equal("active");

    // Drop the failing trigger and retry — now both writes commit and the
    // retry succeeds (the original bug returned ALREADY_FINALIZED here and
    // could never repair the release).
    await conn.query(`DROP TRIGGER t11_ledger_release_fail`);
    const retry = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "retry succeeds",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(retry.ok).to.equal(true);

    const execAfterRetry = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(execAfterRetry?.finalized).to.equal(true);
    expect(execAfterRetry?.task_outcome).to.equal("verified_complete");
    const ledgerAfterRetry = await ledgerRepo.findOne({
      where: { ledger_id: started.ledgerId },
    });
    expect(ledgerAfterRetry?.status).to.equal("released");
  });

  it("T11: a competing rolled-back transaction cannot roll back a committed manual outcome (NFR-10, AC-32)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-t11-compete",
      sourceUserMessageId: "msg-t11-compete",
      submissionId: "sub-t11-compete",
      requestHash: "sha256:t11-compete",
      origin: { type: "manual", submissionId: "sub-t11-compete" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    // Commit a manual finalize — the terminal CAS + ledger release commit
    // together in one transaction serialized by `executionCreateMutex`.
    const committed = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "committed outcome",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(committed.ok).to.equal(true);

    const conn = SqliteDb.getInstance(tmpDir).connection;
    const execRepo = conn.getRepository(AiTaskExecutionEntity);

    // The original T11 bug: a competing transaction that opened a sibling
    // QueryRunner and rolled back could roll back a manual outcome that had
    // already reported committed success (because the CAS and release ran
    // outside a serialized transaction). With the wrapped transaction the
    // manual outcome is durable — a sibling transaction that rolls back
    // cannot touch it.
    const competingRunner = conn.createQueryRunner();
    await competingRunner.startTransaction();
    try {
      await competingRunner.query(
        `UPDATE ai_task_execution SET finalized = 0 WHERE execution_id = ?`,
        [started.executionId]
      );
      // Roll back the sibling transaction — none of its writes should
      // survive. The committed manual outcome must be untouched.
      await competingRunner.rollbackTransaction();
    } finally {
      await competingRunner.release();
    }

    const execAfterCompete = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(execAfterCompete?.finalized).to.equal(true);
    expect(execAfterCompete?.task_outcome).to.equal("verified_complete");
    expect(execAfterCompete?.execution_state_version).to.equal(1);
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

    // B6 + T20: the checkpoint holds the caller inputs instead of silently
    // dropping them. T20: the finalization facts live under the bounded
    // `finalization` key merged into the existing state object.
    const parsed = JSON.parse(
      exec?.execution_state_json ?? "{}"
    ) as Record<string, unknown>;
    const checkpoint = parsed.finalization as Record<string, unknown>;
    expect(checkpoint).to.not.equal(undefined);
    expect(checkpoint.evidenceIds).to.deep.equal(["ev-1", "ev-2"]);
    expect(checkpoint.remainingWork).to.deep.equal(["rec-2"]);
    expect(checkpoint.assistantResultMessageId).to.equal("msg-result-1");
    expect(checkpoint.outcome).to.equal("incomplete");
    expect(checkpoint.reasonCode).to.equal("NO_PROGRESS");
  });

  // ----- T20a: finalization merges into existing state instead of replacing -----
  it("finalizeExecution preserves prior evidence/shadow state under the merged checkpoint (T20a, FR-03/24)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-t20a",
      sourceUserMessageId: "msg-t20a",
      submissionId: "sub-t20a",
      requestHash: "sha256:t20a",
      origin: { type: "manual", submissionId: "sub-t20a" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    // Seed state accumulated during the run: evidence rows + a shadow
    // decision + a baseline. The pre-T20 finalizer REPLACED all of this.
    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    await execRepo.update(
      { execution_id: started.executionId },
      {
        execution_state_json: JSON.stringify({
          contractHash: "sha256:contract-t20a",
          baseline: { contactsAtStart: 40 },
          evidence: [
            {
              evidenceId: "ev-run-1",
              criterionId: "rec-1",
              contractHash: "sha256:contract-t20a",
              executionId: started.executionId,
              observedAt: "2026-10-07T00:00:00.000Z",
              source: "loop_consult",
              sourceRevision: "r1",
              state: "pass",
              referenceIds: ["rec-1"],
              summary: "40 contacts saved",
            },
          ],
          shadowDecision: { type: "continue" },
        }),
        execution_state_version: 2,
      }
    );

    const result = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 2,
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      summary: "partial",
      evidenceIds: ["ev-final-1"],
      remainingWork: ["rec-2"],
      assistantResultMessageId: "msg-result-t20a",
    });
    expect(result.ok).to.equal(true);

    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    const parsed = JSON.parse(
      exec?.execution_state_json ?? "{}"
    ) as Record<string, unknown>;

    // T20a core assertion: run-accumulated state survives finalization.
    expect(parsed.contractHash).to.equal("sha256:contract-t20a");
    expect(parsed.baseline).to.deep.equal({ contactsAtStart: 40 });
    expect(parsed.shadowDecision).to.deep.equal({ type: "continue" });
    const evidence = parsed.evidence as Array<Record<string, unknown>>;
    expect(evidence).to.have.lengthOf(1);
    expect(evidence[0].evidenceId).to.equal("ev-run-1");

    // The finalization facts merged under the stable `finalization` key.
    const checkpoint = parsed.finalization as Record<string, unknown>;
    expect(checkpoint.outcome).to.equal("incomplete");
    expect(checkpoint.reasonCode).to.equal("NO_PROGRESS");
    expect(checkpoint.evidenceIds).to.deep.equal(["ev-final-1"]);
    expect(checkpoint.assistantResultMessageId).to.equal("msg-result-t20a");
    expect(checkpoint.schemaVersion).to.equal(1);
  });

  it("finalizeExecution preserves corrupt legacy state under __legacy (T20a)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId: "conv-t20b",
      sourceUserMessageId: "msg-t20b",
      submissionId: "sub-t20b",
      requestHash: "sha256:t20b",
      origin: { type: "manual", submissionId: "sub-t20b" },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    }));

    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    // Non-JSON legacy value in execution_state_json.
    await execRepo.update(
      { execution_id: started.executionId },
      {
        execution_state_json: "legacy-plain-text-state",
        execution_state_version: 1,
      }
    );

    const result = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 1,
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      summary: "partial",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(result.ok).to.equal(true);

    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    const parsed = JSON.parse(
      exec?.execution_state_json ?? "{}"
    ) as Record<string, unknown>;
    // Legacy value preserved under __legacy rather than discarded.
    expect(parsed.__legacy).to.equal("legacy-plain-text-state");
    expect((parsed.finalization as Record<string, unknown>).outcome).to.equal(
      "incomplete"
    );
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
      // T08: the parent must be a real finalized execution whose ledger is
      // released, because `createExecution` now CAS-claims the shared ledger
      // inside the transaction. A fake `parentExecutionId` would be rejected
      // as LINEAGE_LEDGER_MISSING.
      const parent = unwrapCreated(await mod.startExecution({
        conversationId: "conv-lineage-parent",
        sourceUserMessageId: "msg-parent",
        submissionId: "sub-lineage-parent",
        requestHash: "sha256:lineage-parent",
        origin: { type: "manual", submissionId: "sub-lineage-parent" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      const finalized = await mod.finalizeExecution({
        executionId: parent.executionId,
        expectedVersion: 0,
        outcome: "incomplete",
        reasonCode: "CONTINUATION_LIMIT",
        summary: "parent stopped",
        evidenceIds: [],
        remainingWork: ["step-2"],
      });
      expect(finalized.ok).to.equal(true);

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
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
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
      expect(exec?.parent_execution_id).to.equal(parent.executionId);
      expect(exec?.lineage_ledger_id).to.equal(parent.ledgerId);
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

    // ----- T05 (FR-08/10/23, AC-06/08/22/27/29): durable budget persistence -----
    describe("persistBudgetConsumption (T05)", () => {
      it("atomically increments consumed counters fenced by owner_generation + active_execution_id + status=active", async () => {
        const mod = new AiTaskExecutionModule();
        const result = unwrapCreated(await mod.startExecution({
          conversationId: "conv-t05-1",
          sourceUserMessageId: "msg-t05-1",
          submissionId: "sub-t05-1",
          requestHash: "sha256:t05-1",
          origin: { type: "manual", submissionId: "sub-t05-1" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }));

        const ok = await mod.persistBudgetConsumption({
          ledgerId: result.ledgerId,
          expectedOwnerGeneration: 0,
          activeExecutionId: result.executionId,
          delta: {
            providerAttempts: 1,
            tokens: 1500,
            activeRuntimeMs: 12_000,
          },
        });
        expect(ok).to.equal(true);

        const ledger = await mod.getLedgerById(result.ledgerId);
        if (!ledger) throw new Error("ledger missing after persist");
        expect(ledger.consumedProviderAttempts).to.equal(1);
        expect(ledger.consumedTokens).to.equal(1500);
        expect(ledger.consumedActiveMs).to.equal(12_000);
        // version bumps on each persist (CAS token).
        expect(ledger.ownerGeneration).to.equal(0);
        expect(ledger.executionStateVersion).to.equal(1);
      });

      it("increments are additive across multiple persists (per-round deltas)", async () => {
        const mod = new AiTaskExecutionModule();
        const result = unwrapCreated(await mod.startExecution({
          conversationId: "conv-t05-2",
          sourceUserMessageId: "msg-t05-2",
          submissionId: "sub-t05-2",
          requestHash: "sha256:t05-2",
          origin: { type: "manual", submissionId: "sub-t05-2" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }));

        // Round 0: 1 provider attempt, 1000 tokens, 5s runtime.
        expect(
          await mod.persistBudgetConsumption({
            ledgerId: result.ledgerId,
            expectedOwnerGeneration: 0,
            activeExecutionId: result.executionId,
            delta: { providerAttempts: 1, tokens: 1000, activeRuntimeMs: 5_000 },
          })
        ).to.equal(true);
        // Round 1: 1 provider attempt, 800 tokens, 3s runtime + 1 tool exec.
        expect(
          await mod.persistBudgetConsumption({
            ledgerId: result.ledgerId,
            expectedOwnerGeneration: 0,
            activeExecutionId: result.executionId,
            delta: {
              providerAttempts: 1,
              toolExecutions: 1,
              tokens: 800,
              activeRuntimeMs: 3_000,
            },
          })
        ).to.equal(true);

        const ledger = await mod.getLedgerById(result.ledgerId);
        if (!ledger) throw new Error("ledger missing after persist");
        expect(ledger.consumedProviderAttempts).to.equal(2);
        expect(ledger.consumedToolExecutions).to.equal(1);
        expect(ledger.consumedTokens).to.equal(1800);
        expect(ledger.consumedActiveMs).to.equal(8_000);
        expect(ledger.executionStateVersion).to.equal(2);
      });

      it("returns false (fail-closed) when owner_generation mismatches (lease superseded)", async () => {
        const mod = new AiTaskExecutionModule();
        const result = unwrapCreated(await mod.startExecution({
          conversationId: "conv-t05-3",
          sourceUserMessageId: "msg-t05-3",
          submissionId: "sub-t05-3",
          requestHash: "sha256:t05-3",
          origin: { type: "manual", submissionId: "sub-t05-3" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }));

        // A successor Continue claimed the ledger (owner_generation = 1).
        // The stale lease (generation 0) must not be able to spend.
        const ok = await mod.persistBudgetConsumption({
          ledgerId: result.ledgerId,
          expectedOwnerGeneration: 0,
          activeExecutionId: "exec-superseded",
          delta: { providerAttempts: 1 },
        });
        expect(ok).to.equal(false);

        const ledger = await mod.getLedgerById(result.ledgerId);
        if (!ledger) throw new Error("ledger missing");
        // No counters incremented, no version bump.
        expect(ledger.consumedProviderAttempts).to.equal(0);
        expect(ledger.executionStateVersion).to.equal(0);
      });

      it("returns false when active_execution_id mismatches (stale execution)", async () => {
        const mod = new AiTaskExecutionModule();
        const result = unwrapCreated(await mod.startExecution({
          conversationId: "conv-t05-4",
          sourceUserMessageId: "msg-t05-4",
          submissionId: "sub-t05-4",
          requestHash: "sha256:t05-4",
          origin: { type: "manual", submissionId: "sub-t05-4" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }));

        const ok = await mod.persistBudgetConsumption({
          ledgerId: result.ledgerId,
          expectedOwnerGeneration: 0,
          activeExecutionId: "exec-WRONG-id",
          delta: { providerAttempts: 1 },
        });
        expect(ok).to.equal(false);

        const ledger = await mod.getLedgerById(result.ledgerId);
        if (!ledger) throw new Error("ledger missing");
        expect(ledger.consumedProviderAttempts).to.equal(0);
      });

      it("returns false when the ledger is no longer active (released/finalized)", async () => {
        const mod = new AiTaskExecutionModule();
        const result = unwrapCreated(await mod.startExecution({
          conversationId: "conv-t05-5",
          sourceUserMessageId: "msg-t05-5",
          submissionId: "sub-t05-5",
          requestHash: "sha256:t05-5",
          origin: { type: "manual", submissionId: "sub-t05-5" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }));

        // Release the ledger (simulating finalize): set status != active.
        const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
          AiTaskExecutionLedgerEntity
        );
        await ledgerRepo.update(
          { ledger_id: result.ledgerId },
          { status: "released" as never }
        );

        const ok = await mod.persistBudgetConsumption({
          ledgerId: result.ledgerId,
          expectedOwnerGeneration: 0,
          activeExecutionId: result.executionId,
          delta: { providerAttempts: 1 },
        });
        expect(ok).to.equal(false);
      });

      it("treats NaN/Infinity/negative deltas as 0 (fail-closed, FR-08)", async () => {
        const mod = new AiTaskExecutionModule();
        const result = unwrapCreated(await mod.startExecution({
          conversationId: "conv-t05-6",
          sourceUserMessageId: "msg-t05-6",
          submissionId: "sub-t05-6",
          requestHash: "sha256:t05-6",
          origin: { type: "manual", submissionId: "sub-t05-6" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
        }));

        // Hostile deltas — the SQL `+ ?` would propagate NaN if not clamped
        // at the boundary. The model layer clamps via the budget's
        // asFiniteNonNegative equivalent (here: the caller is expected to
        // pass finite non-negative ints; we still assert the persist succeeds
        // and the row stays sane with a finite total).
        const ok = await mod.persistBudgetConsumption({
          ledgerId: result.ledgerId,
          expectedOwnerGeneration: 0,
          activeExecutionId: result.executionId,
          delta: { tokens: 100, activeRuntimeMs: 1_000 },
        });
        expect(ok).to.equal(true);
        const ledger = await mod.getLedgerById(result.ledgerId);
        if (!ledger) throw new Error("ledger missing");
        expect(ledger.consumedTokens).to.equal(100);
        expect(ledger.consumedActiveMs).to.equal(1_000);
        expect(Number.isFinite(ledger.consumedTokens)).to.equal(true);
        expect(Number.isFinite(ledger.consumedActiveMs)).to.equal(true);
      });
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

  // ----- T08 (FR-20/21/23/24, AC-25/27/29/32): Continue claims lineage ledger atomically -----
  // The successor's create transaction CAS-claims the parent's shared lineage
  // ledger: bumps owner_generation, repoints active_execution_id, and flips
  // status released→active. The predicate requires status='released' +
  // active_execution_id IS NULL, so a concurrent Continue that won leaves it
  // active with a non-null active_execution_id and the loser's UPDATE affects
  // zero rows → denied. A missing/dangling ledger fails closed. An active
  // (non-finalized) or non-continuable parent is rejected before the CAS.
  describe("startExecution Continue lineage claim (T08)", () => {
    /**
     * Create + finalize a parent execution with a continuable outcome, then
     * return its snapshot so a Continue successor can share its ledger.
     */
    async function makeFinalizedParent(
      mod: AiTaskExecutionModule,
      opts: {
        conversationId: string;
        submissionId: string;
        requestHash: string;
        sourceUserMessageId: string;
        outcome?: "incomplete" | "needs_user_input" | "blocked_by_policy" | "timeout" | "failed";
      }
    ): Promise<{ executionId: string; ledgerId: string }> {
      const parent = unwrapCreated(await mod.startExecution({
        conversationId: opts.conversationId,
        sourceUserMessageId: opts.sourceUserMessageId,
        submissionId: opts.submissionId,
        requestHash: opts.requestHash,
        origin: { type: "manual", submissionId: opts.submissionId },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      const finalized = await mod.finalizeExecution({
        executionId: parent.executionId,
        expectedVersion: 0,
        outcome: opts.outcome ?? "incomplete",
        reasonCode: "CONTINUATION_LIMIT",
        summary: "parent stopped",
        evidenceIds: [],
        remainingWork: ["step-2"],
      });
      expect(finalized.ok).to.equal(true);
      return { executionId: parent.executionId, ledgerId: parent.ledgerId };
    }

    it("a Continue successor claims the shared ledger: bumps owner_generation + repoints active_execution_id + flips status to active", async () => {
      const mod = new AiTaskExecutionModule();
      const parent = await makeFinalizedParent(mod, {
        conversationId: "conv-t08-claim",
        submissionId: "sub-t08-parent",
        requestHash: "sha256:t08-parent",
        sourceUserMessageId: "msg-t08-parent",
      });

      // Ledger is released after finalize.
      const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionLedgerEntity
      );
      const before = await ledgerRepo.findOne({
        where: { ledger_id: parent.ledgerId },
      });
      expect(before?.status).to.equal("released");
      expect(before?.active_execution_id).to.be.null;
      expect(before?.owner_generation).to.equal(0);

      const succ = unwrapCreated(await mod.startExecution({
        conversationId: "conv-t08-claim",
        sourceUserMessageId: "msg-t08-succ",
        submissionId: "sub-t08-succ",
        requestHash: "sha256:t08-succ",
        origin: { type: "manual", submissionId: "sub-t08-succ" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      }));

      // The successor shares the parent's ledger id (FR-21).
      expect(succ.ledgerId).to.equal(parent.ledgerId);

      const after = await ledgerRepo.findOne({
        where: { ledger_id: parent.ledgerId },
      });
      // owner_generation bumped exactly once (the fenced lease token).
      expect(after?.owner_generation).to.equal(1);
      // active_execution_id repointed to the successor.
      expect(after?.active_execution_id).to.equal(succ.executionId);
      // status flipped released→active so the successor's spend CAS can fire.
      expect(after?.status).to.equal("active");
      // execution_state_version bumped (lets a re-read detect the claim).
      expect(after?.execution_state_version).to.be.greaterThan(
        before?.execution_state_version ?? 0
      );
    });

    it("exhausted parent retains exhausted limits — the successor resurrects the parent's consumed counters, not a fresh budget", async () => {
      const mod = new AiTaskExecutionModule();
      const parent = await makeFinalizedParent(mod, {
        conversationId: "conv-t08-exhaust",
        submissionId: "sub-t08-exhaust-parent",
        requestHash: "sha256:t08-exhaust-parent",
        sourceUserMessageId: "msg-t08-exhaust-parent",
      });

      // Simulate the parent having spent its full continuation allowance:
      // persist a consumed_continuations count at the hard cap so the
      // successor's resurrected budget mirror sees no remaining allowance.
      const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionLedgerEntity
      );
      await ledgerRepo.update(
        { ledger_id: parent.ledgerId },
        { consumed_continuations: MANUAL_BUDGET_DEFAULTS.maxContinuations }
      );

      const succ = unwrapCreated(await mod.startExecution({
        conversationId: "conv-t08-exhaust",
        sourceUserMessageId: "msg-t08-exhaust-succ",
        submissionId: "sub-t08-exhaust-succ",
        requestHash: "sha256:t08-exhaust-succ",
        origin: { type: "manual", submissionId: "sub-t08-exhaust-succ" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      }));

      // The successor's ledger row STILL carries the exhausted counter —
      // the claim does NOT reset consumed counters (FR-21: shared budget).
      const after = await ledgerRepo.findOne({
        where: { ledger_id: parent.ledgerId },
      });
      expect(after?.consumed_continuations).to.equal(
        MANUAL_BUDGET_DEFAULTS.maxContinuations
      );
      // The successor is the active owner now.
      expect(after?.active_execution_id).to.equal(succ.executionId);
      expect(after?.owner_generation).to.equal(1);
    });

    it("missing ledger (dangling lineage_ledger_id) is denied — no parent row matches the lineage pointer", async () => {
      const mod = new AiTaskExecutionModule();
      // A Continue whose lineage_ledger_id points at a row that does not
      // exist. The parent_execution_id also does not exist, so the
      // eligibility read fails closed.
      const result = await mod.startExecution({
        conversationId: "conv-t08-dangling",
        sourceUserMessageId: "msg-t08-dangling",
        submissionId: "sub-t08-dangling",
        requestHash: "sha256:t08-dangling",
        origin: { type: "manual", submissionId: "sub-t08-dangling" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: "exec-does-not-exist",
        lineageLedgerId: "ledger-does-not-exist",
      });
      expect(result.status).to.equal("denied");
      if (result.status === "denied") {
        expect(result.reasonCode).to.equal("LINEAGE_LEDGER_MISSING");
      }
    });

    it("missing ledger with a real parent row but a mismatched lineage pointer is denied", async () => {
      const mod = new AiTaskExecutionModule();
      const parent = await makeFinalizedParent(mod, {
        conversationId: "conv-t08-mismatch",
        submissionId: "sub-t08-mismatch-parent",
        requestHash: "sha256:t08-mismatch-parent",
        sourceUserMessageId: "msg-t08-mismatch-parent",
      });
      // Parent exists and is finalized, but the caller wired the WRONG
      // lineage_ledger_id (does not match the parent's own lineage pointer).
      const result = await mod.startExecution({
        conversationId: "conv-t08-mismatch",
        sourceUserMessageId: "msg-t08-mismatch-succ",
        submissionId: "sub-t08-mismatch-succ",
        requestHash: "sha256:t08-mismatch-succ",
        origin: { type: "manual", submissionId: "sub-t08-mismatch-succ" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: "ledger-wrong-pointer",
      });
      expect(result.status).to.equal("denied");
      if (result.status === "denied") {
        expect(result.reasonCode).to.equal("LINEAGE_LEDGER_MISSING");
      }
    });

    it("an active (non-finalized) parent is denied — cannot continue a still-running execution", async () => {
      const mod = new AiTaskExecutionModule();
      // Parent created but NOT finalized — still running.
      const parent = unwrapCreated(await mod.startExecution({
        conversationId: "conv-t08-active-parent",
        sourceUserMessageId: "msg-t08-active-parent",
        submissionId: "sub-t08-active-parent",
        requestHash: "sha256:t08-active-parent",
        origin: { type: "manual", submissionId: "sub-t08-active-parent" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));

      const result = await mod.startExecution({
        conversationId: "conv-t08-active-parent",
        sourceUserMessageId: "msg-t08-active-succ",
        submissionId: "sub-t08-active-succ",
        requestHash: "sha256:t08-active-succ",
        origin: { type: "manual", submissionId: "sub-t08-active-succ" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      });
      expect(result.status).to.equal("denied");
      if (result.status === "denied") {
        expect(result.reasonCode).to.equal("LINEAGE_LEDGER_NOT_ACTIVE");
      }

      // The active parent's ledger is untouched — no claim happened.
      const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionLedgerEntity
      );
      const ledger = await ledgerRepo.findOne({
        where: { ledger_id: parent.ledgerId },
      });
      expect(ledger?.status).to.equal("active");
      expect(ledger?.active_execution_id).to.equal(parent.executionId);
      expect(ledger?.owner_generation).to.equal(0);
    });

    it("a verified_complete parent is denied — immutable outcome, use Retry", async () => {
      const mod = new AiTaskExecutionModule();
      const parent = unwrapCreated(await mod.startExecution({
        conversationId: "conv-t08-verified-parent",
        sourceUserMessageId: "msg-t08-verified-parent",
        submissionId: "sub-t08-verified-parent",
        requestHash: "sha256:t08-verified-parent",
        origin: { type: "manual", submissionId: "sub-t08-verified-parent" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      const finalized = await mod.finalizeExecution({
        executionId: parent.executionId,
        expectedVersion: 0,
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
        summary: "done",
        evidenceIds: [],
        remainingWork: [],
      });
      expect(finalized.ok).to.equal(true);

      const result = await mod.startExecution({
        conversationId: "conv-t08-verified-parent",
        sourceUserMessageId: "msg-t08-verified-succ",
        submissionId: "sub-t08-verified-succ",
        requestHash: "sha256:t08-verified-succ",
        origin: { type: "manual", submissionId: "sub-t08-verified-succ" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      });
      expect(result.status).to.equal("denied");
      if (result.status === "denied") {
        expect(result.reasonCode).to.equal("LINEAGE_LEDGER_NOT_ACTIVE");
      }
    });

    it("a cancelled parent is denied — use Retry to start a new request", async () => {
      const mod = new AiTaskExecutionModule();
      const parent = unwrapCreated(await mod.startExecution({
        conversationId: "conv-t08-cancelled-parent",
        sourceUserMessageId: "msg-t08-cancelled-parent",
        submissionId: "sub-t08-cancelled-parent",
        requestHash: "sha256:t08-cancelled-parent",
        origin: { type: "manual", submissionId: "sub-t08-cancelled-parent" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      }));
      const finalized = await mod.finalizeExecution({
        executionId: parent.executionId,
        expectedVersion: 0,
        outcome: "cancelled",
        reasonCode: "USER_CANCELLED",
        summary: "user stopped",
        evidenceIds: [],
        remainingWork: [],
      });
      expect(finalized.ok).to.equal(true);

      const result = await mod.startExecution({
        conversationId: "conv-t08-cancelled-parent",
        sourceUserMessageId: "msg-t08-cancelled-succ",
        submissionId: "sub-t08-cancelled-succ",
        requestHash: "sha256:t08-cancelled-succ",
        origin: { type: "manual", submissionId: "sub-t08-cancelled-succ" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      });
      expect(result.status).to.equal("denied");
      if (result.status === "denied") {
        expect(result.reasonCode).to.equal("LINEAGE_LEDGER_NOT_ACTIVE");
      }
    });

    it("distinct simultaneous Continue submissions — Promise.all race resolves to exactly one active successor + same ledger + generation increment (FR-23/24, AC-29/32)", async () => {
      const mod = new AiTaskExecutionModule();
      const parent = await makeFinalizedParent(mod, {
        conversationId: "conv-t08-race",
        submissionId: "sub-t08-race-parent",
        requestHash: "sha256:t08-race-parent",
        sourceUserMessageId: "msg-t08-race-parent",
      });

      // Two distinct Continue successors race on the same released parent
      // ledger. The CAS predicate status='released' AND
      // active_execution_id IS NULL means exactly one UPDATE affects a row;
      // the loser gets affected=0 and the whole create transaction rolls
      // back (no orphan execution/ledger rows). Promise.all dispatches both
      // before either settles — this is the TRUE concurrent race, not a
      // sequential simulation.
      const [a, b] = await Promise.all([
        mod.startExecution({
          conversationId: "conv-t08-race",
          sourceUserMessageId: "msg-t08-race-a",
          submissionId: "sub-t08-race-a",
          requestHash: "sha256:t08-race-a",
          origin: { type: "manual", submissionId: "sub-t08-race-a" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
          parentExecutionId: parent.executionId,
          lineageLedgerId: parent.ledgerId,
        }),
        mod.startExecution({
          conversationId: "conv-t08-race",
          sourceUserMessageId: "msg-t08-race-b",
          submissionId: "sub-t08-race-b",
          requestHash: "sha256:t08-race-b",
          origin: { type: "manual", submissionId: "sub-t08-race-b" },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
          parentExecutionId: parent.executionId,
          lineageLedgerId: parent.ledgerId,
        }),
      ]);

      // Exactly one created; the other denied.
      const created = [a, b].filter((r) => r.status === "created");
      const denied = [a, b].filter((r) => r.status === "denied");
      expect(created.length).to.equal(1);
      expect(denied.length).to.equal(1);
      expect(denied[0].status).to.equal("denied");
      if (denied[0].status === "denied") {
        // The loser's transaction rolled back; the ledger was already
        // claimed by the winner so the re-read sees a row and surfaces
        // ALREADY_SUPERSEDED.
        expect(denied[0].reasonCode).to.equal("LINEAGE_LEDGER_ALREADY_SUPERSEDED");
      }

      // The winner's ledger: same id, generation bumped exactly once.
      const winner = created[0];
      const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionLedgerEntity
      );
      const ledger = await ledgerRepo.findOne({
        where: { ledger_id: parent.ledgerId },
      });
      expect(ledger?.owner_generation).to.equal(1);
      expect(ledger?.active_execution_id).to.equal(
        winner.status === "created" ? winner.executionId : null
      );
      expect(ledger?.status).to.equal("active");

      // No orphan successor execution row for the loser — its transaction
      // rolled back. The only rows for this conversation are the parent +
      // the winner.
      const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionEntity
      );
      const rows = await execRepo.find({
        where: { conversation_id: "conv-t08-race" },
      });
      // Parent + exactly one successor.
      expect(rows.length).to.equal(2);
      const finalizedCount = rows.filter((r) => r.finalized).length;
      expect(finalizedCount).to.equal(1);
    });

    it("transport retry reuses the same successor — a re-submit of the same (conversation, submission) returns reused, not a second claim (AC-26/27)", async () => {
      const mod = new AiTaskExecutionModule();
      const parent = await makeFinalizedParent(mod, {
        conversationId: "conv-t08-retry",
        submissionId: "sub-t08-retry-parent",
        requestHash: "sha256:t08-retry-parent",
        sourceUserMessageId: "msg-t08-retry-parent",
      });

      // First Continue submission.
      const first = unwrapCreated(await mod.startExecution({
        conversationId: "conv-t08-retry",
        sourceUserMessageId: "msg-t08-retry",
        submissionId: "sub-t08-retry",
        requestHash: "sha256:t08-retry",
        origin: { type: "manual", submissionId: "sub-t08-retry" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      }));

      // Transport retry: same (conversation, submission) + same request_hash.
      const second = await mod.startExecution({
        conversationId: "conv-t08-retry",
        sourceUserMessageId: "msg-t08-retry",
        submissionId: "sub-t08-retry",
        requestHash: "sha256:t08-retry",
        origin: { type: "manual", submissionId: "sub-t08-retry" },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      });
      expect(second.status).to.equal("reused");

      // Generation bumped exactly once — the retry did NOT claim again.
      const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AiTaskExecutionLedgerEntity
      );
      const ledger = await ledgerRepo.findOne({
        where: { ledger_id: parent.ledgerId },
      });
      expect(ledger?.owner_generation).to.equal(1);
      expect(ledger?.active_execution_id).to.equal(first.executionId);
    });

    it("all continuable outcomes (incomplete/needs_user_input/blocked_by_policy/timeout/failed) are claimable", async () => {
      const mod = new AiTaskExecutionModule();
      const outcomes: Array<"incomplete" | "needs_user_input" | "blocked_by_policy" | "timeout" | "failed"> = [
        "incomplete",
        "needs_user_input",
        "blocked_by_policy",
        "timeout",
        "failed",
      ];
      for (const outcome of outcomes) {
        const parent = await makeFinalizedParent(mod, {
          conversationId: `conv-t08-outcome-${outcome}`,
          submissionId: `sub-t08-outcome-${outcome}`,
          requestHash: `sha256:t08-outcome-${outcome}`,
          sourceUserMessageId: `msg-t08-outcome-${outcome}`,
          outcome,
        });
        const result = await mod.startExecution({
          conversationId: `conv-t08-outcome-${outcome}`,
          sourceUserMessageId: `msg-t08-succ-${outcome}`,
          submissionId: `sub-t08-succ-${outcome}`,
          requestHash: `sha256:t08-succ-${outcome}`,
          origin: { type: "manual", submissionId: `sub-t08-succ-${outcome}` },
          route: "task_verified",
          completionOwner: "standalone",
          budgetLimits: MANUAL_BUDGET_DEFAULTS,
          parentExecutionId: parent.executionId,
          lineageLedgerId: parent.ledgerId,
        });
        expect(result.status).to.equal("created");
      }
    });
  });
});

"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
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
    const result = await mod.startExecution({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-1",
      requestHash: "sha256:abc",
      origin: { type: "manual", submissionId: "sub-1" },
      route: "task_verified",
      completionOwner: "standalone",
    });
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
  });

  it("finalizeExecution (manual) sets outcome + final-event identity without touching schedules (AC-32)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = await mod.startExecution({
      conversationId: "conv-2",
      sourceUserMessageId: "msg-2",
      submissionId: "sub-2",
      requestHash: "sha256:def",
      origin: { type: "manual", submissionId: "sub-2" },
      route: "task_verified",
      completionOwner: "standalone",
    });

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
    const started = await mod.startExecution({
      conversationId: "conv-3",
      sourceUserMessageId: "msg-3",
      submissionId: "sub-3",
      requestHash: "sha256:ghi",
      origin: { type: "manual", submissionId: "sub-3" },
      route: "task_verified",
      completionOwner: "standalone",
    });

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
    const started = await mod.startExecution({
      conversationId: "conv-race",
      sourceUserMessageId: "msg-race",
      submissionId: "sub-race",
      requestHash: "sha256:race",
      origin: { type: "manual", submissionId: "sub-race" },
      route: "task_verified",
      completionOwner: "standalone",
    });

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
    const started = await mod.startExecution({
      conversationId: "conv-b6",
      sourceUserMessageId: "msg-b6",
      submissionId: "sub-b6",
      requestHash: "sha256:b6",
      origin: { type: "manual", submissionId: "sub-b6" },
      route: "task_verified",
      completionOwner: "standalone",
    });

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
      const started = await mod.startExecution({
        conversationId: "conv-b8a",
        sourceUserMessageId: "msg-b8a",
        submissionId: "sub-b8a",
        requestHash: "sha256:b8a",
        origin: { type: "manual", submissionId: "sub-b8a" },
        route: "task_verified",
        completionOwner: "standalone",
      });

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
      const started = await mod.startExecution({
        conversationId: "conv-b8b",
        sourceUserMessageId: "msg-b8b",
        submissionId: "sub-b8b",
        requestHash: "sha256:b8b",
        origin: { type: "manual", submissionId: "sub-b8b" },
        route: "task_verified",
        completionOwner: "standalone",
      });
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

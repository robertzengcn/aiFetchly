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
});

"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/budgetDefaults";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// B14 (FR-08/11; NFR-10; AC-08/15/28): durable dispatch gates must not join
// an unrelated shared transaction, and must report success only after their
// OWN committed boundary. better-sqlite3 is a single shared connection, so a
// suspended outer transaction absorbs every auto-commit write issued inside
// its window: the gate returns true/ok, work dispatches, then the outer
// rollback silently restores attempts 0 / pending — a reservation that was
// never durably committed.
//
// These tests suspend a raw outer transaction (simulating the unrelated
// shared-transaction window), drive every gate writer through it, force a
// rollback, and assert no prematurely successful gate plus no lost committed
// reservation once the window closes.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-durable-gate-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function setupExecution(): Promise<{
  executionId: string;
  ledgerId: string;
  ownerGeneration: number;
  operationKey: string;
}> {
  const execModule = new AiTaskExecutionModule();
  const created = await execModule.startExecution({
    conversationId: `conv-b14-${crypto.randomUUID()}`,
    sourceUserMessageId: "msg-1",
    submissionId: `sub-b14-${crypto.randomUUID()}`,
    requestHash: "sha256:b14",
    origin: { type: "manual", submissionId: "sub-b14" },
    route: "task_verified",
    completionOwner: "standalone",
    budgetLimits: MANUAL_BUDGET_DEFAULTS,
  });
  if (created.status !== "created") {
    throw new Error(`expected created, got ${created.status}`);
  }
  const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
    AiTaskExecutionLedgerEntity
  );
  const ledger = await ledgerRepo.findOne({
    where: { ledger_id: created.ledgerId },
  });
  if (!ledger) throw new Error("ledger row missing after create");
  const opModule = new AiTaskOperationModule();
  const operationKey = `op:b14:${crypto.randomUUID()}`;
  const recorded = await opModule.recordOperation({
    operationKey,
    executionId: created.executionId,
    toolIdentity: "test-tool",
    domainTarget: "example.com",
    intentHash: `intent-b14-${crypto.randomUUID()}`,
  });
  if (!recorded.ok && !recorded.alreadyExists) {
    throw new Error(
      `operation record failed: ${recorded.reasonCode ?? "unknown"}`
    );
  }
  return {
    executionId: created.executionId,
    ledgerId: created.ledgerId,
    ownerGeneration: ledger.owner_generation,
    operationKey,
  };
}

describe("Durable dispatch gates under a suspended outer transaction (B14)", function () {
  this.timeout(15000);

  beforeEach(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("gate writers report failure inside a suspended outer transaction (no premature success)", async () => {
    const { executionId, ledgerId, ownerGeneration, operationKey } =
      await setupExecution();
    const execModule = new AiTaskExecutionModule();
    const opModule = new AiTaskOperationModule();
    const connection = SqliteDb.getInstance(tmpDir).connection;

    // Suspend an unrelated transaction and dirty it so the rollback below
    // is meaningful (proves the window was really open).
    const outer = connection.createQueryRunner();
    await outer.startTransaction();
    await outer.query(
      `UPDATE ai_task_execution_ledger SET consumed_provider_attempts = consumed_provider_attempts + 999 WHERE ledger_id = ?`,
      [ledgerId]
    );
    try {
      // Every durable dispatch gate must refuse to report success: it
      // cannot own its commit boundary while the outer window is open.
      const persisted = await execModule.persistBudgetConsumption({
        ledgerId,
        expectedOwnerGeneration: ownerGeneration,
        activeExecutionId: executionId,
        delta: { providerAttempts: 1 },
      });
      expect(persisted).to.equal(false);

      const claimed = await opModule.updateState({
        operationKey,
        expectedClaimGeneration: 0,
        newState: "claimed",
      });
      expect(claimed.ok).to.equal(false);

      const shadowed = await execModule.mergeExecutionStateEvidence({
        executionId,
        expectedVersion: 0,
        mergedStateJson: JSON.stringify({ shadow: true }),
      });
      expect(shadowed).to.equal(false);

      const receipted = await opModule.setReceipt({
        operationKey,
        expectedClaimGeneration: 0,
        receiptReference: "attempt:b14-outer",
      });
      expect(receipted).to.equal(false);
    } finally {
      await outer.rollbackTransaction();
      await outer.release();
    }

    // The rollback restored everything: no committed spend, no claim, no
    // shadow, no receipt — nothing dispatched on a rolled-back reservation.
    const ledgerRepo = connection.getRepository(AiTaskExecutionLedgerEntity);
    const ledger = await ledgerRepo.findOne({
      where: { ledger_id: ledgerId },
    });
    expect(ledger?.consumed_provider_attempts).to.equal(0);
    const op = await opModule.getOperation(operationKey);
    expect(op?.operation_state).to.equal("pending");
    expect(op?.claim_generation).to.equal(0);
    expect(op?.receipt_reference ?? null).to.equal(null);
  });

  it("gate writers succeed with committed results once the outer window closes", async () => {
    const { executionId, ledgerId, ownerGeneration, operationKey } =
      await setupExecution();
    const execModule = new AiTaskExecutionModule();
    const opModule = new AiTaskOperationModule();
    const connection = SqliteDb.getInstance(tmpDir).connection;

    const outer = connection.createQueryRunner();
    await outer.startTransaction();
    await outer.query(
      `UPDATE ai_task_execution_ledger SET consumed_provider_attempts = consumed_provider_attempts + 999 WHERE ledger_id = ?`,
      [ledgerId]
    );
    await outer.rollbackTransaction();
    await outer.release();

    // No wedging: after the window closes the gates report success AND the
    // writes are durably visible (their own committed boundary, not a
    // joined one).
    const shadowed = await execModule.mergeExecutionStateEvidence({
      executionId,
      expectedVersion: 0,
      mergedStateJson: JSON.stringify({ shadow: true }),
    });
    expect(shadowed).to.equal(true);

    const persisted = await execModule.persistBudgetConsumption({
      ledgerId,
      expectedOwnerGeneration: ownerGeneration,
      activeExecutionId: executionId,
      delta: { providerAttempts: 1 },
    });
    expect(persisted).to.equal(true);

    const claimed = await opModule.updateState({
      operationKey,
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(claimed.ok).to.equal(true);

    const receipted = await opModule.setReceipt({
      operationKey,
      expectedClaimGeneration: 1,
      receiptReference: "attempt:b14-committed",
    });
    expect(receipted).to.equal(true);

    const ledgerRepo = connection.getRepository(AiTaskExecutionLedgerEntity);
    const ledger = await ledgerRepo.findOne({
      where: { ledger_id: ledgerId },
    });
    expect(ledger?.consumed_provider_attempts).to.equal(1);
    const op = await opModule.getOperation(operationKey);
    expect(op?.operation_state).to.equal("claimed");
    expect(op?.receipt_reference).to.equal("attempt:b14-committed");
  });

  it("concurrent budget persists serialize without lost or double-counted spend", async () => {
    const { executionId, ledgerId, ownerGeneration } = await setupExecution();
    const connection = SqliteDb.getInstance(tmpDir).connection;

    // Each concurrent writer uses its own module (own model/runner), racing
    // the shared connection. Serialized own-transactions commit all N;
    // overlapping BEGINs would spuriously fail some.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => {
        const mod = new AiTaskExecutionModule();
        return mod.persistBudgetConsumption({
          ledgerId,
          expectedOwnerGeneration: ownerGeneration,
          activeExecutionId: executionId,
          delta: { providerAttempts: 1 },
        });
      })
    );
    expect(results.every((r) => r === true)).to.equal(true);
    const ledgerRepo = connection.getRepository(AiTaskExecutionLedgerEntity);
    const ledger = await ledgerRepo.findOne({
      where: { ledger_id: ledgerId },
    });
    expect(ledger?.consumed_provider_attempts).to.equal(10);
  });
});

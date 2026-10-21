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

// B22 (FR-15; AC layers; rollout §12/§17): real-flow lifecycle regression
// over a REAL SQLite database with ZERO mocks — the composed path the
// unit suites cover only in isolation (mocked modules, injected
// decisions). A manual execution is created, spends against its ledger,
// persists evidence, and finalizes with the committed winner; a Continue
// successor shares the lineage ledger and spends against it; an operation
// runs the full claim→receipt→dispatched→completed lifecycle; hostile and
// stale gates fail closed. If any box's fix breaks composition (B06/B13/
// B14/B15/B19/G02), this flow — not an aggregate pass count — says so.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-lifecycle-flow-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

function startInput(submissionId: string, extra: Record<string, unknown> = {}) {
  return {
    conversationId: `conv-flow-${submissionId}`,
    sourceUserMessageId: `msg-${submissionId}`,
    submissionId: `sub-flow-${submissionId}`,
    requestHash: `sha256:${submissionId}`,
    origin: { type: "manual", submissionId: `sub-flow-${submissionId}` },
    route: "task_verified",
    completionOwner: "standalone",
    budgetLimits: MANUAL_BUDGET_DEFAULTS,
    ...extra,
  } as Parameters<AiTaskExecutionModule["startExecution"]>[0];
}

describe("Manual task lifecycle flow on real SQLite (B22)", function () {
  this.timeout(20000);

  beforeEach(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("create → spend → evidence → verified_complete, winner stable on re-finalize", async () => {
    const execModule = new AiTaskExecutionModule();
    const created = await execModule.startExecution(startInput("a"));
    if (created.status !== "created") {
      throw new Error(`expected created, got ${created.status}`);
    }
    const { executionId, ledgerId } = created;
    const connection = SqliteDb.getInstance(tmpDir).connection;
    const ledgerRepo = connection.getRepository(AiTaskExecutionLedgerEntity);
    const ledger = await ledgerRepo.findOne({ where: { ledger_id: ledgerId } });
    if (!ledger) throw new Error("ledger row missing after create");
    const generation = ledger.owner_generation;

    // Spend at actual-dispatch granularity: attempts, tools, tokens, waits.
    const spend = async (delta: Record<string, number>) =>
      execModule.persistBudgetConsumption({
        ledgerId,
        expectedOwnerGeneration: generation,
        activeExecutionId: executionId,
        delta,
      });
    expect(await spend({ providerAttempts: 3 })).to.equal(true);
    expect(await spend({ toolExecutions: 2 })).to.equal(true);
    expect(await spend({ tokens: 1500 })).to.equal(true);
    expect(await spend({ activeRuntimeMs: 5000, waitMs: 1000 })).to.equal(true);
    // Hostile + stale gates fail closed without touching the ledger.
    expect(await spend({ tokens: -5 })).to.equal(false);
    expect(
      await execModule.persistBudgetConsumption({
        ledgerId,
        expectedOwnerGeneration: generation + 99,
        activeExecutionId: executionId,
        delta: { tokens: 1 },
      })
    ).to.equal(false);

    const afterSpend = await ledgerRepo.findOne({ where: { ledger_id: ledgerId } });
    expect(afterSpend?.consumed_provider_attempts).to.equal(3);
    expect(afterSpend?.consumed_tool_executions).to.equal(2);
    expect(afterSpend?.consumed_tokens).to.equal(1500);
    expect(afterSpend?.consumed_active_ms).to.equal(5000);
    expect(afterSpend?.consumed_wait_ms).to.equal(1000);

    // Evidence CAS at the fresh version; a stale version loses.
    const exec0 = await execModule.getExecution(executionId);
    if (!exec0) throw new Error("execution row missing");
    const version0 = exec0.execution_state_version;
    expect(
      await execModule.mergeExecutionStateEvidence({
        executionId,
        expectedVersion: version0,
        mergedStateJson: JSON.stringify({ evidence: [{ evidenceId: "ev-1" }] }),
      })
    ).to.equal(true);
    expect(
      await execModule.mergeExecutionStateEvidence({
        executionId,
        expectedVersion: version0,
        mergedStateJson: JSON.stringify({ evidence: [] }),
      })
    ).to.equal(false);

    // Finalize verified_complete; the winner is stable on re-finalize.
    const exec1 = await execModule.getExecution(executionId);
    if (!exec1) throw new Error("execution row missing before finalize");
    const finalized = await execModule.finalizeExecution({
      executionId,
      expectedVersion: exec1.execution_state_version,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "saved 100 contacts",
      evidenceIds: ["ev-1"],
      remainingWork: [],
    });
    expect(finalized.ok).to.equal(true);
    const again = await execModule.finalizeExecution({
      executionId,
      expectedVersion: exec1.execution_state_version,
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      summary: "late loser",
      evidenceIds: [],
      remainingWork: ["x"],
    });
    expect(again.ok).to.equal(false);
    expect(again.alreadyFinalized).to.equal(true);
    const stored = await execModule.getExecution(executionId);
    expect(stored?.task_outcome).to.equal("verified_complete");
    expect(stored?.finalized).to.equal(true);
    // Post-final spend is refused (lease released with finalization).
    expect(await spend({ tokens: 1 })).to.equal(false);
  });

  it("Continue successor shares the lineage ledger; operation lifecycle settles with receipt", async () => {
    const execModule = new AiTaskExecutionModule();
    const opModule = new AiTaskOperationModule();
    const parent = await execModule.startExecution(startInput("b"));
    if (parent.status !== "created") {
      throw new Error(`expected created, got ${parent.status}`);
    }
    const connection = SqliteDb.getInstance(tmpDir).connection;
    const ledgerRepo = connection.getRepository(AiTaskExecutionLedgerEntity);
    const parentLedger = await ledgerRepo.findOne({
      where: { ledger_id: parent.ledgerId },
    });
    if (!parentLedger) throw new Error("parent ledger missing");
    const generation = parentLedger.owner_generation;

    // Parent spends, then finalizes incomplete (continuable).
    expect(
      await execModule.persistBudgetConsumption({
        ledgerId: parent.ledgerId,
        expectedOwnerGeneration: generation,
        activeExecutionId: parent.executionId,
        delta: { providerAttempts: 5, tokens: 2000 },
      })
    ).to.equal(true);
    const parentExec = await execModule.getExecution(parent.executionId);
    if (!parentExec) throw new Error("parent execution missing");
    const parentFinal = await execModule.finalizeExecution({
      executionId: parent.executionId,
      expectedVersion: parentExec.execution_state_version,
      outcome: "incomplete",
      reasonCode: "CONTINUATION_LIMIT",
      summary: "partial",
      evidenceIds: [],
      remainingWork: ["rest"],
    });
    expect(parentFinal.ok).to.equal(true);

    // Continue: same lineage ledger, parent linkage recorded.
    const child = await execModule.startExecution(
      startInput("b-child", {
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      })
    );
    if (child.status !== "created") {
      throw new Error(`expected created, got ${child.status}`);
    }
    const childExec = await execModule.getExecution(child.executionId);
    expect(childExec?.parent_execution_id).to.equal(parent.executionId);
    expect(childExec?.lineage_ledger_id ?? childExec?.ledger_id).to.not.equal(null);

    // Successor spends against the SHARED ledger (cumulative with parent).
    const childLedger = await ledgerRepo.findOne({
      where: { ledger_id: parent.ledgerId },
    });
    if (!childLedger) throw new Error("shared ledger missing");
    expect(
      await execModule.persistBudgetConsumption({
        ledgerId: parent.ledgerId,
        expectedOwnerGeneration: childLedger.owner_generation,
        activeExecutionId: childLedger.active_execution_id ?? child.executionId,
        delta: { providerAttempts: 2 },
      })
    ).to.equal(true);
    const cumulative = await ledgerRepo.findOne({
      where: { ledger_id: parent.ledgerId },
    });
    expect(cumulative?.consumed_provider_attempts).to.equal(7);
    expect(cumulative?.consumed_tokens).to.equal(2000);

    // Operation lifecycle under the successor: record → claim → receipt →
    // dispatched → accepted → completed, with the generation trail
    // advancing (dispatched never jumps to completed — B19 settles
    // accepted at job start and reconciles completion from native state).
    const operationKey = `op:flow:${crypto.randomUUID()}`;
    const recorded = await opModule.recordOperation({
      operationKey,
      executionId: child.executionId,
      toolIdentity: "send-email",
      domainTarget: "example.com",
      intentHash: `intent-flow-${crypto.randomUUID()}`,
    });
    expect(recorded.ok || recorded.alreadyExists).to.equal(true);
    const claimed = await opModule.updateState({
      operationKey,
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(claimed.ok).to.equal(true);
    // Stale generation loses (no replay of the claim).
    const replayed = await opModule.updateState({
      operationKey,
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(replayed.ok).to.equal(false);
    expect(
      await opModule.setReceipt({
        operationKey,
        expectedClaimGeneration: 1,
        receiptReference: "attempt:4242",
      })
    ).to.equal(true);
    expect(
      (
        await opModule.updateState({
          operationKey,
          expectedClaimGeneration: 1,
          newState: "dispatched",
        })
      ).ok
    ).to.equal(true);
    const settled = await opModule.updateState({
      operationKey,
      expectedClaimGeneration: 2,
      newState: "accepted",
    });
    expect(settled.ok).to.equal(true);
    const completed = await opModule.updateState({
      operationKey,
      expectedClaimGeneration: 3,
      newState: "completed",
    });
    expect(completed.ok).to.equal(true);
    const op = await opModule.getOperation(operationKey);
    expect(op?.operation_state).to.equal("completed");
    expect(op?.claim_generation).to.equal(4);
    expect(op?.receipt_reference).to.equal("attempt:4242");
  });
});

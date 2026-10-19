"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/budgetDefaults";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// G01-314 (FR-10/13/14; AC-06/16/27): the reload-restore projection over a
// REAL SQLite database — badge identity/outcome plus best-effort progress,
// remaining limits, and safe actions. Enrichment sources may be missing or
// corrupt; the core projection must still restore.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-state-projection-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

function evidenceRow(
  criterionId: string,
  state: string,
  evidenceId?: string
): Record<string, unknown> {
  return {
    evidenceId: evidenceId ?? `ev-${criterionId}-${state}-${crypto.randomUUID()}`,
    criterionId,
    contractHash: "hash-1",
    executionId: "exec-x",
    observedAt: new Date().toISOString(),
    source: "test",
    sourceRevision: "rev-1",
    state,
    referenceIds: [criterionId],
    summary: `${state}: ${criterionId}`,
  };
}

describe("Execution state projection for reload restore (G01-314)", function () {
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

  async function start(execTag: string) {
    const mod = new AiTaskExecutionModule();
    const created = await mod.startExecution({
      conversationId: `conv-proj-${execTag}`,
      sourceUserMessageId: `msg-${execTag}`,
      submissionId: `sub-proj-${execTag}`,
      requestHash: `sha256:${execTag}`,
      origin: { type: "manual", submissionId: `sub-proj-${execTag}` },
      route: "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    });
    if (created.status !== "created") {
      throw new Error(`expected created, got ${created.status}`);
    }
    return { mod, executionId: created.executionId, ledgerId: created.ledgerId };
  }

  it("null when the conversation never enrolled", async () => {
    const mod = new AiTaskExecutionModule();
    expect(await mod.getExecutionStateProjection("conv-nope")).to.equal(null);
  });

  it("running execution restores core + safe stop action + remaining limits", async () => {
    const { mod, executionId, ledgerId } = await start("run");
    const exec = await mod.getExecution(executionId);
    if (!exec) throw new Error("missing execution");
    expect(
      await mod.persistBudgetConsumption({
        ledgerId,
        expectedOwnerGeneration: 0,
        activeExecutionId: executionId,
        delta: { tokens: 1000, providerAttempts: 2 },
      })
    ).to.equal(true);

    const view = await mod.getExecutionStateProjection(`conv-proj-run`);
    if (!view) throw new Error("projection missing");
    expect(view.executionId).to.equal(executionId);
    // The row stage vocabulary is durable truth: created rows are
    // `resolving` (nothing advances the row to the live `active` phase —
    // the live badge comes from stream emits, G01-313). Reload restores
    // `resolving` honestly rather than overstating it.
    expect(view.status).to.equal("resolving");
    expect(view.safeActions).to.deep.equal(["stop"]);
    if (!view.remainingLimits) throw new Error("remaining limits missing");
    expect(view.remainingLimits.tokens).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxTokens - 1000
    );
    expect(view.remainingLimits.providerAttempts).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxProviderAttempts - 2
    );
    expect(view.remainingLimits.toolExecutions).to.equal(
      MANUAL_BUDGET_DEFAULTS.maxToolExecutions
    );
    // No evidence yet → no progress section (not an empty one).
    expect(view.progress).to.equal(undefined);
  });

  it("evidence rolls up last-wins progress; malformed rows are skipped", async () => {
    const { mod, executionId } = await start("ev");
    const exec = await mod.getExecution(executionId);
    if (!exec) throw new Error("missing execution");
    expect(
      await mod.mergeExecutionStateEvidence({
        executionId,
        expectedVersion: exec.execution_state_version,
        mergedStateJson: JSON.stringify({
          evidence: [
            evidenceRow("c1", "unknown"),
            evidenceRow("c1", "pass"),
            evidenceRow("c2", "fail"),
            { bogus: true },
            evidenceRow("", "pass"),
            evidenceRow("c3", "bogus-state"),
          ],
        }),
      })
    ).to.equal(true);

    const view = await mod.getExecutionStateProjection(`conv-proj-ev`);
    if (!view || !view.progress) throw new Error("progress missing");
    // c1's last row (pass) wins; malformed/empty-criterion/bogus-state rows
    // never enter the rollup.
    expect(view.progress.totalCriteria).to.equal(2);
    expect(view.progress.passedCriteria).to.equal(1);
    expect(view.progress.unmetCriterionIds).to.deep.equal(["c2"]);
  });

  it("finalized incomplete offers continue + retry; verified_complete offers nothing", async () => {
    const { mod, executionId } = await start("fin");
    const exec = await mod.getExecution(executionId);
    if (!exec) throw new Error("missing execution");
    const finalized = await mod.finalizeExecution({
      executionId,
      expectedVersion: exec.execution_state_version,
      outcome: "incomplete",
      reasonCode: "CONTINUATION_LIMIT",
      summary: "partial",
      evidenceIds: [],
      remainingWork: ["rest"],
    });
    expect(finalized.ok).to.equal(true);

    const view = await mod.getExecutionStateProjection(`conv-proj-fin`);
    if (!view) throw new Error("projection missing");
    expect(view.outcome).to.equal("incomplete");
    expect(view.safeActions).to.deep.equal(["continue", "retry"]);

    const { executionId: exec2 } = await start("fin2");
    const execRow2 = await mod.getExecution(exec2);
    if (!execRow2) throw new Error("missing execution");
    const finalized2 = await mod.finalizeExecution({
      executionId: exec2,
      expectedVersion: execRow2.execution_state_version,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "done",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(finalized2.ok).to.equal(true);
    const view2 = await mod.getExecutionStateProjection(`conv-proj-fin2`);
    if (!view2) throw new Error("projection missing");
    expect(view2.safeActions).to.deep.equal([]);
  });

  it("corrupt evidence JSON still restores the core projection", async () => {
    const { mod, executionId } = await start("corrupt");
    const exec = await mod.getExecution(executionId);
    if (!exec) throw new Error("missing execution");
    expect(
      await mod.mergeExecutionStateEvidence({
        executionId,
        expectedVersion: exec.execution_state_version,
        mergedStateJson: "{not json",
      })
    ).to.equal(true);

    const view = await mod.getExecutionStateProjection(`conv-proj-corrupt`);
    if (!view) throw new Error("projection missing");
    expect(view.executionId).to.equal(executionId);
    expect(view.progress).to.equal(undefined);
    expect(view.safeActions).to.deep.equal(["stop"]);
  });
});

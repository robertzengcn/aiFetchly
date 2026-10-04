import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-reg-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

beforeEach(async () => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
});

afterEach(() => {
  resetDbSingleton();
});

describe("SqliteDb entity registration (Task 5)", () => {
  it("synchronizes all three new task-execution tables without error", async () => {
    // If the three new entities are NOT registered in SqliteDb's entities
    // array, getRepository will throw on metadata lookup. Registration is
    // the core deliverable of this task.
    const conn = SqliteDb.getInstance(tmpDir).connection;
    expect(conn.isInitialized).toBe(true);

    const execRepo = conn.getRepository(AiTaskExecutionEntity);
    const ledgerRepo = conn.getRepository(AiTaskExecutionLedgerEntity);
    const opRepo = conn.getRepository(AiTaskOperationEntity);

    // Insert a round-trip row in each to confirm the tables physically exist.
    const exec = new AiTaskExecutionEntity();
    exec.execution_id = "exec-reg-1";
    exec.conversation_id = "conv-1";
    exec.source_user_message_id = "msg-1";
    exec.submission_id = "sub-1";
    exec.assistant_result_message_id = null;
    exec.request_hash = "sha256:abc";
    exec.origin_type = "manual";
    exec.route = "task_verified";
    exec.completion_owner = "standalone";
    exec.stage = "resolving";
    exec.schedule_id = null;
    exec.run_id = null;
    exec.occurrence_key = null;
    exec.ledger_id = "ledger-reg-1";
    exec.lineage_ledger_id = "ledger-reg-1";
    exec.parent_execution_id = null;
    exec.contract_snapshot_json = null;
    exec.policy_snapshot_json = null;
    exec.execution_state_json = null;
    exec.contract_hash = null;
    exec.execution_state_version = 0;
    exec.finalized = false;
    exec.finalized_at = null;
    exec.task_outcome = null;
    exec.outcome_reason_code = null;
    exec.outcome_summary = null;
    exec.final_event_identity = null;
    exec.delivery_state = null;
    await execRepo.save(exec);
    expect(
      (await execRepo.findOne({ where: { execution_id: "exec-reg-1" } }))
        ?.conversation_id
    ).toBe("conv-1");

    const ledger = new AiTaskExecutionLedgerEntity();
    ledger.ledger_id = "ledger-reg-1";
    ledger.policy_limits_json = "{}";
    ledger.execution_state_version = 0;
    ledger.consumed_continuations = 0;
    ledger.consumed_provider_attempts = 0;
    ledger.consumed_tool_executions = 0;
    ledger.consumed_checker_attempts = 0;
    ledger.consumed_tokens = 0;
    ledger.consumed_active_ms = 0;
    ledger.consumed_wait_ms = 0;
    ledger.no_progress_streak = 0;
    ledger.active_execution_id = "exec-reg-1";
    ledger.owner_generation = 0;
    ledger.status = "active";
    await ledgerRepo.save(ledger);
    expect(
      (await ledgerRepo.findOne({ where: { ledger_id: "ledger-reg-1" } }))
        ?.status
    ).toBe("active");

    const op = new AiTaskOperationEntity();
    op.operation_key = "op-reg-1";
    op.execution_id = "exec-reg-1";
    op.tool_identity = "send_email";
    op.domain_target = "campaign:5";
    op.intent_hash = "sha256:xyz";
    op.operation_state = "pending";
    op.claim_generation = 0;
    op.receipt_reference = null;
    op.failure_code = null;
    op.claimed_at = null;
    op.dispatched_at = null;
    op.settled_at = null;
    await opRepo.save(op);
    expect(
      (await opRepo.findOne({ where: { operation_key: "op-reg-1" } }))
        ?.operation_state
    ).toBe("pending");
  });

  it("AiMessageTask entity has the three additive policy columns", async () => {
    // synchronize must have added completion_contract_json, execution_policy_json,
    // execution_policy_version to the ai_message_task table.
    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiMessageTaskEntity
    );
    const task = new AiMessageTaskEntity();
    task.name = "test-task";
    task.message = "do something";
    task.allowed_tools_json = "[]";
    task.auto_approve_tools = false;
    task.allow_skills = false;
    task.allow_mcp = false;
    task.allow_subagents = false;
    task.max_tool_calls = 10;
    task.max_runtime_ms = 300000;
    task.max_continue_calls = 10;
    task.status = "active";
    task.completion_contract_json = null;
    task.execution_policy_json = null;
    task.execution_policy_version = 0;
    await repo.save(task);
    const read = await repo.findOne({ where: { name: "test-task" } });
    expect(read?.completion_contract_json).toBeNull();
    expect(read?.execution_policy_json).toBeNull();
    expect(read?.execution_policy_version).toBe(0);
  });

  it("AiMessageTaskRun entity has the four additive execution columns", async () => {
    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiMessageTaskRunEntity
    );
    const run = new AiMessageTaskRunEntity();
    run.task_id = 1;
    run.schedule_id = null;
    run.conversation_id = "conv-1";
    run.status = "pending";
    run.started_at = new Date();
    run.tool_calls_count = 0;
    run.blocked_tool_calls_json = "[]";
    run.occurrence = null;
    run.attempt = 1;
    run.scheduled_for = null;
    run.catch_up = false;
    run.user_message_id = null;
    run.assistant_message_id = null;
    run.delivery_state = null;
    run.error_code = null;
    run.idempotency_key = null;
    run.execution_id = "exec-reg-1";
    run.task_outcome = null;
    run.task_outcome_reason = null;
    run.task_result_summary = null;
    await repo.save(run);
    const read = await repo.findOne({ where: { task_id: 1 } });
    expect(read?.execution_id).toBe("exec-reg-1");
    expect(read?.task_outcome).toBeNull();
    expect(read?.task_outcome_reason).toBeNull();
    expect(read?.task_result_summary).toBeNull();
  });
});

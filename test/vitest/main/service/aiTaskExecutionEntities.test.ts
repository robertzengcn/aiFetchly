import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import AuditableEntity from "@/entity/Auditable.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-entities-${crypto.randomUUID()}`
);

let dataSource: DataSource;

beforeEach(async () => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  dataSource = new DataSource({
    type: "better-sqlite3",
    database: path.join(tmpDir, "test.db"),
    synchronize: true,
    entities: [
      AiTaskExecutionEntity,
      AiTaskExecutionLedgerEntity,
      AiTaskOperationEntity,
      AuditableEntity,
    ],
  });
  await dataSource.initialize();
});

afterEach(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

describe("AiTaskExecution entity schema (synchronize + roundtrip)", () => {
  it("creates and reads back an execution row with the expected shape", async () => {
    const repo = dataSource.getRepository(AiTaskExecutionEntity);
    const exec = new AiTaskExecutionEntity();
    exec.execution_id = "exec-test-1";
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
    exec.ledger_id = "ledger-test-1";
    exec.lineage_ledger_id = "ledger-test-1";
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
    const saved = await repo.save(exec);
    expect(saved.id).toBeGreaterThan(0);

    const read = await repo.findOne({ where: { execution_id: "exec-test-1" } });
    expect(read?.conversation_id).toBe("conv-1");
    expect(read?.origin_type).toBe("manual");
    expect(read?.route).toBe("task_verified");
    expect(read?.completion_owner).toBe("standalone");
    expect(read?.stage).toBe("resolving");
    expect(read?.ledger_id).toBe("ledger-test-1");
    expect(read?.lineage_ledger_id).toBe("ledger-test-1");
    expect(read?.finalized).toBe(false);
    expect(read?.execution_state_version).toBe(0);
  });

  it("creates and reads back a ledger row with the expected shape", async () => {
    const repo = dataSource.getRepository(AiTaskExecutionLedgerEntity);
    const ledger = new AiTaskExecutionLedgerEntity();
    ledger.ledger_id = "ledger-test-1";
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
    ledger.active_execution_id = "exec-test-1";
    ledger.owner_generation = 0;
    ledger.status = "active";
    const saved = await repo.save(ledger);
    expect(saved.id).toBeGreaterThan(0);

    const read = await repo.findOne({ where: { ledger_id: "ledger-test-1" } });
    expect(read?.status).toBe("active");
    expect(read?.active_execution_id).toBe("exec-test-1");
    expect(read?.execution_state_version).toBe(0);
  });
});

describe("AiTaskOperation entity schema (synchronize + roundtrip)", () => {
  it("creates and reads back an operation row with the expected shape", async () => {
    const repo = dataSource.getRepository(AiTaskOperationEntity);
    const op = new AiTaskOperationEntity();
    op.operation_key = "op-test-1";
    op.execution_id = "exec-test-1";
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
    const saved = await repo.save(op);
    expect(saved.id).toBeGreaterThan(0);

    const read = await repo.findOne({ where: { operation_key: "op-test-1" } });
    expect(read?.execution_id).toBe("exec-test-1");
    expect(read?.tool_identity).toBe("send_email");
    expect(read?.operation_state).toBe("pending");
    expect(read?.claim_generation).toBe(0);
  });
});

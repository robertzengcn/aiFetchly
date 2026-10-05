"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-task-op-module-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

describe("AiTaskOperationModule scaffolding (Slice 3 prep)", function () {
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

  it("recordOperation creates a row with default claim generation 0", async () => {
    const mod = new AiTaskOperationModule();
    const result = await mod.recordOperation({
      operationKey: "op-key-1",
      executionId: "exec-1",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:xyz",
    });
    expect(result.ok).to.equal(true);

    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskOperationEntity
    );
    const op = await repo.findOne({ where: { operation_key: "op-key-1" } });
    expect(op?.claim_generation).to.equal(0);
    expect(op?.operation_state).to.equal("pending");
  });

  it("recordOperation is idempotent on operation_key (no duplicate)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-key-2",
      executionId: "exec-2",
      toolIdentity: "send_email",
      domainTarget: "campaign:6",
      intentHash: "sha256:xyz2",
    });
    const second = await mod.recordOperation({
      operationKey: "op-key-2",
      executionId: "exec-2",
      toolIdentity: "send_email",
      domainTarget: "campaign:6",
      intentHash: "sha256:xyz2",
    });
    expect(second.alreadyExists).to.equal(true);

    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskOperationEntity
    );
    const count = await repo.count({
      where: { operation_key: "op-key-2" },
    });
    expect(count).to.equal(1);
  });

  it("updateState advances operation_state with claim-generation CAS", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-key-3",
      executionId: "exec-3",
      toolIdentity: "send_email",
      domainTarget: "campaign:7",
      intentHash: "sha256:xyz3",
    });
    const result = await mod.updateState({
      operationKey: "op-key-3",
      expectedClaimGeneration: 0,
      newState: "dispatched",
    });
    expect(result.ok).to.equal(true);
    const op = await mod.getOperation("op-key-3");
    expect(op?.operation_state).to.equal("dispatched");
    expect(op?.claim_generation).to.equal(1);
  });

  it("rejects a same-key create with a changed intent hash (INTENT_CONFLICT, §10.1)", async () => {
    // The canonical intent_hash exists precisely to prevent a changed target
    // from reusing an operation. A same-key create with a different intentHash
    // must return INTENT_CONFLICT, not silent alreadyExists.
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-intent",
      executionId: "exec-1",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:aaa",
    });
    const second = await mod.recordOperation({
      operationKey: "op-intent",
      executionId: "exec-1",
      toolIdentity: "send_email",
      domainTarget: "campaign:6",
      intentHash: "sha256:bbb",
    });
    expect(second.ok).to.equal(false);
    expect(second.reasonCode).to.equal("INTENT_CONFLICT");

    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskOperationEntity
    );
    const op = await repo.findOne({ where: { operation_key: "op-intent" } });
    expect(op?.intent_hash).to.equal("sha256:aaa");
  });

  it("rejects a same-key create with a changed executionId (INTENT_CONFLICT)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-exec",
      executionId: "exec-1",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:same",
    });
    const second = await mod.recordOperation({
      operationKey: "op-exec",
      executionId: "exec-2",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:same",
    });
    expect(second.ok).to.equal(false);
    expect(second.reasonCode).to.equal("INTENT_CONFLICT");
  });

  it("concurrent same-key creates resolve to a typed result, not a raw UNIQUE throw", async () => {
    // Two concurrent creates with the same key both read null, both insert,
    // and the second hits the unique constraint. The catch must return
    // alreadyExists instead of surfacing the raw SQLite error.
    const mod = new AiTaskOperationModule();
    const [a, b] = await Promise.all([
      mod.recordOperation({
        operationKey: "op-concurrent",
        executionId: "exec-c",
        toolIdentity: "send_email",
        domainTarget: "campaign:5",
        intentHash: "sha256:c",
      }),
      mod.recordOperation({
        operationKey: "op-concurrent",
        executionId: "exec-c",
        toolIdentity: "send_email",
        domainTarget: "campaign:5",
        intentHash: "sha256:c",
      }),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const already = [a, b].filter((r) => r.alreadyExists);
    expect(oks.length).to.equal(1);
    expect(already.length).to.equal(1);

    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskOperationEntity
    );
    const count = await repo.count({
      where: { operation_key: "op-concurrent" },
    });
    expect(count).to.equal(1);
  });

  it("updateState returns STATE_CONFLICT on a stale claim generation", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-stale",
      executionId: "exec-s",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:s",
    });
    const result = await mod.updateState({
      operationKey: "op-stale",
      expectedClaimGeneration: 99,
      newState: "dispatched",
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("STATE_CONFLICT");
  });

  it("updateState returns OPERATION_NOT_FOUND for a missing key", async () => {
    const mod = new AiTaskOperationModule();
    const result = await mod.updateState({
      operationKey: "op-missing",
      expectedClaimGeneration: 0,
      newState: "dispatched",
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("OPERATION_NOT_FOUND");
  });

  it("updateState stamps claimed_at on the 'claimed' transition (§10.2)", async () => {
    // Without a 'claimed' branch, claimed_at stays null forever, breaking
    // downstream claim-order audits.
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-claim",
      executionId: "exec-cl",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:cl",
    });
    await mod.updateState({
      operationKey: "op-claim",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    const op = await mod.getOperation("op-claim");
    expect(op?.claimed_at).to.not.equal(null);
  });

  it("refuses DB access from a worker process (NFR-03, assertNotWorker)", async () => {
    // The worker guard must throw under process.env.WORKER_TYPE so a worker
    // process can never corrupt the task-operation tables directly.
    const previous = process.env.WORKER_TYPE;
    process.env.WORKER_TYPE = "test-worker";
    try {
      const mod = new AiTaskOperationModule();
      let threw = false;
      try {
        await mod.recordOperation({
          operationKey: "op-worker",
          executionId: "exec-w",
          toolIdentity: "send_email",
          domainTarget: "campaign:5",
          intentHash: "sha256:w",
        });
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/worker/i);
      }
      expect(threw).to.equal(true);
    } finally {
      if (previous === undefined) delete process.env.WORKER_TYPE;
      else process.env.WORKER_TYPE = previous;
    }
  });
});

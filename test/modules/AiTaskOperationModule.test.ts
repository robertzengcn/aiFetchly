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
});

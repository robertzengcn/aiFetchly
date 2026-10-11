"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import type { CreateOperationResult } from "@/model/AiTaskOperation.model";
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
    // T22 legal-transition machine (design §10.2): the fenced claim
    // (pending → claimed) precedes dispatch — dispatching a pending op
    // skips the claim fence and is rejected.
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-key-3",
      executionId: "exec-3",
      toolIdentity: "send_email",
      domainTarget: "campaign:7",
      intentHash: "sha256:xyz3",
    });
    const claim = await mod.updateState({
      operationKey: "op-key-3",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(claim.ok).to.equal(true);
    const dispatch = await mod.updateState({
      operationKey: "op-key-3",
      expectedClaimGeneration: 1,
      newState: "dispatched",
    });
    expect(dispatch.ok).to.equal(true);
    const op = await mod.getOperation("op-key-3");
    expect(op?.operation_state).to.equal("dispatched");
    expect(op?.claim_generation).to.equal(2);
  });

  it("rejects dispatching a pending operation (claim fence must run first)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-fence",
      executionId: "exec-f",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:f",
    });
    const result = await mod.updateState({
      operationKey: "op-fence",
      expectedClaimGeneration: 0,
      newState: "dispatched",
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("STATE_CONFLICT");
    const op = await mod.getOperation("op-fence");
    expect(op?.operation_state).to.equal("pending");
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
      newState: "claimed",
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("STATE_CONFLICT");
  });

  it("updateState returns OPERATION_NOT_FOUND for a missing key", async () => {
    const mod = new AiTaskOperationModule();
    const result = await mod.updateState({
      operationKey: "op-missing",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("OPERATION_NOT_FOUND");
  });

  it("simultaneous claims of the same generation produce exactly one winner (T22 atomic CAS)", async () => {
    // T22 P1 (audit): the read/check/save claim lets two generation-0
    // claimers both pass the generation check and both save. With an
    // atomic conditional UPDATE (WHERE claim_generation = ?), only one
    // UPDATE matches the row and the other gets STATE_CONFLICT.
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-race",
      executionId: "exec-r",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:r",
    });
    const results = await Promise.all([
      mod.updateState({
        operationKey: "op-race",
        expectedClaimGeneration: 0,
        newState: "claimed",
      }),
      mod.updateState({
        operationKey: "op-race",
        expectedClaimGeneration: 0,
        newState: "claimed",
      }),
    ]);
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners.length).to.equal(1);
    expect(losers.length).to.equal(1);
    for (const loser of losers) {
      expect(loser.reasonCode).to.equal("STATE_CONFLICT");
    }
    const op = await mod.getOperation("op-race");
    expect(op?.claim_generation).to.equal(1);
    expect(op?.operation_state).to.equal("claimed");
  });

  it("rejects an illegal terminal regression (terminal states are sticky, §10.2)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-terminal",
      executionId: "exec-t",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:t",
    });
    // Reach a terminal state legally: pending → claimed → failed.
    const claim = await mod.updateState({
      operationKey: "op-terminal",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(claim.ok).to.equal(true);
    const failed = await mod.updateState({
      operationKey: "op-terminal",
      expectedClaimGeneration: 1,
      newState: "failed",
    });
    expect(failed.ok).to.equal(true);
    // A settled consequential action never re-opens.
    const reopen = await mod.updateState({
      operationKey: "op-terminal",
      expectedClaimGeneration: 2,
      newState: "claimed",
    });
    expect(reopen.ok).to.equal(false);
    expect(reopen.reasonCode).to.equal("STATE_CONFLICT");
    const op = await mod.getOperation("op-terminal");
    expect(op?.operation_state).to.equal("failed");
    expect(op?.claim_generation).to.equal(2);
  });

  it("rejects the unknown → claimed re-claim (§10.2: unknown is only dispatched/confirmed)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-unknown",
      executionId: "exec-u",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:u",
    });
    // Legal path to unknown: pending → claimed → dispatched → unknown.
    const claim = await mod.updateState({
      operationKey: "op-unknown",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(claim.ok).to.equal(true);
    const dispatched = await mod.updateState({
      operationKey: "op-unknown",
      expectedClaimGeneration: 1,
      newState: "dispatched",
    });
    expect(dispatched.ok).to.equal(true);
    const unknown = await mod.updateState({
      operationKey: "op-unknown",
      expectedClaimGeneration: 2,
      newState: "unknown",
    });
    expect(unknown.ok).to.equal(true);
    const reclaim = await mod.updateState({
      operationKey: "op-unknown",
      expectedClaimGeneration: 3,
      newState: "claimed",
    });
    expect(reclaim.ok).to.equal(false);
    expect(reclaim.reasonCode).to.equal("STATE_CONFLICT");
  });

  it("accepted is reachable from dispatched and from unknown (§10.2)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-acc-from-dispatched",
      executionId: "exec-a1",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:a1",
    });
    const claim = await mod.updateState({
      operationKey: "op-acc-from-dispatched",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(claim.ok).to.equal(true);
    const dispatched = await mod.updateState({
      operationKey: "op-acc-from-dispatched",
      expectedClaimGeneration: 1,
      newState: "dispatched",
    });
    expect(dispatched.ok).to.equal(true);
    const accepted = await mod.updateState({
      operationKey: "op-acc-from-dispatched",
      expectedClaimGeneration: 2,
      newState: "accepted",
    });
    expect(accepted.ok).to.equal(true);

    const mod2 = new AiTaskOperationModule();
    await mod2.recordOperation({
      operationKey: "op-acc-from-unknown",
      executionId: "exec-a2",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:a2",
    });
    const claim2 = await mod2.updateState({
      operationKey: "op-acc-from-unknown",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    expect(claim2.ok).to.equal(true);
    const dispatched2 = await mod2.updateState({
      operationKey: "op-acc-from-unknown",
      expectedClaimGeneration: 1,
      newState: "dispatched",
    });
    expect(dispatched2.ok).to.equal(true);
    const unknown2 = await mod2.updateState({
      operationKey: "op-acc-from-unknown",
      expectedClaimGeneration: 2,
      newState: "unknown",
    });
    expect(unknown2.ok).to.equal(true);
    const confirmed = await mod2.updateState({
      operationKey: "op-acc-from-unknown",
      expectedClaimGeneration: 3,
      newState: "accepted",
    });
    expect(confirmed.ok).to.equal(true);
  });

  it("claimed → failed stays allowed (failed-before-dispatch fence, §10.2)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-fbd",
      executionId: "exec-fbd",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:fbd",
    });
    await mod.updateState({
      operationKey: "op-fbd",
      expectedClaimGeneration: 0,
      newState: "claimed",
    });
    const failed = await mod.updateState({
      operationKey: "op-fbd",
      expectedClaimGeneration: 1,
      newState: "failed",
    });
    expect(failed.ok).to.equal(true);
    // Timestamps survive the failure: an unconditional SET would null
    // claimed_at and erase the claim-order audit trail (T22).
    const op = await mod.getOperation("op-fbd");
    expect(op?.operation_state).to.equal("failed");
    expect(op?.claim_generation).to.equal(2);
    expect(op?.claimed_at).to.not.equal(null);
    expect(op?.settled_at).to.not.equal(null);
    expect(op?.dispatched_at).to.equal(null);
  });

  it("concurrent same-key create with a DIFFERENT intent resolves to INTENT_CONFLICT for the loser (T22 winner validation)", async () => {
    // T22 P2 (audit): the unique-collision catch returned alreadyExists
    // without checking intent/execution/tool against the winner. The loser
    // of a same-key insert race must reload the winner and compare.
    const mod = new AiTaskOperationModule();
    const [a, b] = await Promise.all([
      mod.recordOperation({
        operationKey: "op-intent-race",
        executionId: "exec-i",
        toolIdentity: "send_email",
        domainTarget: "campaign:5",
        intentHash: "sha256:intent-a",
      }),
      mod.recordOperation({
        operationKey: "op-intent-race",
        executionId: "exec-i",
        toolIdentity: "send_email",
        domainTarget: "campaign:9",
        intentHash: "sha256:intent-b",
      }),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(oks.length).to.equal(1);
    expect(losers.length).to.equal(1);
    // The loser's intent differs from the winner's — it must NOT be
    // reported as a harmless alreadyExists.
    const loser = losers[0] as CreateOperationResult;
    if (loser.alreadyExists) {
      throw new Error(
        "collision with a different intent returned alreadyExists instead of INTENT_CONFLICT"
      );
    }
    expect(loser.reasonCode).to.equal("INTENT_CONFLICT");
    // Exactly one of the two intents survived in the store.
    const op = await mod.getOperation("op-intent-race");
    const storedHash = op?.intent_hash;
    const isWinnerHash =
      storedHash === "sha256:intent-a" || storedHash === "sha256:intent-b";
    expect(isWinnerHash).to.equal(true);
  });

  it("identical-intent collision still resolves as alreadyExists (receipt reuse, T22)", async () => {
    // A genuine retry (same intent, same execution, same tool) colliding
    // with the winner keeps the alreadyExists outcome — the caller reuses
    // the existing operation instead of minting a new one.
    const mod = new AiTaskOperationModule();
    const [a, b] = await Promise.all([
      mod.recordOperation({
        operationKey: "op-same-intent-race",
        executionId: "exec-si",
        toolIdentity: "send_email",
        domainTarget: "campaign:5",
        intentHash: "sha256:si",
      }),
      mod.recordOperation({
        operationKey: "op-same-intent-race",
        executionId: "exec-si",
        toolIdentity: "send_email",
        domainTarget: "campaign:5",
        intentHash: "sha256:si",
      }),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(oks.length).to.equal(1);
    // Identical intent → the loser reuses the winner's receipt: typed
    // alreadyExists, never an INTENT_CONFLICT and never a raw throw.
    const loser = losers[0] as CreateOperationResult;
    expect(loser.alreadyExists).to.equal(true);
    expect(loser.reasonCode).to.equal(undefined);
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

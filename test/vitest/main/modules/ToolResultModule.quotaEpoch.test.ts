import { describe, expect, it, beforeEach } from "vitest";
import { ToolResultModule } from "@/modules/ToolResultModule";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Module-level tests for the two invariants that must never be bypassed:
 * the output epoch fence and quota admission.
 *
 * These exercise the real SQLite registry (TypeORM `synchronize`), because
 * the point of the fence is that a stale writer is rejected IN THE DATABASE,
 * not by a check-then-write race in application code.
 */

/**
 * Each RUN gets a unique directory, so this file never resets the
 * process-wide `SqliteDb` singleton. Resetting it here would tear the shared
 * DataSource out from under sibling test files running in parallel workers.
 */
/**
 * Build a Module bound to a FRESH database directory.
 *
 * A new directory per test is what gives each case an empty registry without
 * touching the shared `SqliteDb` singleton.
 */
async function makeModule(
  freeSpaceBytes?: () => Promise<number | null>
): Promise<ToolResultModule> {
  const dir = path.join(
    os.tmpdir(),
    `aifetchly-tor-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  const module = new ToolResultModule(dir, { freeSpaceBytes });
  await module.ensureConnection();
  return module;
}

const BASE_CLAIM = {
  profileId: "prof-1",
  executionId: "exec-1",
  toolCallId: "call-1",
  toolName: "scrape_businesses",
  streamKey: "main",
  format: "json" as const,
  mediaType: "application/json",
  sourceCompleteness: "complete",
};

describe("ToolResultModule — output epoch fence", () => {
  it("creates a scope with a fresh epoch and reuses it on the next call", async () => {
    const mod = await makeModule();
    const first = await mod.ensureScope("prof-1", "conv-1");
    const second = await mod.ensureScope("prof-1", "conv-1");
    expect(first.outputEpoch).toHaveLength(32);
    expect(second.outputEpoch).toBe(first.outputEpoch);
    expect(first.invalidated).toBe(false);
  });

  it("gives different conversations independent epochs", async () => {
    const mod = await makeModule();
    const a = await mod.ensureScope("prof-1", "conv-a");
    const b = await mod.ensureScope("prof-1", "conv-b");
    expect(a.outputEpoch).not.toBe(b.outputEpoch);
  });

  it("rotates the epoch on invalidation so a late commit cannot publish (AC-14)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const claim = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
    });
    expect(claim.kind).toBe("claimed");

    await mod.invalidateScope("prof-1", "conv-1");

    // A commit computed against the pre-deletion epoch is rejected.
    if (claim.kind === "claimed") {
      const committed = await mod.commitOutput({
        outputId: claim.outputId,
        leaseFence: claim.leaseFence,
        storageKey: "p/conv-1/out/payload.json",
        capturedBytes: 1024,
        sha256: "a".repeat(64),
        preservation: "complete",
        sourceCompleteness: "complete",
        receiptJson: "{}",
      });
      expect(committed).toBe(false);
    }
  });

  it("refuses to claim a new output against a rotated epoch", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    await mod.invalidateScope("prof-1", "conv-1");
    const result = await mod.claimOutput({
      ...BASE_CLAIM,
      executionId: "exec-2",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("OUTPUT_NOT_AVAILABLE");
    }
  });

  it("does not resurrect artifacts when a conversation id is recreated (AC-14)", async () => {
    const mod = await makeModule();
    const before = await mod.ensureScope("prof-1", "conv-1");
    await mod.invalidateScope("prof-1", "conv-1");
    const after = await mod.ensureScope("prof-1", "conv-1");
    expect(after.outputEpoch).not.toBe(before.outputEpoch);
  });
});

describe("ToolResultModule — artifact identity and idempotency", () => {
  it("deduplicates a repeated delivery of the same execution (AC-25)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const first = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
    });
    expect(first.kind).toBe("claimed");

    // Same identity, same expected size -> idempotent reuse, one artifact.
    const second = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
    });
    expect(second.kind).toBe("existing");
    if (first.kind === "claimed" && second.kind === "existing") {
      expect(second.output.outputId).toBe(first.outputId);
    }
  });

  it("reports a conflict rather than overwriting committed evidence (AC-25)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      expectedBytes: 100,
    });
    const conflicting = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      expectedBytes: 999,
    });
    expect(conflicting.kind).toBe("conflict");
  });

  it("treats a different stream key as a separate artifact", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const main = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      streamKey: "main",
    });
    const stderr = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      streamKey: "stderr",
    });
    expect(main.kind).toBe("claimed");
    expect(stderr.kind).toBe("claimed");
    if (main.kind === "claimed" && stderr.kind === "claimed") {
      expect(stderr.outputId).not.toBe(main.outputId);
    }
  });

  it("gives a deliberate re-execution a new artifact", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const first = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
    });
    const rerun = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-2",
    });
    expect(first.kind).toBe("claimed");
    expect(rerun.kind).toBe("claimed");
  });
});

describe("ToolResultModule — quota admission", () => {
  it("admits a request within quota", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1024,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reservedBytes).toBeGreaterThanOrEqual(1024);
  });

  it("reserves at least one increment for an unknown-length stream", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1,
    });
    expect(result.ok).toBe(true);
    // A 1-byte request must still reserve a real increment so the writer has
    // room to grow before it needs to re-check admission.
    if (result.ok) expect(result.reservedBytes).toBe(1024 * 1024);
  });

  it("refuses a request above the per-artifact cap", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 64 * 1024 * 1024 + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUTPUT_QUOTA_EXCEEDED");
  });

  it("refuses when the free-disk reserve is exhausted (AC-12)", async () => {
    const mod = await makeModule(async () => 1024);
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUTPUT_DISK_FULL");
  });

  it("charges outstanding reservations so concurrent writers cannot overrun", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const first = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1024,
    });
    expect(first.ok).toBe(true);
    // The second writer sees the first writer's held reservation in usage, so
    // admission is a function of total in-flight work, not just committed
    // bytes.
    const second = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-2",
      requestedBytes: 1024,
    });
    expect(second.ok).toBe(true);
  });
});

describe("ToolResultModule — access authorization", () => {
  async function commitOne(
    mod: ToolResultModule,
    conversationId: string
  ): Promise<string> {
    const scope = await mod.ensureScope("prof-1", conversationId);
    const claim = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId,
      outputEpoch: scope.outputEpoch,
    });
    if (claim.kind !== "claimed") throw new Error("expected claim");
    await mod.commitOutput({
      outputId: claim.outputId,
      leaseFence: claim.leaseFence,
      storageKey: `p/conv/${conversationId}/payload.json`,
      capturedBytes: 10,
      sha256: "b".repeat(64),
      preservation: "complete",
      sourceCompleteness: "complete",
      receiptJson: "{}",
    });
    return claim.outputId;
  }

  it("allows the owning conversation", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "conv-1");
    const decision = await mod.authorizeAccess({
      outputId,
      profileId: "prof-1",
      conversationId: "conv-1",
    });
    expect(decision.ok).toBe(true);
  });

  it("rejects a sibling conversation with the same code as a missing id (AC-11)", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "conv-1");
    const denied = await mod.authorizeAccess({
      outputId,
      profileId: "prof-1",
      conversationId: "conv-2",
    });
    const missing = await mod.authorizeAccess({
      outputId: "out_00000000000000000000000000000000",
      profileId: "prof-1",
      conversationId: "conv-1",
    });
    expect(denied.ok).toBe(false);
    expect(missing.ok).toBe(false);
    // Identical response: existence is never leaked.
    if (!denied.ok && !missing.ok) expect(denied.code).toBe(missing.code);
  });

  it("rejects a different profile", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "conv-1");
    const decision = await mod.authorizeAccess({
      outputId,
      profileId: "prof-other",
      conversationId: "conv-1",
    });
    expect(decision.ok).toBe(false);
  });

  it("rejects a deleted conversation's artifact (AC-14)", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "conv-1");
    await mod.invalidateScope("prof-1", "conv-1");
    const decision = await mod.authorizeAccess({
      outputId,
      profileId: "prof-1",
      conversationId: "conv-1",
    });
    expect(decision.ok).toBe(false);
  });

  it("allows an explicitly granted parent agent to read a child artifact", async () => {
    const mod = await makeModule();
    const childScope = await mod.ensureScope("prof-1", "child-conv");
    const claim = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "child-conv",
      outputEpoch: childScope.outputEpoch,
      ownerAgentId: "agent-child",
    });
    if (claim.kind !== "claimed") throw new Error("expected claim");
    await mod.commitOutput({
      outputId: claim.outputId,
      leaseFence: claim.leaseFence,
      storageKey: "p/child/payload.json",
      capturedBytes: 10,
      sha256: "c".repeat(64),
      preservation: "complete",
      sourceCompleteness: "complete",
      receiptJson: "{}",
    });

    const beforeGrant = await mod.authorizeAccess({
      outputId: claim.outputId,
      profileId: "prof-1",
      conversationId: "parent-conv",
      agentId: "agent-parent",
    });
    expect(beforeGrant.ok).toBe(false);

    const parentScope = await mod.ensureScope("prof-1", "parent-conv");
    await mod.grantAccess({
      outputId: claim.outputId,
      granteeConversationId: "parent-conv",
      granteeEpoch: parentScope.outputEpoch,
      granteeAgentId: "agent-parent",
      grantReason: "child exported artifact",
    });

    const afterGrant = await mod.authorizeAccess({
      outputId: claim.outputId,
      profileId: "prof-1",
      conversationId: "parent-conv",
      agentId: "agent-parent",
    });
    expect(afterGrant.ok).toBe(true);
  });
});

describe("ToolResultModule — retrieval-work allowance", () => {
  it("allows calls up to the allowance then refuses", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const key = {
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      agentId: "",
      turnId: "turn-1",
    };
    // The allowance is 32 calls (PRD §8).
    for (let i = 0; i < 32; i += 1) {
      const res = await mod.reserveRetrievalCall(key);
      expect(res.ok).toBe(true);
    }
    const exhausted = await mod.reserveRetrievalCall(key);
    expect(exhausted.ok).toBe(false);
  });

  it("gives a new turn a fresh allowance (persisted, not in-memory)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const base = {
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      agentId: "",
    };
    for (let i = 0; i < 32; i += 1) {
      await mod.reserveRetrievalCall({ ...base, turnId: "turn-1" });
    }
    expect((await mod.reserveRetrievalCall({ ...base, turnId: "turn-1" })).ok).toBe(
      false
    );
    expect((await mod.reserveRetrievalCall({ ...base, turnId: "turn-2" })).ok).toBe(
      true
    );
  });

  it("charges repeated reads as work rather than allowing free repeats", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const key = {
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      agentId: "",
      turnId: "turn-1",
    };
    // Reading the same page 32 times exhausts the allowance; duplicates are
    // not a way to bypass the guard.
    for (let i = 0; i < 32; i += 1) {
      await mod.reserveRetrievalCall(key);
    }
    expect((await mod.reserveRetrievalCall(key)).ok).toBe(false);
  });

  it("tracks remaining returned-token allowance", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "conv-1");
    const key = {
      profileId: "prof-1",
      conversationId: "conv-1",
      outputEpoch: scope.outputEpoch,
      agentId: "",
      turnId: "turn-1",
    };
    await mod.reserveRetrievalCall(key);
    await mod.settleRetrievalCall({ ...key, tokens: 1000 });
    const remaining = await mod.remainingRetrievalTokens(key);
    expect(remaining).toBe(32_000 - 1000);
  });
});

// test/vitest/main/service/TaskExecutionCoordinatorLeaseGuard.test.ts
//
// T15b regression — single-owner lease guard standalones (FR-20, NFR-01/07,
// AC-22/31).
//
// `assertOwnership` + `readCurrentLeaseGeneration` are the exported
// standalones the engine's consult closure and finalization gate call. A
// Continue successor bumps `owner_generation` on the shared lineage ledger;
// the parent binding still carries the OLD frozen `leaseGeneration`. The
// guard must reject the stale ancestor: mismatch → STATE_CONFLICT, missing
// ledger → null → fail-closed.
//
// The engine integration (consult closure returns `yield_owner`, finalize
// gate skips `finalizeManual`) is covered in
// `AIChatQueryEngineFinalize.test.ts` under the T15b block, which reuses
// that file's full mock harness. This file locks the pure guard semantics.
import { describe, expect, it, vi } from "vitest";
import {
  assertOwnership,
  readCurrentLeaseGeneration,
} from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import type { LedgerSnapshot } from "@/model/AiTaskExecution.model";

describe("T15b standalone — assertOwnership / readCurrentLeaseGeneration", () => {
  it("matching generation → ok", () => {
    const result = assertOwnership({ leaseGeneration: 3 }, 3);
    expect(result.ok).toBe(true);
  });

  it("stale generation (parent < successor's bump) → STATE_CONFLICT", () => {
    // Parent binding frozen at generation 2; successor bumped to 3.
    const result = assertOwnership({ leaseGeneration: 2 }, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("STATE_CONFLICT");
    }
  });

  it("parent ahead of ledger (impossible in practice) → STATE_CONFLICT (fail-closed)", () => {
    // A binding carrying 4 against a ledger at 3 would mean the binding was
    // never the owner; reject fail-closed rather than treating it as valid.
    const result = assertOwnership({ leaseGeneration: 4 }, 3);
    expect(result.ok).toBe(false);
  });

  it("readCurrentLeaseGeneration returns the ledger's ownerGeneration", async () => {
    const ledger: LedgerSnapshot = {
      ledgerId: "led-1",
      ownerGeneration: 5,
      policyLimitsJson: "{}",
      consumedContinuations: 0,
      consumedProviderAttempts: 0,
      consumedToolExecutions: 0,
      consumedCheckerAttempts: 0,
      consumedTokens: 0,
      consumedActiveMs: 0,
    } as unknown as LedgerSnapshot;
    const get = vi.fn(async () => ledger);
    const gen = await readCurrentLeaseGeneration(get, "led-1");
    expect(get).toHaveBeenCalledWith("led-1");
    expect(gen).toBe(5);
  });

  it("readCurrentLeaseGeneration returns null for a missing ledger (fail-closed)", async () => {
    const get = vi.fn(async () => null);
    const gen = await readCurrentLeaseGeneration(get, "led-missing");
    expect(gen).toBeNull();
  });

  it("a stale ancestor (gen 2) against a missing ledger (null → -1) is rejected fail-closed", async () => {
    // The engine passes `currentGen ?? -1` as the expected, so a missing
    // ledger must reject (not silently pass as generation 0).
    const get = vi.fn(async () => null);
    const currentGen = await readCurrentLeaseGeneration(get, "led-1");
    const ownership = assertOwnership(
      { leaseGeneration: 2 },
      currentGen ?? -1
    );
    expect(ownership.ok).toBe(false);
  });

  it("composition: fresh ledger matches the binding's frozen generation → ok", async () => {
    // The happy path: the binding froze generation 3, the ledger is still
    // at 3 (no successor claimed). The consult/finalize proceeds.
    const ledger: LedgerSnapshot = {
      ledgerId: "led-1",
      ownerGeneration: 3,
      policyLimitsJson: "{}",
      consumedContinuations: 0,
      consumedProviderAttempts: 0,
      consumedToolExecutions: 0,
      consumedCheckerAttempts: 0,
      consumedTokens: 0,
      consumedActiveMs: 0,
    } as unknown as LedgerSnapshot;
    const get = vi.fn(async () => ledger);
    const currentGen = await readCurrentLeaseGeneration(get, "led-1");
    const ownership = assertOwnership(
      { leaseGeneration: 3 },
      currentGen ?? -1
    );
    expect(ownership.ok).toBe(true);
  });
});

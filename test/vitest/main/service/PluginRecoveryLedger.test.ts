// PluginRecoveryLedger tests (TD-07 / HOST-10 / HOST-16).
import { describe, it, expect, beforeEach } from "vitest";
import {
  PluginRecoveryLedger,
  canonicalJson,
  searchIdentityFromArgs,
  jobFingerprintFromArgs,
} from "@/service/PluginRecoveryLedger";
import { ToolJobRegistry } from "@/service/ToolJobRegistry";

const ARGS = { query: "dentists", location: "Chicago, IL", maxResults: 100 };

describe("canonicalization helpers", () => {
  it("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("search identity ignores maxResults and recovery but keeps platform", () => {
    expect(searchIdentityFromArgs({ ...ARGS, maxResults: 10, recovery: { previousErrorId: "e", strategy: "reduced_scope" } })).toBe(
      searchIdentityFromArgs(ARGS)
    );
    expect(searchIdentityFromArgs({ ...ARGS, platform: "yell" })).not.toBe(
      searchIdentityFromArgs(ARGS)
    );
  });

  it("job fingerprint changes with any argument except recovery", () => {
    const base = jobFingerprintFromArgs("c1", "tool", ARGS);
    expect(jobFingerprintFromArgs("c1", "tool", { ...ARGS, recovery: { previousErrorId: "x" } })).toBe(base);
    expect(jobFingerprintFromArgs("c1", "tool", { ...ARGS, maxResults: 5 })).not.toBe(base);
    expect(jobFingerprintFromArgs("c2", "tool", ARGS)).not.toBe(base);
  });
});

describe("PluginRecoveryLedger", () => {
  let ledger: PluginRecoveryLedger;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    ledger = new PluginRecoveryLedger({}, () => now);
  });

  const record = (overrides?: Partial<Parameters<PluginRecoveryLedger["recordFailure"]>[0]>) =>
    ledger.recordFailure({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      code: "RESULT_SELECTOR_NOT_FOUND",
      category: "site_changed",
      allowedStrategies: ["fallback_adapter", "switch_platform"],
      ...overrides,
    });

  it("first-time call without prior failure is allowed without strategy", () => {
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
    });
    expect(v.ok).toBe(true);
  });

  it("rejects a repeat of a failed scope that omits recovery context", () => {
    record();
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("missing_recovery_field");
  });

  it("rejects a forged or foreign error reference", () => {
    record();
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: "err_forged",
      strategy: "fallback_adapter",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("unknown_error_ref");

    // Same ref in another conversation is also foreign.
    const other = ledger.validateAndReserve({
      conversationId: "c2",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: "err_whatever",
      strategy: "fallback_adapter",
    });
    expect(other.ok).toBe(true); // no ledger entry in c2 → first attempt
  });

  it("accepts a valid retry and reserves atomically", () => {
    const errorRef = record();
    const first = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "fallback_adapter",
    });
    expect(first.ok).toBe(true);

    // Concurrent duplicate retry while the reservation is in flight.
    const second = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "switch_platform",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("reservation_in_flight");
  });

  it("rejects a strategy not in the allowed set", () => {
    const errorRef = record();
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "retry_after_delay",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("strategy_not_allowed");
  });

  it("enforces the rate-limit cooldown before any retry", () => {
    const errorRef = record({
      category: "rate_limited",
      retryAfterMs: 120_000,
    });
    const tooEarly = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "fallback_adapter",
    });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.reason).toBe("cooldown");

    now += 120_001;
    const later = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "fallback_adapter",
    });
    expect(later.ok).toBe(true);
  });

  it("never repeats an identical strategy after the same failure code", () => {
    const errorRef = record();
    const first = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "fallback_adapter",
    });
    expect(first.ok).toBe(true);
    ledger.completeAttempt("c1", "p1", searchIdentityFromArgs(ARGS), "failed");

    // Same strategy fails again → re-record with SAME code → repeat blocked.
    const errorRef2 = record();
    expect(errorRef2).not.toBe(errorRef);
    const repeat = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef2,
      strategy: "fallback_adapter",
    });
    expect(repeat.ok).toBe(false);
    if (!repeat.ok) expect(repeat.reason).toBe("fingerprint_repeat");

    // A different strategy may proceed.
    const alt = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef2,
      strategy: "switch_platform",
    });
    expect(alt.ok).toBe(true);
  });

  it("exhausts the budget at the hard attempt ceiling", () => {
    const identity = searchIdentityFromArgs(ARGS);
    let errorRef = record();
    // Attempt 2 (fallback_adapter).
    expect(
      ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        previousErrorId: errorRef,
        strategy: "fallback_adapter",
      }).ok
    ).toBe(true);
    ledger.completeAttempt("c1", "p1", identity, "failed");
    // Attempt 3 (switch_platform).
    errorRef = record({ code: "OTHER_CODE" });
    expect(
      ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        previousErrorId: errorRef,
        strategy: "switch_platform",
      }).ok
    ).toBe(true);
    ledger.completeAttempt("c1", "p1", identity, "failed");
    // Attempt 4 → budget exhausted (3 attempts total = original + 2 retries).
    errorRef = record({ code: "THIRD_CODE" });
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity,
      previousErrorId: errorRef,
      strategy: "fallback_adapter",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("budget_exhausted");
  });

  it("binds a plugin error id under the host reference", () => {
    const bound = ledger.bindPluginErrorId("err_host123", "err_plugin456");
    expect(bound.id).toBe("err_host123");
    expect(bound.pluginErrorId).toBe("err_plugin456");
  });

  it("success terminalizes the identity against further retries", () => {
    const identity = searchIdentityFromArgs(ARGS);
    const errorRef = record();
    expect(
      ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        previousErrorId: errorRef,
        strategy: "fallback_adapter",
      }).ok
    ).toBe(true);
    ledger.completeAttempt("c1", "p1", identity, "succeeded");
    const after = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity,
    });
    expect(after.ok).toBe(true); // terminal → treated as a fresh search
  });
});

describe("ToolJobRegistry duplicate suppression", () => {
  it("finds an active job by fingerprint and ignores terminal ones", () => {
    const registry = new ToolJobRegistry();
    const fingerprint = "fp1";
    const first = registry.start(
      "t",
      {},
      { conversationId: "c1", toolCallId: "tc1" },
      async (handle) => {
        // Still running while we probe.
        const found = registry.findActiveJobByFingerprint("c1", fingerprint);
        expect(found?.jobId).toBe(first.jobId);
        handle.resolve(1);
      },
      { fingerprint }
    );
    void first;
    expect(registry.findActiveJobByFingerprint("c1", "other")).toBeNull();
    expect(registry.findActiveJobByFingerprint("c2", fingerprint)).toBeNull();
  });

  it("does not match fingerprints across conversations", () => {
    const registry = new ToolJobRegistry();
    registry.start(
      "t",
      {},
      { conversationId: "c1", toolCallId: "tc1" },
      async (handle) => handle.resolve(1),
      { fingerprint: "fpX" }
    );
    expect(registry.findActiveJobByFingerprint("c9", "fpX")).toBeNull();
  });
});

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

  it("search identity ignores maxResults, recovery, platform, and includeDetailPages", () => {
    // Kernel knobs (platform / detail pages) adjust the SAME logical search —
    // a switch_platform retry or a scope toggle must never mint a fresh
    // budget (design §12.2), so they stay out of the ledger identity.
    expect(searchIdentityFromArgs({ ...ARGS, maxResults: 10, recovery: { previousErrorId: "e", strategy: "reduced_scope" } })).toBe(
      searchIdentityFromArgs(ARGS)
    );
    expect(searchIdentityFromArgs({ ...ARGS, platform: "yellowpages-com" })).toBe(
      searchIdentityFromArgs(ARGS)
    );
    expect(searchIdentityFromArgs({ ...ARGS, includeDetailPages: false })).toBe(
      searchIdentityFromArgs(ARGS)
    );
  });

  it("job fingerprint changes with any argument except recovery", () => {
    const base = jobFingerprintFromArgs("c1", "tool", ARGS);
    expect(jobFingerprintFromArgs("c1", "tool", { ...ARGS, recovery: { previousErrorId: "x" } })).toBe(base);
    expect(jobFingerprintFromArgs("c1", "tool", { ...ARGS, maxResults: 5 })).not.toBe(base);
    // platform stays in the duplicate-job fingerprint: two different live
    // requests must not be collapsed even when their ledger identity matches.
    expect(jobFingerprintFromArgs("c1", "tool", { ...ARGS, platform: "yell" })).not.toBe(base);
    expect(jobFingerprintFromArgs("c1", "tool", { ...ARGS, includeDetailPages: false })).not.toBe(base);
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

  it("surfaces the host-owed retryAfterMs in the reservation context", () => {
    const errorRef = record({ category: "rate_limited", retryAfterMs: 480_000 });
    now += 480_001; // pass the cooldown
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "fallback_adapter",
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.context.retryAfterMs).toBe(480_000);
  });

  it("surfaces null retryAfterMs when the failure owes no delay", () => {
    const errorRef = record(); // site_changed, no retryAfterMs
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: errorRef,
      strategy: "switch_platform",
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.context.retryAfterMs).toBeNull();
  });

  it("success deletes the identity so the next search starts clean", () => {
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

    // A later failure of the same logical search is a NEW search: attempts
    // restart at 1 instead of inheriting the old budget/state.
    record();
    const fresh = ledger.recordFailure({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity,
      code: "RESULT_SELECTOR_NOT_FOUND",
      category: "site_changed",
      allowedStrategies: ["fallback_adapter"],
    });
    const retry = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity,
      previousErrorId: fresh,
      strategy: "fallback_adapter",
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.context.attempt).toBe(2);
  });

  describe("first-attempt reservation (H3)", () => {
    const identity = () => searchIdentityFromArgs(ARGS);

    it("reserves the first attempt before spawn", () => {
      const v = ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
      });
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.context.attempt).toBe(1);
        expect(v.context.strategy).toBeNull();
        expect(v.context.errorRef).toBeNull();
        expect(v.context.retryAfterMs).toBeNull();
      }
      // A second same-scope first-call while the reservation is in flight is
      // no longer a free attempt: the reservation exists.
      const second = ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
      });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.reason).toBe("missing_recovery_field");
    });

    it("charges the budget on transport failure (crash/exit/invalid result)", () => {
      ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
      });
      ledger.recordTransportFailure({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
      });

      // Same failed scope WITHOUT recovery stays missing_recovery_field.
      const plain = ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
      });
      expect(plain.ok).toBe(false);
      if (!plain.ok) expect(plain.reason).toBe("missing_recovery_field");

      // WITH recovery: no plugin contract exists after a crash → forged or
      // impossible retry is a dead end (the user starts a new search).
      const forged = ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
        previousErrorId: "err_forged",
        strategy: "reduced_scope",
      });
      expect(forged.ok).toBe(false);
      if (!forged.ok) expect(forged.reason).toBe("unknown_error_ref");
    });

    it("a new user message with a changed search gets a fresh identity", () => {
      ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
      });
      ledger.recordTransportFailure({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity(),
      });

      const otherIdentity = searchIdentityFromArgs({
        ...ARGS,
        location: "Denver, CO",
      });
      const other = ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: otherIdentity,
      });
      expect(other.ok).toBe(true);
      if (other.ok) expect(other.context.attempt).toBe(1);
    });

    it("transport failure preserves the attempt count for hard-max accounting", () => {
      const identity = searchIdentityFromArgs(ARGS);
      // Attempt 1 crashes.
      ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
      });
      ledger.recordTransportFailure({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
      });
      // A subsequent domain failure inherits the SAME attempt count.
      record();
      // Attempt 2 via a different strategy consumes the retry budget.
      const errorRef = ledger.recordFailure({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        code: "OTHER",
        category: "plugin_bug",
        allowedStrategies: ["reduced_scope"],
      });
      expect(
        ledger.validateAndReserve({
          conversationId: "c1",
          pluginName: "p1",
          searchIdentity: identity,
          previousErrorId: errorRef,
          strategy: "reduced_scope",
        }).ok
      ).toBe(true);
      ledger.completeAttempt("c1", "p1", identity, "failed");
      // Attempt 3 = hard max; attempt 4 is exhausted.
      const errorRef2 = ledger.recordFailure({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        code: "OTHER2",
        category: "plugin_bug",
        allowedStrategies: ["reduced_scope"],
      });
      expect(
        ledger.validateAndReserve({
          conversationId: "c1",
          pluginName: "p1",
          searchIdentity: identity,
          previousErrorId: errorRef2,
          strategy: "reduced_scope",
        }).ok
      ).toBe(true);
      ledger.completeAttempt("c1", "p1", identity, "failed");
      const errorRef3 = ledger.recordFailure({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        code: "OTHER3",
        category: "plugin_bug",
        allowedStrategies: ["reduced_scope"],
      });
      const exhausted = ledger.validateAndReserve({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        previousErrorId: errorRef3,
        strategy: "reduced_scope",
      });
      expect(exhausted.ok).toBe(false);
      if (!exhausted.ok) expect(exhausted.reason).toBe("budget_exhausted");
    });
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

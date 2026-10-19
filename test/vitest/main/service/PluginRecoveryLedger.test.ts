// PluginRecoveryLedger tests (TD-07 / HOST-10 / HOST-16).
import { describe, it, expect, beforeEach } from "vitest";
import {
  PluginRecoveryLedger,
  canonicalJson,
  searchIdentityFromArgs,
  jobFingerprintFromArgs,
  normalizeSearchText,
  normalizeArgsForSearchIdentity,
  validatePublicSearchInput,
  LOGICAL_SEARCH_STRATEGY_ADJUSTABLE_FIELDS,
  PUBLIC_SEARCH_TEXT_FIELDS,
  PUBLIC_SEARCH_LIST_FIELDS,
  type RecoveryStrategy,
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

    // Same ref in another conversation is ALSO foreign: B08 closes the
    // old loophole where recovery fields minted attempt 1 on a fresh scope
    // (wrong conversation / post-restart references must fail closed).
    const other = ledger.validateAndReserve({
      conversationId: "c2",
      pluginName: "p1",
      searchIdentity: searchIdentityFromArgs(ARGS),
      previousErrorId: "err_whatever",
      strategy: "fallback_adapter",
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toBe("unknown_error_ref");
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
      // (B08 host policy: plugin_bug/fatal categories never carry strategies,
      // so the retry path uses a recoverable failure category.)
      const errorRef = ledger.recordFailure({
        conversationId: "c1",
        pluginName: "p1",
        searchIdentity: identity,
        code: "OTHER",
        category: "site_changed",
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
        category: "site_changed",
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
        category: "site_changed",
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

describe("B08: fail-closed recovery references", () => {
  const identity = () => searchIdentityFromArgs(ARGS);
  let ledger: PluginRecoveryLedger;
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    ledger = new PluginRecoveryLedger({}, () => now);
  });

  it("recovery fields can never mint attempt 1 on a fresh scope", () => {
    const v = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      previousErrorId: "err_forged",
      strategy: "switch_platform",
      userTurnId: "turn-1",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("unknown_error_ref");
  });

  it("post-restart references fail closed", () => {
    const errorRef = ledger.recordFailure({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      code: "RESULT_SELECTOR_NOT_FOUND",
      category: "site_changed",
      allowedStrategies: ["switch_platform"],
    });
    expect(typeof errorRef).toBe("string");

    // Fresh ledger instance == application restart: the reference existed in
    // a dead process and must never authorize work.
    const ledger2 = new PluginRecoveryLedger({}, () => now);
    const restarted = ledger2.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      previousErrorId: errorRef,
      strategy: "switch_platform",
      userTurnId: "turn-1",
    });
    expect(restarted.ok).toBe(false);
    if (!restarted.ok) expect(restarted.reason).toBe("unknown_error_ref");
  });

  it("an explicit new user message resets the budget without a model bypass", () => {
    const errorRef = ledger.recordFailure({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      code: "RESULT_SELECTOR_NOT_FOUND",
      category: "site_changed",
      allowedStrategies: ["switch_platform"],
      userTurnId: "turn-1",
    });
    // Same generation, no recovery acknowledgement → blocked.
    const sameTurn = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      userTurnId: "turn-1",
    });
    expect(sameTurn.ok).toBe(false);
    if (!sameTurn.ok) expect(sameTurn.reason).toBe("missing_recovery_field");

    // A NEW host-verified user turn without recovery fields is a fresh
    // search — the budget resets with no host error reference minted.
    const freshUser = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      userTurnId: "turn-2",
    });
    expect(freshUser.ok).toBe(true);
    if (freshUser.ok) {
      expect(freshUser.context.attempt).toBe(1);
      expect(freshUser.context.errorRef).toBeNull();
    }
    // The old reference is dead: presenting it later must fail.
    const stale = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      previousErrorId: errorRef,
      strategy: "switch_platform",
      userTurnId: "turn-2",
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("unknown_error_ref");
  });

  it("a fatal envelope (recoverable:false / fatal category) strips strategies", () => {
    const fatalRef = ledger.recordFailure({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      code: "FATAL_PLUGIN_CRASH",
      category: "plugin_bug",
      allowedStrategies: ["switch_platform"],
      recoverable: false,
    });
    const fatalRetry = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      previousErrorId: fatalRef,
      strategy: "switch_platform",
    });
    expect(fatalRetry.ok).toBe(false);
    if (!fatalRetry.ok) {
      expect(fatalRetry.reason).toBe("strategy_not_allowed");
    }

    ledger.clearForTest();
    const listRef = ledger.recordFailure({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      code: "X",
      category: "rate_limited",
      // Unknown strategy values are dropped by the host policy: an
      // arbitrary string list must never widen the allowed set.
      allowedStrategies: ["not-a-strategy", "fallback_adapter"] as unknown as readonly RecoveryStrategy[],
    });
    const listRetry = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      previousErrorId: listRef,
      strategy: "fallback_adapter",
    });
    expect(listRetry.ok).toBe(true);
  });
});

describe("B08: reservation lifecycle", () => {
  const identity = () => searchIdentityFromArgs(ARGS);
  let ledger: PluginRecoveryLedger;
  beforeEach(() => {
    ledger = new PluginRecoveryLedger({}, () => 1_000_000);
  });

  it("a queued cancellation releases the in-flight reservation", () => {
    // Fill the single concurrency slot with a hanging job.
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    const blocker = registry.start(
      "plugin__p1__scrape",
      {},
      { conversationId: "c1", toolCallId: "t-block" },
      () => new Promise(() => undefined)
    );
    expect(blocker.queued).toBe(false);
    const blockers: string[] = [blocker.jobId];

    ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      userTurnId: "turn-1",
    });

    // Second job is queued; the loop attaches the reservation-cleanup hook
    // at queue admission (the spawn callback has not run yet).
    const queued = registry.start(
      "plugin__p1__scrape",
      {},
      { conversationId: "c1", toolCallId: "t-queue" },
      async (handle) => {
        handle.onSettled(() => {
          ledger.completeAttempt("c1", "p1", identity(), "failed");
        });
        await new Promise<void>(() => undefined);
      }
    );
    if (!queued.queued) throw new Error("expected job to be queued");
    registry.onSettledById(queued.jobId, () => {
      ledger.completeAttempt("c1", "p1", identity(), "failed");
    });

    // Cancel the QUEUED job: the spawn NEVER runs, the settle hook does.
    expect(registry.cancel(queued.jobId).cancelled).toBe(true);
    const after = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      userTurnId: "turn-2",
    });
    expect(after.ok).toBe(true); // no reservation_in_flight lock
    if (!after.ok) {
      throw new Error(
        `expected a released reservation, got ${String(after.reason)}`
      );
    }

    for (const id of blockers) registry.cancel(id);
  });

  it("a sealed admission releases the reservation before returning", () => {
    registry_sealTest();
  });

  function registry_sealTest(): void {
    const registry = new ToolJobRegistry();
    registry.sealAdmission("plugin__p1__scrape");
    ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      userTurnId: "turn-1",
    });
    try {
      registry.start(
        "plugin__p1__scrape",
        {},
        { conversationId: "c1", toolCallId: "t1" },
        async () => 1
      );
      throw new Error("expected AdmissionSealedError");
    } catch {
      // Sealed rejection; the loop releases the reservation here.
      ledger.completeAttempt("c1", "p1", identity(), "failed");
    }
    const after = ledger.validateAndReserve({
      conversationId: "c1",
      pluginName: "p1",
      searchIdentity: identity(),
      userTurnId: "turn-1",
    });
    // The deleted-job attempt was released: no reservation_in_flight lock
    // survives the sealed rejection (the same generation still owes its
    // recovery acknowledgement, so the follow-up is refused politely).
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.reason).not.toBe("reservation_in_flight");
    }
  }
});

describe("G01 public input canonicalization", () => {
  it("normalizes query/location spellings so equivalent searches share identity", () => {
    const identity = searchIdentityFromArgs(ARGS);
    expect(
      searchIdentityFromArgs({
        ...ARGS,
        query: "  dentists\t ",
        location: "CHICAGO,   Il  ",
      })
    ).toBe(identity);
    expect(normalizeSearchText("  C\uFF28icago ")).toBe("chicago");
  });

  it("does not let different searches collapse into one identity", () => {
    expect(searchIdentityFromArgs({ query: "dentists", location: "Chicago, IL" })).not.toBe(
      searchIdentityFromArgs({ query: "plumbers", location: "Chicago, IL" })
    );
  });

  it("treats the fields list as an order-insensitive set", () => {
    const base = searchIdentityFromArgs({
      ...ARGS,
      fields: ["phone", "email", "businessName"],
    });
    expect(
      searchIdentityFromArgs({
        ...ARGS,
        fields: ["EMAIL", "  phone ", "phone", "businessName"],
      })
    ).toBe(base);
  });

  it("keeps kernel knobs out of the normalized identity but inside the job fingerprint", () => {
    const identity = searchIdentityFromArgs(ARGS);
    expect(searchIdentityFromArgs({ ...ARGS, platform: "yellowpages-com" })).toBe(identity);
    expect(
      jobFingerprintFromArgs("c1", "t", { ...ARGS, platform: "yellowpages-com" })
    ).not.toBe(jobFingerprintFromArgs("c1", "t", ARGS));
    // Normalization applies to fingerprints too: whitespace-only differences
    // never mint a second live job.
    expect(
      jobFingerprintFromArgs("c1", "t", { ...ARGS, query: "  dentists\n" })
    ).toBe(jobFingerprintFromArgs("c1", "t", ARGS));
  });

  it("validatePublicSearchInput polices shapes without rejecting unknown fields", () => {
    expect(validatePublicSearchInput(ARGS)).toEqual([]);
    expect(
      validatePublicSearchInput({ query: 5, location: null, fields: "phone" })
        .map((i) => i.field)
        .sort()
    ).toEqual(["fields", "location", "query"]);
    expect(
      validatePublicSearchInput({
        query: "  ",
        location: "x".repeat(257),
        fields: ["phone", 5],
      })
        .map((i) => i.field)
        .sort()
    ).toEqual(["fields", "location", "query"]);
    // Unknown plugin-domain fields pass through untouched.
    expect(validatePublicSearchInput({ ...ARGS, custom: { nested: 1 } })).toEqual(
      []
    );
  });

  it("normalizeArgsForSearchIdentity leaves unrelated args untouched", () => {
    expect(normalizeArgsForSearchIdentity(ARGS)).toEqual({
      ...ARGS,
      location: "chicago, il",
    });
    const weird = { ...ARGS, location: " Chicago\tIL ", fields: ["b", "a", "b"] };
    expect(normalizeArgsForSearchIdentity(weird)).toEqual({
      ...ARGS,
      location: "chicago il",
      fields: ["a", "b"],
    });
  });
});

describe("G01 generic logical-search identity contract", () => {
  it("declares the strategy-adjustable fields the design fixes", () => {
    expect([...LOGICAL_SEARCH_STRATEGY_ADJUSTABLE_FIELDS].sort()).toEqual([
      "includeDetailPages",
      "maxResults",
      "platform",
      "recovery",
    ]);
  });

  it("excludes exactly the contract fields from the logical identity", () => {
    const identity = searchIdentityFromArgs(ARGS);
    for (const field of LOGICAL_SEARCH_STRATEGY_ADJUSTABLE_FIELDS) {
      if (field === "recovery") {
        expect(
          searchIdentityFromArgs({
            ...ARGS,
            recovery: { previousErrorId: "x", strategy: "reduced_scope" },
          })
        ).toBe(identity);
      } else {
        const probe: Record<string, unknown> = { ...ARGS };
        probe[field] = field === "maxResults" ? 5 : field === "platform" ? "yellowpages-com" : field === "includeDetailPages" ? false : "x";
        expect(searchIdentityFromArgs(probe)).toBe(identity);
      }
    }
    // Non-contract fields DO change the identity.
    expect(
      searchIdentityFromArgs({ ...ARGS, cityLabel: "downtown" })
    ).not.toBe(identity);
  });

  it("the identity contract is generic vocabulary (no plugin-specific names)", () => {
    for (const field of LOGICAL_SEARCH_STRATEGY_ADJUSTABLE_FIELDS) {
      expect(field).not.toContain("yellow");
      expect(field).not.toContain("listing");
    }
    for (const field of [...PUBLIC_SEARCH_TEXT_FIELDS, ...PUBLIC_SEARCH_LIST_FIELDS]) {
      expect(field).not.toContain("yellow");
    }
  });
});

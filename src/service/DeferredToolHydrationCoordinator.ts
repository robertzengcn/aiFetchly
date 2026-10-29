/**
 * DeferredToolHydrationCoordinator — one-shot internal hydration + replay at
 * the executor/provider boundary (design §8.7, FR-28).
 *
 * When an ALLOWED installer call returns the provider's "deferred tool
 * loaded; retry" sentinel BEFORE any mutation result, the coordinator
 * hydrates the tool and replays the SAME validated call once, internally:
 *   - never asks the model to reconstruct arguments;
 *   - never replays after a timeout, unknown execution state, partial
 *     mutation, or any result lacking the exact sentinel;
 *   - hard cap of one replay (INSTALL_TOOL_LOAD_RETRY_EXHAUSTED beyond).
 */

export const DEFERRED_TOOL_SENTINEL_RE =
  /deferred tool (?:has been |was )?loaded|tool\s+loaded\s*[:-]?\s*retry/i;

export interface DeferredToolHydrationResult {
  readonly hydrated: boolean;
  readonly replayed: boolean;
  readonly replayCount: 0 | 1;
  readonly toolName: string;
  readonly callFingerprint: string;
}

export interface HydrationCheckInput {
  readonly toolName: string;
  /** Deterministic fingerprint of the validated call arguments. */
  readonly callFingerprint: string;
  /** The result the provider returned for the original call. */
  readonly result: unknown;
}

/**
 * Decide whether a provider result is the exact deferred-load sentinel that
 * permits one internal replay. Pure function — orchestration stays with the
 * caller (the query loop).
 */
export function shouldHydrateAndReplay(
  input: HydrationCheckInput
): DeferredToolHydrationResult {
  const base: DeferredToolHydrationResult = {
    hydrated: false,
    replayed: false,
    replayCount: 0,
    toolName: input.toolName,
    callFingerprint: input.callFingerprint,
  };

  const result = input.result;
  if (!isReplayableSentinel(result)) return base;

  // The sentinel must arrive BEFORE any mutation evidence — a result that
  // also carries data, an error, or a state change is not a pure deferral.
  if (carriesMutationEvidence(result)) return base;

  return { ...base, hydrated: true, replayed: true, replayCount: 1 };
}

function isReplayableSentinel(result: unknown): boolean {
  if (typeof result === "string") {
    return DEFERRED_TOOL_SENTINEL_RE.test(result);
  }
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const text = `${String(r.error ?? "")} ${String(r.message ?? "")} ${String(
      r.content ?? ""
    )}`;
    if (DEFERRED_TOOL_SENTINEL_RE.test(text)) return true;
    return false;
  }
  return false;
}

function carriesMutationEvidence(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  // A pure sentinel has none of these; any of them means work happened.
  return (
    "sessionId" in r ||
    "success" in r ||
    "exit_code" in r ||
    "stdout" in r ||
    "data" in r
  );
}

/**
 * Session-scoped replay ledger: a fingerprint may replay at most once, ever,
 * per process (the cap is independent of session retry counts).
 */
export class HydrationReplayLedger {
  private readonly replayed = new Set<string>();

  /** Returns true when this fingerprint still has its one replay available. */
  consumeReplay(fingerprint: string): boolean {
    if (this.replayed.has(fingerprint)) return false;
    this.replayed.add(fingerprint);
    return true;
  }

  size(): number {
    return this.replayed.size;
  }
}

/**
 * Deterministic fingerprint of validated tool-call arguments (recursively
 * key-sorted) so the ledger dedupes the SAME call regardless of JSON key
 * ordering (FR-28 / design §8.7).
 */
export function stableToolCallFingerprint(args: unknown): string {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, walk(child)])
      );
    }
    return value;
  };
  return JSON.stringify(walk(args));
}

/**
 * The loop-side hydration decision (FR-28): the model called a tool the
 * deferred catalog knows but that is not exposed yet.
 *
 *  - "execute": hydrate + replay THIS call internally — the loop falls
 *    through to the normal execution path; the model never sees a
 *    synthetic retry failure. Consumes the fingerprint's one replay.
 *  - "exhausted": the fingerprint already used its replay — surface the
 *    typed INSTALL_TOOL_LOAD_RETRY_EXHAUSTED error instead.
 *  - "none": the tool is not a deferred catalog entry or is already
 *    discovered; ordinary dispatch continues untouched.
 */
export type DeferredHydrationDecision =
  | { readonly action: "execute" }
  | { readonly action: "exhausted" }
  | { readonly action: "none" };

export interface DeferredHydrationGateInput {
  /** The catalog entry for the called tool, when one exists. */
  readonly catalogEntry: { readonly loadPolicy: string } | undefined;
  /** Whether the deferred catalog mode is active for this turn. */
  readonly catalogActive: boolean;
  /** Tool names already discovered/exposed this conversation. */
  readonly discoveredToolNames: ReadonlySet<string>;
  readonly toolName: string;
  readonly callArguments: unknown;
  readonly conversationId: string;
  readonly ledger: HydrationReplayLedger;
}

export function decideDeferredToolHydration(
  input: DeferredHydrationGateInput
): DeferredHydrationDecision {
  if (!input.catalogActive) return { action: "none" };
  const entry = input.catalogEntry;
  if (!entry || entry.loadPolicy !== "deferred") return { action: "none" };
  if (input.discoveredToolNames.has(input.toolName)) return { action: "none" };
  const fingerprint = `${input.conversationId}:${
    input.toolName
  }:${stableToolCallFingerprint(input.callArguments)}`;
  return input.ledger.consumeReplay(fingerprint)
    ? { action: "execute" }
    : { action: "exhausted" };
}

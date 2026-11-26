/**
 * Route-specific task limits for the browser decision runner (technical
 * design §12; PRD §8). Defaults are engineering proposals; hard ceilings can
 * never be raised by model output or user task arguments — callers may only
 * lower them.
 */
import { BrowserDecisionRouteKind } from "@/entityTypes/browserDecisionTypes";

export interface BrowserTaskLimitSet {
  /** Active task runtime, excluding user waits (approval/handoff/pause). */
  readonly activeRuntimeDefaultMs: number;
  readonly activeRuntimeHardMs: number;
  readonly leafStepsDefault: number;
  readonly leafStepsHard: number;
  readonly decisionRequestsDefault: number;
  readonly decisionRequestsHard: number;
  readonly requestTimeoutDefaultMs: number;
  readonly requestTimeoutHardMs: number;
  readonly perStepWorkerTimeoutDefaultMs: number;
  readonly perStepWorkerTimeoutHardMs: number;
  readonly recoveryCallsDefault: number;
  readonly recoveryCallsHard: number;
  readonly fieldHelperCallsDefault: number;
  readonly fieldHelperCallsHard: number;
  readonly plannerCallsHard: number;
  readonly verifierCallsHard: number;
  /** Actual provider attempts per logical decision (retry+fallback+repair). */
  readonly attemptsPerDecision: number;
  readonly consecutiveEquivalentFailures: number;
}

const HOSTED_LIMITS: BrowserTaskLimitSet = {
  activeRuntimeDefaultMs: 120_000,
  activeRuntimeHardMs: 240_000,
  leafStepsDefault: 30,
  leafStepsHard: 100,
  decisionRequestsDefault: 45,
  decisionRequestsHard: 120,
  requestTimeoutDefaultMs: 3_000,
  requestTimeoutHardMs: 10_000,
  perStepWorkerTimeoutDefaultMs: 15_000,
  perStepWorkerTimeoutHardMs: 30_000,
  recoveryCallsDefault: 2,
  recoveryCallsHard: 3,
  fieldHelperCallsDefault: 4,
  fieldHelperCallsHard: 10,
  plannerCallsHard: 1,
  verifierCallsHard: 1,
  attemptsPerDecision: 2,
  consecutiveEquivalentFailures: 3,
};

const CUSTOM_LIMITS: BrowserTaskLimitSet = {
  ...HOSTED_LIMITS,
  activeRuntimeDefaultMs: 300_000,
  activeRuntimeHardMs: 600_000,
  requestTimeoutDefaultMs: 10_000,
  requestTimeoutHardMs: 30_000,
};

/** Chat routes additionally run a deterministic progress check interval. */
export const CHAT_ROUTE_PROGRESS_CHECK_INTERVAL_STEPS = 5;

export function limitsForRoute(route: BrowserDecisionRouteKind): BrowserTaskLimitSet {
  return route === "hosted" ? HOSTED_LIMITS : CUSTOM_LIMITS;
}

export interface MutableTaskBudget {
  activeRuntimeMs: number;
  leafSteps: number;
  decisionRequests: number;
  requestTimeoutMs: number;
  perStepWorkerTimeoutMs: number;
  recoveryCalls: number;
  fieldHelperCalls: number;
}

/**
 * Apply a caller-requested budget. A request may be any value up to the hard
 * ceiling ("may lower defaults; never raise hard ceilings"). Zero/negative or
 * non-finite inputs fall back to the default (never disable a bound).
 */
export function buildTaskBudget(
  route: BrowserDecisionRouteKind,
  requested?: Partial<MutableTaskBudget> | null,
): MutableTaskBudget {
  const limits = limitsForRoute(route);
  const clamp = (
    requestedValue: number | undefined,
    defaultValue: number,
    hardMax: number,
  ): number => {
    if (
      typeof requestedValue !== "number" ||
      !Number.isFinite(requestedValue) ||
      requestedValue <= 0
    ) {
      return defaultValue;
    }
    return Math.max(1, Math.min(Math.floor(requestedValue), hardMax));
  };
  return {
    activeRuntimeMs: clamp(
      requested?.activeRuntimeMs,
      limits.activeRuntimeDefaultMs,
      limits.activeRuntimeHardMs,
    ),
    leafSteps: clamp(requested?.leafSteps, limits.leafStepsDefault, limits.leafStepsHard),
    decisionRequests: clamp(
      requested?.decisionRequests,
      limits.decisionRequestsDefault,
      limits.decisionRequestsHard,
    ),
    requestTimeoutMs: clamp(
      requested?.requestTimeoutMs,
      limits.requestTimeoutDefaultMs,
      limits.requestTimeoutHardMs,
    ),
    perStepWorkerTimeoutMs: clamp(
      requested?.perStepWorkerTimeoutMs,
      limits.perStepWorkerTimeoutDefaultMs,
      limits.perStepWorkerTimeoutHardMs,
    ),
    recoveryCalls: clamp(
      requested?.recoveryCalls,
      limits.recoveryCallsDefault,
      limits.recoveryCallsHard,
    ),
    fieldHelperCalls: clamp(
      requested?.fieldHelperCalls,
      limits.fieldHelperCallsDefault,
      limits.fieldHelperCallsHard,
    ),
  };
}

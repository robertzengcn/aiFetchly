/**
 * Browser decision acceleration — shared domain types (technical design §8–§10).
 *
 * These types mirror the hosted decision contract v1 (server technical design
 * §5). The operation enum is the WIDENED set agreed in PRD D-FR-16; native
 * servers that do not accept every operation mark the affected task families
 * ineligible instead of silently dropping operations.
 *
 * A decision is a PROPOSAL. The desktop owns execution authority (PRD D-01):
 * provider output can never become a selector, handle, coordinate, or script.
 */

/** Widened decision operation set (PRD D-FR-16). */
export type BrowserDecisionOperation =
  | "CLICK"
  | "FILL"
  | "SELECT"
  | "PRESS_KEY"
  | "NAVIGATE"
  | "GO_BACK"
  | "HOVER"
  | "SCROLL_UP"
  | "SCROLL_DOWN"
  | "WAIT"
  | "EXTRACT"
  | "DONE"
  | "ESCALATE";

/** Bounded key set for PRESS_KEY (PRD D-FR-16). */
export const BROWSER_DECISION_PRESS_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;
export type BrowserDecisionPressKey = (typeof BROWSER_DECISION_PRESS_KEYS)[number];

/** Operations that require a target candidate selected from the observation. */
export const TARGETED_BROWSER_DECISION_OPERATIONS: readonly BrowserDecisionOperation[] = [
  "CLICK",
  "FILL",
  "SELECT",
  "HOVER",
  "EXTRACT",
];

/** Operations offered to the decision model for a given observation. */
export interface BrowserDecisionCandidate {
  /** Request-scoped opaque candidate id (never a selector or handle). */
  readonly candidate_id: string;
  readonly role: string;
  readonly name: string;
  /** Operations the candidate supports on the observed page. */
  readonly allowed_operations: readonly BrowserDecisionOperation[];
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  /** Native option ids for listbox/select controls (bounded). */
  readonly option_ids?: readonly string[];
  readonly option_labels?: readonly string[];
}

/** Sanitized decision request built from the current observation. */
export interface BrowserDecisionInput {
  readonly schema_version: 1;
  readonly request_id: string;
  readonly task_id: string;
  readonly step_id: string;
  readonly observation_id: string;
  readonly page_revision: number;
  readonly goal: string;
  readonly subgoal?: string | null;
  readonly constraints: readonly string[];
  readonly url: string;
  readonly title: string;
  readonly candidates: readonly BrowserDecisionCandidate[];
  readonly recent_actions: readonly BrowserRecentAction[];
  /** Operations the caller permits for this decision round. */
  readonly allowed_operations: readonly BrowserDecisionOperation[];
  readonly deadline_ms: number;
}

/** One previously executed action, summarized for decision context. */
export interface BrowserRecentAction {
  readonly operation: BrowserDecisionOperation;
  readonly target_descriptor?: string | null;
  readonly outcome: "executed" | "failed" | "effect_unknown";
  readonly error_code?: string | null;
}

/**
 * Semantic statuses of the decision contract v1. Chat adapters normalize a
 * model's ESCALATE to `llm_required`; never to `decided`.
 */
export type BrowserDecisionStatus =
  | "decided"
  | "llm_required"
  | "invalid_input"
  | "input_budget_exceeded"
  | "provider_error";

/** Where an uncertainty figure came from. Chat decisions have none. */
export type BrowserDecisionUncertaintySource =
  | "native_distribution"
  | "unavailable";

export interface BrowserDecisionUncertainty {
  readonly source: BrowserDecisionUncertaintySource;
  /** Calibrated only when source is native_distribution; null otherwise. */
  readonly confidence: number | null;
  readonly calibration_version?: string | null;
}

/** A concrete proposed action produced by a decision. */
export interface BrowserProposedAction {
  readonly operation: BrowserDecisionOperation;
  /** candidate_id from the input; required for targeted operations. */
  readonly target_id: string | null;
  /** option_id required for SELECT; must be an observed option. */
  readonly option_id: string | null;
  /** Required for PRESS_KEY; must be in the bounded key set. */
  readonly key: BrowserDecisionPressKey | null;
  /** Required for NAVIGATE: observed link candidate or plan URL (same-site). */
  readonly url: string | null;
}

export interface BrowserDecisionDecided {
  readonly status: "decided";
  readonly action: BrowserProposedAction;
  readonly uncertainty: BrowserDecisionUncertainty;
}

export interface BrowserDecisionLlmRequired {
  readonly status: "llm_required";
  readonly reason_code: string;
}

export interface BrowserDecisionInvalidInput {
  readonly status: "invalid_input";
  readonly reason_code: string;
}

export interface BrowserDecisionBudgetExceeded {
  readonly status: "input_budget_exceeded";
  readonly reason_code: string;
}

export interface BrowserDecisionProviderError {
  readonly status: "provider_error";
  readonly reason_code: string;
}

export type BrowserDecisionResult =
  | BrowserDecisionDecided
  | BrowserDecisionLlmRequired
  | BrowserDecisionInvalidInput
  | BrowserDecisionBudgetExceeded
  | BrowserDecisionProviderError;

/** The shared adapter interface every decision route implements. */
export interface BrowserDecisionClient {
  getCapabilities(signal: AbortSignal): Promise<BrowserDecisionCapabilities>;
  decide(
    input: BrowserDecisionInput,
    signal: AbortSignal
  ): Promise<BrowserDecisionResult>;
}

/** Advertised capabilities of a decision route (advisory only). */
export interface BrowserDecisionCapabilities {
  readonly operations: readonly BrowserDecisionOperation[];
  readonly supportsStructuredJsonSchema: boolean;
  readonly supportsForcedToolDecision: boolean;
  readonly supportsJsonObject: boolean;
  readonly nativeDecision: boolean;
  readonly maxCandidates: number;
  readonly deadlineDefaultMs: number;
  readonly deadlineHardMs: number;
  readonly cacheable: boolean;
}

/** Correlation record kept with every decision attempt. */
export interface BrowserDecisionAttempt {
  readonly request_id: string;
  readonly task_id: string;
  readonly step_id: string;
  readonly observation_id: string;
  readonly page_revision: number;
  readonly route: BrowserDecisionRouteKind;
  readonly model: string | null;
  readonly started_at_epoch_ms: number;
  readonly duration_ms: number | null;
  readonly usage_tokens: number | null;
  readonly cost_known: boolean;
}
export type BrowserDecisionRouteKind = "hosted" | "native" | "chat";

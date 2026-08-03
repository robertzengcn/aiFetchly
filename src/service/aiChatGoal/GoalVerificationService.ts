import type {
  AIChatGoalCriterion,
  GoalCriterionResult,
  GoalVerificationResult,
} from "@/entityTypes/aiChatGoalTypes";

/**
 * Deterministic-first goal verification (design §8).
 *
 * The controller collects system evidence; this service evaluates it against
 * the goal contract. A maker-model "completed" claim is NOT evidence and can
 * never satisfy a criterion by itself. Required criteria need fresh, passing,
 * criterion-specific evidence. An LLM verifier (Phase 9) may resolve
 * qualitative (kind:llm) criteria only, and its output is schema-validated and
 * cannot override a failed required deterministic criterion.
 *
 * Pure with respect to inputs: deterministic and heavily unit tested.
 */

/** Collected evidence for one criterion (produced by the evidence collector). */
export interface GoalVerificationEvidence {
  readonly criterionId: string;
  readonly state: "pass" | "fail" | "pending";
  /** Source revision the evidence was produced against (for freshness). */
  readonly sourceRevision?: string;
  readonly timestamp: string;
  readonly reason?: string;
  /** Stable error signature for command/tool failures (repeated-failure tracking). */
  readonly failureSignature?: string;
}

/** Pluggable LLM verifier for kind:llm criteria (wired in Phase 9). */
export type GoalLlmVerifier = (
  criteria: readonly AIChatGoalCriterion[],
  evidenceByCriterion: ReadonlyMap<
    string,
    GoalVerificationEvidence | undefined
  >
) => Promise<readonly GoalCriterionResult[]>;

export interface GoalVerificationOptions {
  /** Current goal-relevant source revision (freshness gate). */
  readonly currentSourceRevision?: string;
  /** Repeated-failure counts keyed by failure fingerprint (tracked by controller). */
  readonly failureCounts?: ReadonlyMap<string, number>;
  readonly repeatedFailureThreshold?: number;
  /** Pending conditions from the maker turn -> needs_user_input. */
  readonly pendingPermission?: boolean;
  readonly pendingPlanApproval?: boolean;
  readonly pendingQuestion?: boolean;
  readonly llmVerifier?: GoalLlmVerifier;
}

export interface GoalContractInput {
  readonly objective: string;
  readonly criteria: readonly AIChatGoalCriterion[];
}

/** Normalize an error signature so trivial differences don't split fingerprints. */
function normalizeError(raw: string | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/['"`]/g, "")
    .slice(0, 160)
    .trim();
}

/**
 * Repeated-failure fingerprint (design §8.4). A new source revision changes the
 * fingerprint, resetting the count because the system under evaluation changed.
 */
export function computeFailureFingerprint(
  criterion: AIChatGoalCriterion,
  evidence: GoalVerificationEvidence | undefined,
  currentSourceRevision: string | undefined
): string {
  const identity =
    criterion.verification.command ??
    criterion.verification.filePath ??
    criterion.verification.kind;
  return [
    criterion.criterionId,
    criterion.verification.kind,
    identity,
    normalizeError(evidence?.failureSignature ?? evidence?.reason),
    currentSourceRevision ?? "",
  ].join("|");
}

/** Evaluate a command/file/manual criterion against its evidence. */
function evaluateDeterministic(
  criterion: AIChatGoalCriterion,
  evidence: GoalVerificationEvidence | undefined,
  options: GoalVerificationOptions
): GoalCriterionResult {
  const kind = criterion.verification.kind;

  if (kind === "manual") {
    // Manual criteria pass only on explicit user confirmation.
    if (evidence?.state === "pass") {
      return {
        criterionId: criterion.criterionId,
        passed: true,
        evidenceRefs: evidence ? [evidence.criterionId] : [],
        reason: "user confirmed",
      };
    }
    return {
      criterionId: criterion.criterionId,
      passed: false,
      evidenceRefs: [],
      reason: "awaiting user confirmation",
    };
  }

  // command / file — deterministic.
  if (!evidence) {
    return {
      criterionId: criterion.criterionId,
      passed: false,
      evidenceRefs: [],
      reason: "no evidence collected",
    };
  }
  if (evidence.state === "fail") {
    return {
      criterionId: criterion.criterionId,
      passed: false,
      evidenceRefs: [evidence.criterionId],
      reason: evidence.reason ?? "evidence failed",
    };
  }
  if (evidence.state === "pending") {
    return {
      criterionId: criterion.criterionId,
      passed: false,
      evidenceRefs: [],
      reason: "evidence pending",
    };
  }
  // state === "pass" — enforce freshness.
  if (
    options.currentSourceRevision &&
    evidence.sourceRevision &&
    evidence.sourceRevision !== options.currentSourceRevision
  ) {
    return {
      criterionId: criterion.criterionId,
      passed: false,
      evidenceRefs: [evidence.criterionId],
      reason: "stale evidence: produced before the latest change",
    };
  }
  return {
    criterionId: criterion.criterionId,
    passed: true,
    evidenceRefs: [evidence.criterionId],
    reason: "fresh passing evidence",
  };
}

/** Validate an LLM verifier result: reject satisfied verdicts without evidence refs. */
function validateLlmResult(result: GoalCriterionResult): GoalCriterionResult {
  if (result.passed && result.evidenceRefs.length === 0) {
    return {
      criterionId: result.criterionId,
      passed: false,
      evidenceRefs: [],
      reason: "rejected LLM verdict: no evidence references",
    };
  }
  return result;
}

export class GoalVerificationService {
  async verify(
    goal: GoalContractInput,
    evidence: readonly GoalVerificationEvidence[],
    options: GoalVerificationOptions = {}
  ): Promise<GoalVerificationResult> {
    const evidenceByCriterion = new Map<
      string,
      GoalVerificationEvidence | undefined
    >();
    for (const c of goal.criteria) {
      evidenceByCriterion.set(c.criterionId, undefined);
    }
    for (const e of evidence) {
      evidenceByCriterion.set(e.criterionId, e);
    }

    const results: GoalCriterionResult[] = [];
    const llmCriteria: AIChatGoalCriterion[] = [];

    for (const criterion of goal.criteria) {
      if (criterion.verification.kind === "llm") {
        llmCriteria.push(criterion);
        continue;
      }
      results.push(
        evaluateDeterministic(
          criterion,
          evidenceByCriterion.get(criterion.criterionId),
          options
        )
      );
    }

    if (llmCriteria.length > 0) {
      if (options.llmVerifier) {
        const llmResults = await options.llmVerifier(
          llmCriteria,
          evidenceByCriterion
        );
        const known = new Set(llmCriteria.map((c) => c.criterionId));
        for (const r of llmResults) {
          // Drop results for criteria not in the contract (unknown criterion ids).
          if (!known.has(r.criterionId)) continue;
          results.push(validateLlmResult(r));
        }
        // Any llm criterion the verifier didn't return a result for is unresolved.
        const returned = new Set(llmResults.map((r) => r.criterionId));
        for (const c of llmCriteria) {
          if (!returned.has(c.criterionId)) {
            results.push({
              criterionId: c.criterionId,
              passed: false,
              evidenceRefs: [],
              reason: "LLM verifier returned no result",
            });
          }
        }
      } else {
        for (const c of llmCriteria) {
          results.push({
            criterionId: c.criterionId,
            passed: false,
            evidenceRefs: [],
            reason: "LLM verifier unavailable",
          });
        }
      }
    }

    const resultByCriterion = new Map(results.map((r) => [r.criterionId, r]));
    const required = goal.criteria.filter((c) => c.required);

    // Repeated-failure blocking (§8.4).
    const threshold = options.repeatedFailureThreshold ?? 3;
    let blocked = false;
    if (options.failureCounts) {
      for (const c of goal.criteria) {
        const r = resultByCriterion.get(c.criterionId);
        if (c.required && r && !r.passed) {
          const fp = computeFailureFingerprint(
            c,
            evidenceByCriterion.get(c.criterionId),
            options.currentSourceRevision
          );
          if ((options.failureCounts.get(fp) ?? 0) >= threshold) {
            blocked = true;
          }
        }
      }
    }

    const pendingUserInput =
      options.pendingPermission === true ||
      options.pendingPlanApproval === true ||
      options.pendingQuestion === true;

    const requiredFailed = required.some(
      (c) => resultByCriterion.get(c.criterionId)?.passed === false
    );
    const allRequiredPass =
      required.length > 0 &&
      required.every(
        (c) => resultByCriterion.get(c.criterionId)?.passed === true
      );

    let verdict: GoalVerificationResult["verdict"];
    if (pendingUserInput) {
      verdict = "needs_user_input";
    } else if (blocked) {
      verdict = "blocked";
    } else if (requiredFailed || !allRequiredPass) {
      verdict = "not_satisfied";
    } else {
      verdict = "satisfied";
    }

    return { verdict, criteria: results };
  }
}

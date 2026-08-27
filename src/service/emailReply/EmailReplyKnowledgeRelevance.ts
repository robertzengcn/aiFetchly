/**
 * Retrieval relevance + abstention decision (technical design §11.3/§11.5,
 * FR-009). Pure: takes scored candidates and the mailbox scope, returns a
 * relevance decision the generation path must respect.
 *
 * Rules:
 *  - a scope with allowAllDocuments=0 and an empty allowlist means SEARCH
 *    NOTHING — it can never degrade into "search everything";
 *  - candidates whose document is outside the mailbox allowlist are dropped
 *    before scoring (cross-mailbox isolation);
 *  - neighbor chunks never qualify on an inherited score — only direct matches
 *    face the relevance threshold;
 *  - duplicate / substantially-overlapping chunks are removed;
 *  - inactive documents are excluded per policy;
 *  - outcomes are distinguishable: relevant / low_relevance / no_results /
 *    conflicting — and conflicting or missing evidence forces review for
 *    company-specific claims.
 */

export const RELEVANCE_THRESHOLD_PROFILE = "relevance-profile-v1";
export const DEFAULT_RELEVANCE_THRESHOLD = 0.55;
/** Two chunks whose overlap exceeds this fraction are duplicates. */
const OVERLAP_FRACTION = 0.7;

export interface RetrievedCandidate {
  readonly documentId: number;
  readonly documentActive: boolean;
  readonly text: string;
  readonly score: number;
  /** True when this chunk only rides along with a scored parent (§11.3). */
  readonly isNeighbor: boolean;
}

export interface KnowledgeScopeConfig {
  readonly allowAllDocuments: boolean;
  readonly allowedDocumentIds: readonly number[];
  readonly excludeInactiveDocuments: boolean;
}

export type KnowledgeRelevanceOutcome =
  | "relevant"
  | "low_relevance"
  | "no_results"
  | "scope_empty"
  | "conflicting";

export interface KnowledgeSelection {
  readonly documentId: number;
  readonly text: string;
  readonly score: number;
}

export interface KnowledgeRelevanceDecision {
  readonly outcome: KnowledgeRelevanceOutcome;
  readonly selections: readonly KnowledgeSelection[];
  readonly threshold: number;
  readonly thresholdProfile: string;
  /** Human-review reason when the outcome demands it. */
  readonly reviewReason: string | null;
  /** Counts for audit metadata (no body content). */
  readonly candidatesIn: number;
  readonly droppedByScope: number;
  readonly droppedInactive: number;
  readonly droppedDuplicate: number;
  readonly droppedLowScore: number;
}

/** Detect materially conflicting money/date values among qualifying chunks. */
function detectConflicts(
  selections: readonly KnowledgeSelection[]
): string | null {
  const moneys = selections
    .map((s) => s.text.match(/[$€£]\s?\d[\d.,]*|\b\d+\s?(?:usd|eur|gbp)\b/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[0].toLowerCase());
  const unique = new Set(moneys);
  if (moneys.length >= 2 && unique.size > 1) return "money";
  return null;
}

/** Cheap overlap check: shared word-set fraction between two chunks. */
function overlaps(a: string, b: string): boolean {
  // Chunks that quote DIFFERENT money values are conflicting evidence, not
  // duplicates — never collapse them (the conflict detector must see both).
  const moneyOf = (t: string) =>
    (t.match(/[$€£]\s?\d[\d.,]*|\b\d+\s?(?:usd|eur|gbp)\b/i) ?? []).map((m) =>
      m.toLowerCase()
    );
  const ma = moneyOf(a);
  const mb = moneyOf(b);
  if (ma.length && mb.length && ma.join("|") !== mb.join("|")) return false;

  const words = (t: string) =>
    new Set(t.toLowerCase().split(/\s+/).filter(Boolean));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= OVERLAP_FRACTION;
}

export function decideKnowledgeRelevance(
  candidates: readonly RetrievedCandidate[],
  scope: KnowledgeScopeConfig,
  options: { threshold?: number } = {}
): KnowledgeRelevanceDecision {
  const threshold = options.threshold ?? DEFAULT_RELEVANCE_THRESHOLD;
  let droppedByScope = 0;
  let droppedInactive = 0;
  let droppedDuplicate = 0;
  let droppedLowScore = 0;

  // Scope empty = search nothing (never search everything).
  if (!scope.allowAllDocuments && scope.allowedDocumentIds.length === 0) {
    return {
      outcome: "scope_empty",
      selections: [],
      threshold,
      thresholdProfile: RELEVANCE_THRESHOLD_PROFILE,
      reviewReason: "No knowledge scope is configured for this mailbox",
      candidatesIn: candidates.length,
      droppedByScope: candidates.length,
      droppedInactive: 0,
      droppedDuplicate: 0,
      droppedLowScore: 0,
    };
  }

  // 1. Scope filter (cross-mailbox isolation) before any scoring use.
  const allowed = new Set(scope.allowedDocumentIds);
  let pool = candidates.filter((c) => {
    const inScope = scope.allowAllDocuments || allowed.has(c.documentId);
    if (!inScope) droppedByScope++;
    return inScope;
  });

  // 2. Inactive/stale documents per policy.
  pool = pool.filter((c) => {
    const ok = !(scope.excludeInactiveDocuments && !c.documentActive);
    if (!ok) droppedInactive++;
    return ok;
  });

  if (pool.length === 0) {
    return {
      outcome: "no_results",
      selections: [],
      threshold,
      thresholdProfile: RELEVANCE_THRESHOLD_PROFILE,
      reviewReason: null,
      candidatesIn: candidates.length,
      droppedByScope,
      droppedInactive,
      droppedDuplicate: 0,
      droppedLowScore: 0,
    };
  }

  // 3. Neighbors never qualify by inherited score; only direct matches face
  //    the threshold. Neighbors may accompany a qualifying DIRECT match for
  //    continuity but do not independently satisfy relevance.
  const direct = pool.filter((c) => !c.isNeighbor);
  const qualifying = direct.filter((c) => {
    const ok = c.score >= threshold;
    if (!ok) droppedLowScore++;
    return ok;
  });

  if (qualifying.length === 0) {
    return {
      outcome: "low_relevance",
      selections: [],
      threshold,
      thresholdProfile: RELEVANCE_THRESHOLD_PROFILE,
      reviewReason:
        "Knowledge results did not meet the relevance threshold; do not answer company-specific questions from general knowledge",
      candidatesIn: candidates.length,
      droppedByScope,
      droppedInactive,
      droppedDuplicate: 0,
      droppedLowScore,
    };
  }

  // 4. Deduplicate overlapping chunks (keep the higher score).
  const kept: KnowledgeSelection[] = [];
  for (const c of [...qualifying].sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => overlaps(k.text, c.text))) {
      droppedDuplicate++;
      continue;
    }
    kept.push({ documentId: c.documentId, text: c.text, score: c.score });
  }

  // 5. Conflicting values among surviving evidence require review.
  const conflict = detectConflicts(kept);

  return {
    outcome: conflict ? "conflicting" : "relevant",
    selections: kept,
    threshold,
    thresholdProfile: RELEVANCE_THRESHOLD_PROFILE,
    reviewReason: conflict
      ? `Knowledge sources disagree on ${conflict} values; human review required`
      : null,
    candidatesIn: candidates.length,
    droppedByScope,
    droppedInactive,
    droppedDuplicate,
    droppedLowScore,
  };
}

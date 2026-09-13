/**
 * AIChatSummaryValidator — local structured-summary validation
 * (technical-design §10).
 *
 * Validates every model-generated SectionSummaryV1 locally. Does NOT depend
 * on provider JSON-schema enforcement: supports plain completion providers
 * with strict parsing. Applies structural caps and reference + content checks:
 *
 * Initial structural caps (§10):
 *   - synopsis ≤ 2,000 characters
 *   - each fact text ≤ 500 characters
 *   - ≤ 20 facts per category (decisions, constraints, pending, toolOutcomes)
 *   - ≤ 4 references per fact
 *   - ≤ 20 topics
 *
 * Source references are validated against the bounded supplied source map;
 * references outside it are rejected. A valid reference proves source
 * existence, not semantic entailment.
 *
 * Generated summaries must contain no invention, explicit uncertainty is
 * encouraged, no credentials, and no generated permission grants. Canonical
 * goal/plan/approval records are authoritative and loaded separately.
 *
 * Receipts and generated summaries always use `exact: false`; only verified
 * original text slices use `exact: true`.
 */

import { z } from "zod/v4";
import type {
  SectionSummaryV1,
  SummaryFact,
} from "@/entityTypes/aiChatArchiveTypes";

/** Structural caps (§10). */
export const SUMMARY_CAPS = {
  synopsisMaxChars: 2_000,
  factMaxChars: 500,
  maxFactsPerCategory: 20,
  maxRefsPerFact: 4,
  maxTopics: 20,
  topicMaxChars: 80,
} as const;

/** Phrases indicating a generated permission grant (§10 — reject). */
const PERMISSION_GRANT_PATTERNS = [
  /grant(?:ed|ing)?\s+permission/i,
  /on\s+(?:my|their|the)\s+behalf\b/i,
  /authorize(?:d|s)?\s+(?:me|them|actions?)/i,
  /permission\s+to\s+(?:send|act|execute|perform)/i,
  /approved?\s+(?:sending|executing|acting)\s+(?:emails?|on\s+behalf)/i,
  /implicit\s+consent/i,
  /pre-?authorize/i,
] as const;

/** Patterns indicating leaked credentials (§10 — reject). */
const CREDENTIAL_PATTERNS = [
  /sk-proj-/i,
  /sk-ant-/i,
  /\bapi[_-]?key\b[:=]?\s*['"]?[a-z0-9_-]{16,}/i,
  /\b(?:password|passwd|secret|token)\b[:=]?\s*['"]?\S{6,}/i,
  /\bbearer\s+[a-z0-9._-]{16,}/i,
] as const;

/** Zod schema mirroring SectionSummaryV1 (§10). */
const summaryFactSchema = z.object({
  text: z.string(),
  status: z.enum(["proposed", "accepted", "superseded", "uncertain"]),
  sourceIds: z.array(z.string()),
});

const sectionSummarySchema = z.object({
  version: z.literal(1),
  synopsis: z.string(),
  decisions: z.array(summaryFactSchema),
  constraints: z.array(summaryFactSchema),
  pending: z.array(summaryFactSchema),
  toolOutcomes: z.array(summaryFactSchema),
  topics: z.array(z.string()),
});

/** Result of validating a SectionSummaryV1. */
export interface SummaryValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** The validated summary (present when ok). */
  readonly summary?: SectionSummaryV1;
}

export class AIChatSummaryValidator {
  /**
   * Validate a model-generated summary against §10 structural + reference +
   * content rules. `validSourceIds` is the bounded map of source IDs supplied
   * to the model for this section; any reference outside it is rejected.
   */
  validate(
    input: unknown,
    validSourceIds: ReadonlySet<string>
  ): SummaryValidationResult {
    const errors: string[] = [];

    // 1. Zod parse (no provider JSON-schema reliance — §10).
    const parsed = sectionSummarySchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `schema: ${i.path.join(".")}: ${i.message}`
      );
      return { ok: false, errors: issues };
    }
    const summary = parsed.data as SectionSummaryV1;

    // 2. Structural caps.
    if (summary.synopsis.length > SUMMARY_CAPS.synopsisMaxChars) {
      errors.push(
        `synopsis exceeds ${SUMMARY_CAPS.synopsisMaxChars} characters (${summary.synopsis.length})`
      );
    }

    const categories: ReadonlyArray<readonly [string, readonly SummaryFact[]]> =
      [
        ["decisions", summary.decisions],
        ["constraints", summary.constraints],
        ["pending", summary.pending],
        ["toolOutcomes", summary.toolOutcomes],
      ];

    for (const [name, facts] of categories) {
      if (facts.length > SUMMARY_CAPS.maxFactsPerCategory) {
        errors.push(
          `${name} exceeds ${SUMMARY_CAPS.maxFactsPerCategory} facts (${facts.length})`
        );
      }
      for (const fact of facts) {
        if (fact.text.length > SUMMARY_CAPS.factMaxChars) {
          errors.push(
            `${name} fact exceeds ${SUMMARY_CAPS.factMaxChars} characters (${fact.text.length})`
          );
        }
        if (fact.sourceIds.length > SUMMARY_CAPS.maxRefsPerFact) {
          errors.push(
            `${name} fact has ${fact.sourceIds.length} references (max ${SUMMARY_CAPS.maxRefsPerFact})`
          );
        }
        // 3. Reference validation against the bounded supplied map.
        for (const sid of fact.sourceIds) {
          if (!validSourceIds.has(sid)) {
            errors.push(`${name} fact references unknown sourceId: ${sid}`);
          }
        }
        // 4. Content checks: permission grants + credentials.
        if (matchesAny(fact.text, PERMISSION_GRANT_PATTERNS)) {
          errors.push(
            `${name} fact contains generated permission-grant language (§10): "${fact.text.slice(
              0,
              60
            )}…"`
          );
        }
        if (matchesAny(fact.text, CREDENTIAL_PATTERNS)) {
          errors.push(
            `${name} fact appears to contain credentials (§10): "${fact.text.slice(
              0,
              60
            )}…"`
          );
        }
      }
    }

    if (summary.topics.length > SUMMARY_CAPS.maxTopics) {
      errors.push(
        `topics exceed ${SUMMARY_CAPS.maxTopics} (${summary.topics.length})`
      );
    }
    for (const topic of summary.topics) {
      if (topic.length > SUMMARY_CAPS.topicMaxChars) {
        errors.push(
          `topic exceeds ${SUMMARY_CAPS.topicMaxChars} characters: "${topic}"`
        );
      }
    }

    // Synopsis content checks.
    if (matchesAny(summary.synopsis, PERMISSION_GRANT_PATTERNS)) {
      errors.push(
        "synopsis contains generated permission-grant language (§10)"
      );
    }
    if (matchesAny(summary.synopsis, CREDENTIAL_PATTERNS)) {
      errors.push("synopsis appears to contain credentials (§10)");
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true, errors: [], summary };
  }
}

/** Test a string against a list of regex patterns. */
function matchesAny(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  for (const p of patterns) {
    if (p.test(text)) return true;
  }
  return false;
}

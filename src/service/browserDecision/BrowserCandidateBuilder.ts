/**
 * Candidate preparation (PRD D-FR-12..14; technical design §8).
 *
 * Derives decision candidates from the sanitized observation. Candidate ids
 * are request-scoped opaque labels — provider output can never become a
 * selector, handle, coordinate, or script (D-AC-04). Sensitive controls are
 * excluded by OBSERVED input type, not a model's role label.
 */
import type { BrowserDecisionCandidate, BrowserDecisionOperation } from "@/entityTypes/browserDecisionTypes";

export interface ObservationElementLike {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly valueSummary?: string | null;
  readonly disabled?: boolean | null;
  readonly checked?: boolean | null;
  readonly selected?: boolean | null;
  /** F14: observed SELECT options. */
  readonly option_ids?: readonly string[] | null;
  readonly option_labels?: readonly string[] | null;
}

const ROLE_OPERATIONS: Record<string, readonly BrowserDecisionOperation[]> = {
  button: ["CLICK"],
  link: ["CLICK", "NAVIGATE"],
  textbox: ["CLICK", "FILL"],
  searchbox: ["CLICK", "FILL"],
  combobox: ["CLICK", "SELECT"],
  listbox: ["CLICK", "SELECT"],
  checkbox: ["CLICK"],
  radio: ["CLICK"],
  menuitem: ["CLICK"],
  tab: ["CLICK"],
  option: ["CLICK"],
  img: ["CLICK"],
  generic: ["CLICK", "HOVER"],
};

/** Operations offered to the decision model for this runner. */
export const RUNNER_OPERATIONS: readonly BrowserDecisionOperation[] = [
  "CLICK",
  "FILL",
  "SELECT",
  "PRESS_KEY",
  "NAVIGATE",
  "GO_BACK",
  "HOVER",
  "SCROLL_UP",
  "SCROLL_DOWN",
  "WAIT",
  "EXTRACT",
  "DONE",
  "ESCALATE",
];

const SECRET_VALUE_SUMMARIES = new Set(["[password-like]", "[REDACTED]", "[credential]"]);

export interface CandidateBuildInput {
  readonly elements: readonly ObservationElementLike[];
  /** Shortlist ceiling for small-budget routes (proposed 8–16). */
  readonly maxCandidates?: number;
  readonly allowedOperations?: readonly BrowserDecisionOperation[];
}

export function buildDecisionCandidates(
  input: CandidateBuildInput
): BrowserDecisionCandidate[] {
  const allowed = input.allowedOperations ?? RUNNER_OPERATIONS;
  const max = input.maxCandidates ?? 16;
  const candidates: BrowserDecisionCandidate[] = [];
  for (const element of input.elements) {
    if (candidates.length >= max) {
      break;
    }
    // F08: a ref without a usable handle is never a decision candidate —
    // the model would act on an action that can only fail.
    if (element.ref === "e_nohandle") {
      continue;
    }
    // Sensitive inputs are excluded by the sanitizer's value summary.
    if (element.valueSummary && SECRET_VALUE_SUMMARIES.has(element.valueSummary)) {
      continue;
    }
    if (element.disabled) {
      continue;
    }
    const base = ROLE_OPERATIONS[element.role] ?? ROLE_OPERATIONS.generic!;
    const operations = base.filter((op) => allowed.includes(op));
    if (operations.length === 0) {
      continue;
    }
    candidates.push({
      candidate_id: element.ref,
      role: element.role,
      name: element.name.slice(0, 200),
      allowed_operations: operations,
      disabled: Boolean(element.disabled),
      ...(element.checked != null ? { checked: element.checked } : {}),
      ...(element.selected != null ? { selected: element.selected } : {}),
      // F14: the decision can only pick OBSERVED options.
      ...(element.option_ids != null ? { option_ids: element.option_ids } : {}),
      ...(element.option_labels != null
        ? { option_labels: element.option_labels }
        : {}),
    });
  }
  return candidates;
}

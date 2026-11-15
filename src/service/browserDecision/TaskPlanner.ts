/**
 * Task planner (N02/D-FR-05; technical design §8.3, §11.4).
 *
 * ONE bounded planning call per task, before the loop: the planner refines
 * completion criteria, establishes unambiguous VALUE BINDINGS (search query,
 * dates, filters — the planner establishes values once, §8.3), and proposes
 * the first subgoal. A planner failure is its OWN terminal reason
 * (`planner_failed`) — never silently retried inside the loop.
 *
 * Secret-shaped plan values are rejected (D-FR-20): a binding whose value
 * looks like a credential is dropped, never stored, never typed.
 */
import type {
  BrowserDecisionClient,
  BrowserDecisionInput,
} from "@/entityTypes/browserDecisionTypes";
import type { CompletionCriterion } from "@/service/browserDecision/BrowserTaskRunner";
import { rejectSecretShaped } from "@/entityTypes/skillInstallationTypes";

export interface TaskPlan {
  /** Refined criteria (planner-supplied, merged with caller criteria). */
  readonly completionCriteria: readonly CompletionCriterion[];
  /** Unambiguous field-to-value bindings established once (§8.3). */
  readonly bindings: ReadonlyArray<{
    /** A stable field key the helper can match (name/label/placeholder fragment). */
    readonly field: string;
    /** The resolved, secret-checked value to type. */
    readonly value: string;
  }>;
  /** The first subgoal for the loop's decision input. */
  readonly firstSubgoal: string | null;
}

export interface PlannerRunInput {
  readonly goal: string;
  readonly constraints: readonly string[];
  readonly completionCriteria: readonly CompletionCriterion[];
  readonly url: string;
  readonly title: string;
}

const PLAN_MAX_BINDINGS = 8;
const BINDING_VALUE_MAX_CHARS = 2_000;

/** Shape of the bounded plan JSON the planner is asked for. */
interface RawPlan {
  readonly completion_criteria?: unknown;
  readonly bindings?: unknown;
  readonly first_subgoal?: unknown;
}

/**
 * D-FR-05: one planner call. Returns null on any failure (transport,
 * schema, budget) — the caller maps null to the `planner_failed` terminal.
 */
export async function runPlanner(
  client: BrowserDecisionClient,
  input: PlannerRunInput,
  signal: AbortSignal
): Promise<TaskPlan | null> {
  if (signal.aborted) {
    return null;
  }
  // The planner runs as a compact browser-decision question whose "action"
  // is DONE-with-text — reusing the strict wire schema instead of a second
  // contract. The `text` field carries the plan JSON.
  const plannerInput: BrowserDecisionInput = {
    schema_version: 1,
    request_id: `plan_${Math.random().toString(36).slice(2, 10)}`,
    task_id: `plan_${Math.random().toString(36).slice(2, 10)}`,
    step_id: "plan_1",
    observation_id: "plan_virtual",
    page_revision: 1,
    goal: input.goal.slice(0, 2_000),
    subgoal:
      "PLAN ONCE: return DONE with text = a JSON object {completion_criteria:[{kind,value}],bindings:[{field,value}],first_subgoal}. kinds: url_contains|element_present|extract_nonempty|text_contains. Bindings are field->value pairs established once. At most 8 bindings, values at most 2000 chars.",
    constraints: input.constraints.slice(0, 16),
    completion_criteria: input.completionCriteria.map(
      (c) => `${c.kind}:${c.value}`
    ),
    url: input.url,
    title: input.title.slice(0, 512),
    candidates: [],
    recent_actions: [],
    allowed_operations: ["DONE"],
    deadline_ms: 10_000,
  };
  const decision = await client.decide(plannerInput, signal);
  if (decision.status !== "decided" || decision.action.operation !== "DONE") {
    return null;
  }
  const text = decision.action.text;
  if (!text || text.length > 16_000) {
    return null;
  }
  let raw: RawPlan;
  try {
    raw = JSON.parse(text) as RawPlan;
  } catch {
    return null;
  }
  return sanitizePlan(raw);
}

/** Validate the raw plan into the bounded, secret-checked shape. */
export function sanitizePlan(raw: RawPlan): TaskPlan | null {
  const criteria: CompletionCriterion[] = [];
  const VALID_KINDS = new Set([
    "url_contains",
    "element_present",
    "extract_nonempty",
    "text_contains",
  ]);
  if (Array.isArray(raw.completion_criteria)) {
    for (const entry of raw.completion_criteria.slice(0, 8)) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const kind = record["kind"];
      const value = record["value"];
      if (
        typeof kind === "string" &&
        VALID_KINDS.has(kind) &&
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 500
      ) {
        criteria.push({
          kind: kind as CompletionCriterion["kind"],
          value: value.trim(),
        });
      }
    }
  }
  const bindings: Array<{ field: string; value: string }> = [];
  if (Array.isArray(raw.bindings)) {
    for (const entry of raw.bindings.slice(0, PLAN_MAX_BINDINGS)) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const field = record["field"];
      const value = record["value"];
      if (
        typeof field !== "string" ||
        field.trim().length === 0 ||
        field.length > 200 ||
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > BINDING_VALUE_MAX_CHARS
      ) {
        continue;
      }
      // D-FR-20: secret-shaped binding values are DROPPED — a plan can
      // never smuggle a credential into a typed field.
      const problems = rejectSecretShaped(value, ["plan.binding", field]);
      if (problems.length > 0) {
        continue;
      }
      bindings.push({ field: field.trim(), value });
    }
  }
  const firstSubgoal =
    typeof raw.first_subgoal === "string" &&
    raw.first_subgoal.trim().length > 0 &&
    raw.first_subgoal.length <= 1_000
      ? raw.first_subgoal.trim()
      : null;
  // An empty plan (no criteria, no bindings, no subgoal) is a failure —
  // the planner produced nothing usable.
  if (criteria.length === 0 && bindings.length === 0 && !firstSubgoal) {
    return null;
  }
  return { completionCriteria: criteria, bindings, firstSubgoal };
}

/**
 * Deterministic browser-action risk classification (technical design §15.4,
 * §17; PRD FR-P0-014).
 *
 * PURE function over sanitized action context — never over raw page content.
 * The classification is the SECURITY FLOOR: an LLM-asserted risk class can
 * only RAISE the result, never lower it.
 *
 *   read                 → auto (covered by session-level consent)
 *   reversible_write     → auto (session-level consent; ordinary form use)
 *   consequential_write  → ALWAYS user approval (publish/send/delete/follow/
 *                          upload/submit/… descriptors)
 *   local_data_delete    → ALWAYS user approval (cache clear)
 *   credential_or_security → HANDOFF (never automated, never in prompts)
 *   privileged_script    → reserved; the classifier never assigns it
 */

export type BrowserRiskClass =
  | "read"
  | "reversible_write"
  | "consequential_write"
  | "credential_or_security"
  | "local_data_delete"
  | "privileged_script";

export type BrowserRiskRouting = "auto" | "approval" | "handoff";

/** Sanitized action context (roles/name summaries/URL — never raw content). */
export interface BrowserActionContext {
  readonly actionType: string;
  readonly targetRole?: string | null;
  readonly targetName?: string | null;
  readonly url?: string | null;
  /** Model-asserted risk class — can only raise, never lower. */
  readonly modelAssertedRiskClass?: BrowserRiskClass | null;
}

export interface BrowserRiskAssessment {
  readonly riskClass: BrowserRiskClass;
  readonly requiresApproval: boolean;
  readonly routing: BrowserRiskRouting;
  readonly reasonCode: string;
}

const SEVERITY: Readonly<Record<BrowserRiskClass, number>> = {
  read: 0,
  reversible_write: 1,
  consequential_write: 2,
  local_data_delete: 2,
  credential_or_security: 3,
  privileged_script: 4,
};

/**
 * Action/name/url fragments that make a write CONSEQUENTIAL. Matched against
 * sanitized descriptors only (target name summary, program intent) — never
 * full page text.
 */
const CONSEQUENTIAL_PATTERN =
  /\b(publish|unpublish|post|send|delete|remove|follow|unfollow|upload|submit|subscribe|unsubscribe|buy|purchase|pay|checkout|donate|message|comment|reply|vote|share|retweet|tweet|withdraw|transfer)\b/i;

/** URLs that enter credential/security flows — always handoff territory. */
const CREDENTIAL_URL_PATTERN =
  /(login|log-in|log_in|signin|sign-in|sign_up|signup|password|passkey|\/auth\/|accounts\.|2fa|otp|mfa|recover|verify[-_]?identity)/i;

/** Field descriptors that identify credential/secret inputs. */
const CREDENTIAL_FIELD_PATTERN =
  /\b(password|passcode|passkey|otp|one[- ]?time|2fa|mfa|two[- ]?factor|verification code|security code|recovery (code|key|email|phone))\b/i;

const READ_ACTION_TYPES = new Set([
  "observe",
  "extract",
  "screenshot",
  "wait_for",
  "scroll",
  "press_key",
  "get_status",
  "request_handoff",
  "resume_after_handoff",
  "start_session",
  "stop_session",
]);

function maxClass(
  a: BrowserRiskClass,
  b: BrowserRiskClass
): BrowserRiskClass {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

export class BrowserActionRiskClassifier {
  /**
   * Classify one action context. Deterministic; the model's asserted class
   * (when provided) can only RAISE the severity (§15.4).
   */
  public classify(context: BrowserActionContext): BrowserRiskAssessment {
    let riskClass: BrowserRiskClass;
    let reasonCode: string;

    switch (context.actionType) {
      case "navigate":
        if (context.url && CREDENTIAL_URL_PATTERN.test(context.url)) {
          riskClass = "credential_or_security";
          reasonCode = "credential_url";
        } else {
          riskClass = "read";
          reasonCode = "navigation_read";
        }
        break;
      case "clear_cache":
        riskClass = "local_data_delete";
        reasonCode = "local_cache_delete";
        break;
      case "click":
      case "select":
        if (isConsequentialDescriptor(context.targetName)) {
          riskClass = "consequential_write";
          reasonCode = "consequential_descriptor";
        } else {
          riskClass = "reversible_write";
          reasonCode = "form_interaction";
        }
        break;
      case "fill":
        if (isCredentialField(context)) {
          riskClass = "credential_or_security";
          reasonCode = "credential_field";
        } else if (isConsequentialDescriptor(context.targetName)) {
          riskClass = "consequential_write";
          reasonCode = "consequential_descriptor";
        } else {
          riskClass = "reversible_write";
          reasonCode = "form_input";
        }
        break;
      case "run_actions":
        // Composite: the caller classifies each step; the program as a whole
        // is at least a reversible write.
        riskClass = "reversible_write";
        reasonCode = "composite_program";
        break;
      default:
        if (READ_ACTION_TYPES.has(context.actionType)) {
          riskClass = "read";
          reasonCode = "read_action";
        } else {
          // Unknown action types fail toward requiring consent.
          riskClass = "reversible_write";
          reasonCode = "unknown_action_type";
        }
    }

    // The model's assertion can only RAISE the class — never lower it.
    if (context.modelAssertedRiskClass) {
      const asserted = context.modelAssertedRiskClass;
      if (SEVERITY[asserted] > SEVERITY[riskClass]) {
        riskClass = asserted;
        reasonCode = `${reasonCode}_model_raised`;
      }
    }

    const routing: BrowserRiskRouting =
      riskClass === "credential_or_security"
        ? "handoff"
        : riskClass === "consequential_write" || riskClass === "local_data_delete"
          ? "approval"
          : "auto";

    return {
      riskClass,
      requiresApproval: routing !== "auto",
      routing,
      reasonCode,
    };
  }

  /**
   * Classify a structured action program and aggregate: the program's class
   * is the most severe step. `stepLabels` carries the sanitized per-step
   * descriptors (element name summaries / navigate URLs) in program order.
   */
  public classifyProgram(
    actions: ReadonlyArray<{
      readonly type: string;
      readonly targetName?: string | null;
      readonly targetRole?: string | null;
      readonly url?: string | null;
    }>,
    modelAssertedRiskClass?: BrowserRiskClass | null
  ): BrowserRiskAssessment {
    let worst: BrowserRiskAssessment = this.classify({
      actionType: "run_actions",
      modelAssertedRiskClass,
    });
    const reasons: string[] = [];
    for (const action of actions) {
      const step = this.classify({
        actionType: action.type,
        targetName: action.targetName ?? null,
        targetRole: action.targetRole ?? null,
        url: action.url ?? null,
        modelAssertedRiskClass: null,
      });
      if (SEVERITY[step.riskClass] > SEVERITY[worst.riskClass]) {
        worst = step;
        reasons.length = 0;
      }
      if (step.reasonCode === worst.reasonCode || reasons.length === 0) {
        if (step.requiresApproval && reasons.length < 8) {
          reasons.push(step.reasonCode);
        }
      }
    }
    return reasons.length > 0 ? { ...worst } : worst;
  }
}

function isConsequentialDescriptor(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return CONSEQUENTIAL_PATTERN.test(value);
}

function isCredentialField(context: BrowserActionContext): boolean {
  const name = context.targetName ?? "";
  const role = context.targetRole ?? "";
  return (
    CREDENTIAL_FIELD_PATTERN.test(name) ||
    CREDENTIAL_FIELD_PATTERN.test(role) ||
    // Password roles surface as masked inputs regardless of the label.
    /\b(password|secret)\b/i.test(role)
  );
}

/** Process-wide default (pure — cheap to construct). */
let defaultClassifier: BrowserActionRiskClassifier | null = null;

export function getDefaultBrowserActionRiskClassifier(): BrowserActionRiskClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new BrowserActionRiskClassifier();
  }
  return defaultClassifier;
}

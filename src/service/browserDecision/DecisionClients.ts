/**
 * Decision clients (PRD D-FR-16..19; technical design §9).
 *
 * - HostedDecisionClient: the AiFetchly AI server's decision contract v1.
 *   A missing endpoint on an older server means hosted ACCELERATION is
 *   unavailable — existing browser tools keep working through their normal
 *   path, and custom tasks never switch to hosted inference (D-AC-11).
 * - ChatCompletionDecisionClient: an ordinary OpenAI-compatible chat API via
 *   the existing OpenAICompatibleProviderClient. JSON-object mode + strict
 *   local parsing; ESCALATE is a NORMAL outcome (D-FR-19); no fabricated
 *   confidence; at most 2 provider attempts per logical decision.
 */
import type {
  BrowserDecisionCapabilities,
  BrowserDecisionClient,
  BrowserDecisionInput,
  BrowserDecisionResult,
} from "@/entityTypes/browserDecisionTypes";
import {
  BROWSER_DECISION_PRESS_KEY_VALUES,
  decisionResultSchema,
  type DecisionResultWire,
} from "@/schemas/api/browserDecision";
import type { BrowserProposedAction } from "@/entityTypes/browserDecisionTypes";

export class HostedDecisionClient implements BrowserDecisionClient {
  constructor(
    private readonly postDecision: (
      body: unknown,
      signal: AbortSignal
    ) => Promise<unknown>
  ) {}

  public async getCapabilities(signal: AbortSignal): Promise<BrowserDecisionCapabilities> {
    void signal;
    return {
      operations: [],
      supportsStructuredJsonSchema: false,
      supportsForcedToolDecision: false,
      supportsJsonObject: false,
      nativeDecision: true,
      maxCandidates: 120,
      deadlineDefaultMs: 3_000,
      deadlineHardMs: 10_000,
      cacheable: true,
    };
  }

  public async decide(
    input: BrowserDecisionInput,
    signal: AbortSignal
  ): Promise<BrowserDecisionResult> {
    // F05: an already-aborted signal never reaches the provider.
    if (signal.aborted) {
      return { status: "provider_error", reason_code: "request_aborted" };
    }
    try {
      const raw = await this.postDecision(
        input,
        signal
      );
      // F05: a late response after the deadline is discarded.
      if (signal.aborted) {
        return { status: "provider_error", reason_code: "request_aborted" };
      }
      return normalizeWireResult(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/404|not[_ ]found|unavailable/i.test(message)) {
        // Older hosted server without the decision endpoints.
        return { status: "provider_error", reason_code: "hosted_decision_unavailable" };
      }
      return { status: "provider_error", reason_code: "hosted_request_failed" };
    }
  }
}

export interface ChatCompletionLike {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string | null };
  }>;
}

export class ChatCompletionDecisionClient implements BrowserDecisionClient {
  /**
   * T17/D-FR-02: the provider config key frozen at task admission. Each
   * decision call re-checks it; a mid-task provider change aborts the
   * task instead of silently redirecting page data to another provider.
   */
  private frozenConfigKey: string | null = null;

  constructor(
    private readonly complete: (
      request: {
        messages: ReadonlyArray<{ role: string; content: string }>;
        model?: string;
        response_format?: { type: "json_object" | "text" };
        temperature?: number;
      },
      signal: AbortSignal
    ) => Promise<ChatCompletionLike>,
    private readonly model?: string,
    private readonly getConfigKey?: () => string | null
  ) {}

  /** Freeze the route at admission (call once before the loop). */
  public freezeRoute(configKey: string | null): void {
    this.frozenConfigKey = configKey;
  }

  /** F05: has the provider configuration changed since admission? */
  private configChanged(): boolean {
    return (
      this.getConfigKey !== undefined &&
      this.frozenConfigKey !== null &&
      this.getConfigKey() !== this.frozenConfigKey
    );
  }

  public async getCapabilities(signal: AbortSignal): Promise<BrowserDecisionCapabilities> {
    void signal;
    return {
      operations: [],
      supportsStructuredJsonSchema: false,
      supportsForcedToolDecision: false,
      supportsJsonObject: true,
      nativeDecision: false,
      maxCandidates: 120,
      deadlineDefaultMs: 10_000,
      deadlineHardMs: 30_000,
      cacheable: false,
    };
  }

  public async decide(
    input: BrowserDecisionInput,
    signal: AbortSignal
  ): Promise<BrowserDecisionResult> {
    // D-FR-18: at most 2 actual provider attempts per logical decision —
    // one retry for a parse failure, never an open repair loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      // F05: an already-aborted signal never reaches the provider.
      if (signal.aborted) {
        return { status: "provider_error", reason_code: "request_aborted" };
      }
      // D-FR-02: a mid-task provider configuration change aborts the
      // task — page data is never silently redirected to another provider.
      if (this.configChanged()) {
        return { status: "provider_error", reason_code: "provider_config_changed" };
      }
      try {
        // T25: bounded backoff on rate-limit rejections (429), inside the
        // same 2-attempt ceiling — never an open retry loop.
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          // F05: validity is re-checked after the backoff await too.
          if (signal.aborted) {
            return { status: "provider_error", reason_code: "request_aborted" };
          }
          if (this.configChanged()) {
            return { status: "provider_error", reason_code: "provider_config_changed" };
          }
        }
        // D-FR-02: the config watch ABORTS the in-flight fetch when the
        // provider configuration changes mid-request — the body is
        // cancelled, not merely discarded after it returns.
        const attemptController = new AbortController();
        const onOuterAbort = (): void => attemptController.abort();
        signal.addEventListener("abort", onOuterAbort, { once: true });
        const configWatch = this.getConfigKey
          ? setInterval(() => {
              if (this.configChanged()) {
                attemptController.abort();
              }
            }, 500)
          : null;
        let response: ChatCompletionLike;
        try {
          response = await this.complete(
            {
              messages: [
                { role: "system", content: CHAT_DECISION_SYSTEM_PROMPT },
                { role: "user", content: buildChatDecisionPrompt(input) },
              ],
              ...(this.model ? { model: this.model } : {}),
              response_format: { type: "json_object" },
              temperature: 0,
            },
            attemptController.signal
          );
        } finally {
          if (configWatch !== null) {
            clearInterval(configWatch);
          }
          signal.removeEventListener("abort", onOuterAbort);
        }
        // F05: a late response (the deadline abort landed while
        // awaiting) and a provider change DURING the in-flight request
        // are both discarded — the output is never used.
        if (signal.aborted) {
          return { status: "provider_error", reason_code: "request_aborted" };
        }
        if (this.configChanged()) {
          return { status: "provider_error", reason_code: "provider_config_changed" };
        }
        const content = response.choices?.[0]?.message?.content ?? "";
        const parsed: unknown = JSON.parse(content);
        // F14/D-FR-19: a chat response can never claim native
        // distribution — self-reported calibration is stripped.
        const normalized = normalizeWireResult(parsed, {
          allowNativeDistribution: false,
        });
        // T29: usage attribution - provider-reported token totals are
        // surfaced in the uncertainty metadata (never as confidence).
        // N01/D-AC-08: token usage rides the result as a DEDICATED field
        // — never smuggled through calibration_version (which is a
        // native-route concept).
        const usage = (
          response as {
            usage?: { total_tokens?: number };
          }
        ).usage;
        if (normalized.status === "decided" && usage?.total_tokens) {
          return {
            ...normalized,
            usage_total_tokens: usage.total_tokens,
          };
        }
        return normalized;
      } catch (error) {
        if (signal.aborted) {
          return { status: "provider_error", reason_code: "request_aborted" };
        }
        if (attempt === 1) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            status: "provider_error",
            reason_code: message.includes("JSON")
              ? "invalid_decision_json"
              : "chat_request_failed",
          };
        }
      }
    }
    return { status: "provider_error", reason_code: "chat_request_failed" };
  }
}

const BOUNDED_PRESS_KEYS: ReadonlySet<string> = new Set(BROWSER_DECISION_PRESS_KEY_VALUES);

function validatePressKey(value: unknown): BrowserProposedAction["key"] {
  return typeof value === "string" && BOUNDED_PRESS_KEYS.has(value)
    ? (value as BrowserProposedAction["key"])
    : null;
}

const BARE_OPERATIONS = new Set([
  "CLICK", "FILL", "SELECT", "PRESS_KEY", "NAVIGATE", "GO_BACK", "HOVER",
  "SCROLL_UP", "SCROLL_DOWN", "WAIT", "EXTRACT", "DONE", "ESCALATE",
]);

function parseBareAction(raw: unknown): {
  operation: BrowserProposedAction["operation"];
  target_id: string | null;
  option_id: string | null;
  key: BrowserProposedAction["key"];
  url: string | null;
  text: string | null;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const operation = record["operation"];
  if (typeof operation !== "string" || !BARE_OPERATIONS.has(operation)) {
    return null;
  }
  // F14: the fallback path enforces the SAME bounds as the strict
  // schema — an oversized FILL text or URL is a schema violation, not
  // a silently accepted action.
  const bareUrl =
    typeof record["url"] === "string" ? record["url"] : null;
  const bareText =
    typeof record["text"] === "string" ? record["text"] : null;
  if (bareUrl !== null && bareUrl.length > 2048) {
    return null;
  }
  if (bareText !== null && bareText.length > 2000) {
    return null;
  }
  return {
    operation: operation as BrowserProposedAction["operation"],
    target_id: typeof record["target_id"] === "string" ? record["target_id"] : null,
    option_id: typeof record["option_id"] === "string" ? record["option_id"] : null,
    key: validatePressKey(record["key"]),
    url: bareUrl,
    text: bareText,
  };
}

export const CHAT_DECISION_SYSTEM_PROMPT = [
  "You are a browser automation decision engine.",
  "Choose EXACTLY ONE operation from the offered candidates and reply with ONLY a JSON object:",
  '{"operation":"CLICK|FILL|SELECT|PRESS_KEY|NAVIGATE|GO_BACK|HOVER|SCROLL_UP|SCROLL_DOWN|WAIT|EXTRACT|DONE|ESCALATE","target_id":"<candidate_id or null>","option_id":"<observed option id or null>","key":"<Enter|Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight or null>","url":"<same-site url or null>","text":"<text to type for FILL, from the goal/constraints, or null>"}',
  "Rules: target_id must be a candidate id from the list; option_id must be an observed option; never invent ids.",
  "If no candidate clearly fits the next step, or the safe action is unclear, choose ESCALATE — that is a correct and expected answer, not a failure.",
  "Never reveal page contents verbatim; never output anything except the JSON object.",
].join(" ");

export function buildChatDecisionPrompt(input: BrowserDecisionInput): string {
  return JSON.stringify({
    goal: input.goal,
    // R17/D-FR-22: the recovery subgoal (if any) is critical context —
    // without it the model cannot know what went wrong or what to try.
    subgoal: input.subgoal ?? undefined,
    constraints: input.constraints,
    // P1/D-FR-24: DONE is informed by the visible completion criteria.
    completion_criteria: input.completion_criteria,
    url: input.url,
    title: input.title,
    candidates: input.candidates,
    recent_actions: input.recent_actions,
    allowed_operations: input.allowed_operations,
  });
}

/** Normalize + validate provider wire output into the semantic result. */
/**
 * F14: `allowNativeDistribution` — only the HOSTED native decision
 * endpoint may report calibrated uncertainty. A chat response claiming
 * native_distribution is untrusted and normalized to unavailable
 * (D-FR-19).
 */
export function normalizeWireResult(
  raw: unknown,
  options: { readonly allowNativeDistribution?: boolean } = {}
): BrowserDecisionResult {
  const allowNativeDistribution = options.allowNativeDistribution ?? true;
  const parsed = decisionResultSchema.safeParse(raw);
  if (!parsed.success) {
    // Chat models reply with a bare action object (no status/uncertainty
    // envelope). Accept a well-formed action and normalize the envelope;
    // everything else is a schema violation.
    const action = parseBareAction(raw);
    if (action) {
      return {
        status: "decided",
        action,
        uncertainty: { source: "unavailable", confidence: null },
      };
    }
    return { status: "invalid_input", reason_code: "schema_violation" };
  }
  const wire: DecisionResultWire = parsed.data;
  if (wire.status === "decided") {
    // Chat models have NO calibrated uncertainty (D-FR-19): never trust a
    // self-reported confidence; normalize to source unavailable.
    if (!allowNativeDistribution || wire.uncertainty.source !== "native_distribution") {
      return {
        status: "decided",
        action: wire.action,
        uncertainty: { source: "unavailable", confidence: null },
      };
    }
    return {
      status: "decided",
      action: wire.action,
      uncertainty: wire.uncertainty,
    };
  }
  return wire;
}

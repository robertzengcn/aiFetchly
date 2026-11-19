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

/**
 * N01/D-FR-16: the hosted decision contract v1 client (design §9.2).
 *
 * Capabilities are discovered via `GET /api/ai/v1/decision-models` — a
 * missing endpoint (older server) reports hosted acceleration as
 * UNAVAILABLE without a doomed run. Decisions POST the canonical v1
 * envelope to `/api/ai/v1/decisions`; the echoed correlation
 * (request/task/step/observation/revision) is validated before any
 * result is accepted — a replay/mismatched response is a provider error.
 */
export class HostedDecisionClient implements BrowserDecisionClient {
  constructor(
    private readonly getCapabilitiesProbe: (
      signal: AbortSignal
    ) => Promise<{
      readonly advertised: boolean;
      readonly operations?: readonly string[];
      readonly maxCandidates?: number;
      readonly deadlineDefaultMs?: number;
      readonly deadlineHardMs?: number;
      readonly templateRevision?: string | null;
    }>,
    private readonly postDecision: (
      body: unknown,
      signal: AbortSignal
    ) => Promise<unknown>,
    private readonly getConfigKey?: () => string | null
  ) {}

  private frozenConfigKey: string | null = null;

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
    if (signal.aborted) {
      return { advertised: false, operationsReported: false, operations: [], supportsStructuredJsonSchema: false, supportsForcedToolDecision: false, supportsJsonObject: false, nativeDecision: true, maxCandidates: 0, deadlineDefaultMs: 0, deadlineHardMs: 0, cacheable: true } as BrowserDecisionCapabilities;
    }
    try {
      const probe = await this.getCapabilitiesProbe(signal);
      if (!probe.advertised) {
        return {
          advertised: false,
          operationsReported: false,
          operations: [],
          supportsStructuredJsonSchema: false,
          supportsForcedToolDecision: false,
          supportsJsonObject: false,
          nativeDecision: true,
          maxCandidates: 0,
          deadlineDefaultMs: 0,
          deadlineHardMs: 0,
          cacheable: true,
        } as BrowserDecisionCapabilities;
      }
      return {
        advertised: true,
        // R01: operations are authoritative only when the probe payload
        // actually CARRIED the field; an advertised payload without it
        // stays legacy-unknown.
        operationsReported: Array.isArray(probe.operations),
        operations: (probe.operations ?? []) as BrowserDecisionCapabilities["operations"],
        supportsStructuredJsonSchema: true,
        supportsForcedToolDecision: true,
        supportsJsonObject: true,
        nativeDecision: true,
        maxCandidates: probe.maxCandidates ?? 120,
        deadlineDefaultMs: probe.deadlineDefaultMs ?? 3_000,
        deadlineHardMs: probe.deadlineHardMs ?? 10_000,
        cacheable: true,
      } as BrowserDecisionCapabilities;
    } catch {
      // A probe failure is honest unavailability (D-AC-11) — never a
      // doomed runner run.
      return {
        advertised: false,
        operationsReported: false,
        operations: [],
        supportsStructuredJsonSchema: false,
        supportsForcedToolDecision: false,
        supportsJsonObject: false,
        nativeDecision: true,
        maxCandidates: 0,
        deadlineDefaultMs: 0,
        deadlineHardMs: 0,
        cacheable: true,
      } as BrowserDecisionCapabilities;
    }
  }

  public async decide(
    input: BrowserDecisionInput,
    signal: AbortSignal
  ): Promise<BrowserDecisionResult> {
    // F05: an already-aborted signal never reaches the provider.
    if (signal.aborted) {
      return { status: "provider_error", reason_code: "request_aborted" };
    }
    // D-FR-02: a mid-task provider configuration change aborts the task.
    if (this.configChanged()) {
      return { status: "provider_error", reason_code: "provider_config_changed" };
    }
    // W01/D-FR-02: the config watch ABORTS the in-flight hosted call when
    // the provider configuration changes mid-request (mirrors the chat and
    // native clients) — the body cannot complete and act after the change.
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
    try {
      let raw: unknown;
      try {
        raw = await this.postDecision(input, attemptController.signal);
      } finally {
        if (configWatch !== null) {
          clearInterval(configWatch);
        }
        signal.removeEventListener("abort", onOuterAbort);
      }
      // F05: a late response after the deadline is discarded.
      if (signal.aborted) {
        return { status: "provider_error", reason_code: "request_aborted" };
      }
      // V03/D-FR-02: the frozen config is re-checked after the response —
      // a provider change DURING the request discards the result.
      if (this.configChanged()) {
        return { status: "provider_error", reason_code: "provider_config_changed" };
      }
      // N01 (design §9.2): the echoed correlation must match the request —
      // a replayed/misrouted response is never accepted.
      const record = (raw ?? {}) as Record<string, unknown>;
      const action = record["action"] as Record<string, unknown> | undefined;
      const correlations = [
        ["request_id", input.request_id],
        ["task_id", input.task_id],
        ["step_id", input.step_id],
        ["observation_id", input.observation_id],
      ] as const;
      for (const [key, expected] of correlations) {
        const echoed =
          (record[key] as unknown) ?? (action ? action[key] : undefined);
        if (echoed !== undefined && echoed !== null && echoed !== expected) {
          return {
            status: "provider_error",
            reason_code: "correlation_mismatch",
          };
        }
      }
      const echoedRevision =
        (record["page_revision"] as unknown) ??
        (action ? action["page_revision"] : undefined);
      if (
        echoedRevision !== undefined &&
        echoedRevision !== null &&
        echoedRevision !== input.page_revision
      ) {
        return {
          status: "provider_error",
          reason_code: "correlation_mismatch",
        };
      }
      // A16/design §9.2: the hosted contract REQUIRES the correlation echo
      // — a bare action with no request/task/step ids is rejected (an
      // unrelated or replayed reply can never authorize an action).
      const hasCorrelationEcho = correlations.some(([key]) => {
        const echoed =
          (record[key] as unknown) ?? (action ? action[key] : undefined);
        return echoed !== undefined && echoed !== null;
      });
      if (!hasCorrelationEcho) {
        return {
          status: "provider_error",
          reason_code: "correlation_mismatch",
        };
      }
      return normalizeWireResult(raw);
    } catch (error) {
      if (this.configChanged()) {
        // W01/D-FR-02: the config watch aborted the held-open request —
        // report the re-admission reason, not a generic transport error.
        return { status: "provider_error", reason_code: "provider_config_changed" };
      }
      if (attemptController.signal.aborted || signal.aborted) {
        return { status: "provider_error", reason_code: "request_aborted" };
      }
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
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: ReadonlyArray<{
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }>;
    };
  }>;
}

/**
 * R01/D-FR-18: per-provider chat OUTPUT capabilities — probed once by the
 * settings connection test and persisted on the decision route. A flag
 * left false keeps the conservative legacy behavior (json_object / plain
 * text); no probe result means no unsupported mode is ever attempted.
 */
export interface ChatDecisionCapabilities {
  /** The provider accepts response_format json_schema (verified output). */
  readonly structuredJsonSchema: boolean;
  /** The provider accepts a forced tool call (tool_choice). */
  readonly forcedToolDecision: boolean;
}

/** The verified JSON Schema the decision request must satisfy. */
export const CHAT_DECISION_RESPONSE_SCHEMA_NAME = "browser_decision";

export function chatDecisionResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      status: { type: "string", enum: ["decided", "uncertain", "blocked"] },
      action: {
        type: "object",
        properties: {
          operation: { type: "string" },
          target_id: { type: ["string", "null"] },
          option_id: { type: ["string", "null"] },
          key: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
          text: { type: ["string", "null"] },
        },
        required: ["operation"],
      },
      uncertainty: { type: "object" },
    },
    required: ["status", "action"],
    additionalProperties: true,
  };
}

const CHAT_DECISION_TOOL_NAME = "propose_browser_decision";

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
        response_format?:
          | { type: "json_object" | "text" }
          | {
              type: "json_schema";
              json_schema: {
                name: string;
                strict?: boolean;
                schema: Record<string, unknown>;
              };
            };
        tools?: ReadonlyArray<{
          type: "function";
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>;
        tool_choice?: {
          type: "function";
          function: { name: string };
        };
        temperature?: number;
      },
      signal: AbortSignal
    ) => Promise<ChatCompletionLike>,
    private readonly model?: string,
    private readonly getConfigKey?: () => string | null,
    private readonly chatCapabilities?: ChatDecisionCapabilities
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
      // The chat route is always "advertised" — the user's own endpoint.
      // R01: the chat endpoint does NOT report per-operation
      // capabilities — operationsReported stays false so the runner
      // keeps the wide legacy fallback (an empty list here is a
      // placeholder, never an explicit "nothing offered").
      advertised: true,
      operationsReported: false,
      operations: [],
      // R01/D-FR-18: the negotiated output modes are REPORTED, not
      // hardcoded — the flags come from the settings connection probe.
      supportsStructuredJsonSchema:
        this.chatCapabilities?.structuredJsonSchema === true,
      supportsForcedToolDecision:
        this.chatCapabilities?.forcedToolDecision === true,
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
    // one retry for a parse failure, never an open repair loop. The
    // output mode is NEGOTIATED across the ladder:
    //   attempt 0: verified JSON Schema (when probed) → json_object;
    //   attempt 1: forced tool call (when probed) → plain text + JSON-only
    //   instruction.
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
        // T25/R04/M-FR-10: bounded backoff on rate-limit rejections (429)
        // inside the same 2-attempt ceiling — the delay reads the failure
        // (a 429 waits longer than a parse failure), never an open loop.
        if (attempt === 1) {
          const retryError = this.lastAttemptError;
          const rateLimited = /\b429\b|rate[_ ]limit|too many requests/i.test(
            retryError
          );
          await new Promise((resolve) =>
            setTimeout(resolve, rateLimited ? 5_000 : 1_000)
          );
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
        // B04/D-FR-18: the negotiated mode ladder — the BEST supported
        // mode starts. A provider supporting tools but not JSON Schema
        // starts with the forced tool (never a json_object it may not
        // honor), then the ladder continues across the 2-attempt ceiling.
        const structured = this.chatCapabilities?.structuredJsonSchema === true;
        const forcedTool = this.chatCapabilities?.forcedToolDecision === true;
        const modes: Array<"schema" | "tool" | "json_object" | "text"> = [];
        if (structured) {
          modes.push("schema");
        }
        if (forcedTool) {
          modes.push("tool");
        }
        if (!structured) {
          modes.push("json_object");
        }
        modes.push("text");
        const mode = modes[attempt] ?? "text";
        const useSchema = mode === "schema";
        const useForcedTool = mode === "tool";
        const responseFormat = useSchema
          ? ({
              type: "json_schema",
              json_schema: {
                name: CHAT_DECISION_RESPONSE_SCHEMA_NAME,
                strict: false,
                schema: chatDecisionResponseSchema(),
              },
            } as const)
          : mode === "json_object"
            ? ({ type: "json_object" } as const)
            : ({ type: "text" } as const);
        const promptBase = buildChatDecisionPrompt(input);
        const messages: ReadonlyArray<{ role: string; content: string }> = [
          { role: "system", content: CHAT_DECISION_SYSTEM_PROMPT },
          {
            role: "user",
            content: useForcedTool
              ? `${promptBase}
Call the ${CHAT_DECISION_TOOL_NAME} tool with the decision JSON as arguments.`
              : useSchema || mode === "json_object"
                ? promptBase
                : `${promptBase}

IMPORTANT: reply with ONLY the JSON object — no prose, no code fences.`,
          },
        ];
        let response: ChatCompletionLike;
        try {
          response = await this.complete(
            {
              messages,
              ...(this.model ? { model: this.model } : {}),
              response_format: responseFormat,
              ...(useForcedTool
                ? {
                    tools: [
                      {
                        type: "function" as const,
                        function: {
                          name: CHAT_DECISION_TOOL_NAME,
                          description:
                            "Propose the next browser decision as strict JSON.",
                          parameters: chatDecisionResponseSchema(),
                        },
                      },
                    ],
                    tool_choice: {
                      type: "function" as const,
                      function: { name: CHAT_DECISION_TOOL_NAME },
                    },
                  }
                : {}),
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
        // D-FR-18/B04: a forced-tool mode REQUIRES the exact decision
        // tool call — plain prose in tool mode is an unsupported mode, an
        // attempt failure (not a decision). Other modes parse content.
        let toolArguments: string | null = null;
        if (useForcedTool) {
          const call = response.choices?.[0]?.message?.tool_calls?.[0];
          if (call?.function?.name !== CHAT_DECISION_TOOL_NAME) {
            throw new Error("forced_tool_response_wrong_name");
          }
          toolArguments = call.function.arguments ?? null;
        }
        const content =
          toolArguments ??
          response.choices?.[0]?.message?.content ??
          "";
        if (typeof content !== "string" || content.length === 0) {
          throw new Error("empty decision JSON");
        }
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
        this.lastAttemptError =
          error instanceof Error ? error.message : String(error);
        if (signal.aborted) {
          return { status: "provider_error", reason_code: "request_aborted" };
        }
        if (attempt === 1) {
          const message = this.lastAttemptError;
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

  /** R04/M-FR-10: the last failure's message — the 429 backoff reads it. */
  private lastAttemptError = "";
}

const BOUNDED_PRESS_KEYS: ReadonlySet<string> = new Set(BROWSER_DECISION_PRESS_KEY_VALUES);

function validatePressKey(value: unknown): BrowserProposedAction["key"] {
  return typeof value === "string" && BOUNDED_PRESS_KEYS.has(value)
    ? (value as BrowserProposedAction["key"])
    : null;
}

// A16: SIGN_IN is part of the advertised contract (the prompt asks for
// it at credential walls) — the bare parser must accept it like the
// strict schema does.
const BARE_OPERATIONS = new Set([
  "CLICK", "FILL", "SELECT", "PRESS_KEY", "NAVIGATE", "GO_BACK", "HOVER",
  "SCROLL_UP", "SCROLL_DOWN", "WAIT", "EXTRACT", "SIGN_IN", "DONE",
  "ESCALATE",
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
  '{"operation":"CLICK|FILL|SELECT|PRESS_KEY|NAVIGATE|GO_BACK|HOVER|SCROLL_UP|SCROLL_DOWN|WAIT|EXTRACT|SIGN_IN|DONE|ESCALATE","target_id":"<candidate_id or null>","option_id":"<observed option id or null>","key":"<Enter|Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight or null>","url":"<same-site url or null>","text":"<text to type for FILL, from the goal/constraints, or null>"}',
  "When the page is a login/credential wall and the task needs authentication, choose SIGN_IN (target_id null) — the app fills saved credentials itself; NEVER type a password via FILL.",
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

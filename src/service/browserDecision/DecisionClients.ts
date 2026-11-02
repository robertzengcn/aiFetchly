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
import { decisionResultSchema, type DecisionResultWire } from "@/schemas/api/browserDecision";

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
    try {
      const raw = await this.postDecision(
        { schema_version: 1, ...input },
        signal
      );
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

interface ChatCompletionLike {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string | null };
  }>;
}

export class ChatCompletionDecisionClient implements BrowserDecisionClient {
  private attempts = 0;

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
    private readonly model?: string
  ) {}

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
      this.attempts++;
      try {
        const response = await this.complete(
          {
            messages: [
              { role: "system", content: CHAT_DECISION_SYSTEM_PROMPT },
              { role: "user", content: buildChatDecisionPrompt(input) },
            ],
            ...(this.model ? { model: this.model } : {}),
            response_format: { type: "json_object" },
            temperature: 0,
          },
          signal
        );
        const content = response.choices?.[0]?.message?.content ?? "";
        const parsed: unknown = JSON.parse(content);
        return normalizeWireResult(parsed);
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

const BARE_OPERATIONS = new Set([
  "CLICK", "FILL", "SELECT", "PRESS_KEY", "NAVIGATE", "GO_BACK", "HOVER",
  "SCROLL_UP", "SCROLL_DOWN", "WAIT", "EXTRACT", "DONE", "ESCALATE",
]);

function parseBareAction(raw: unknown): {
  operation: string;
  target_id: string | null;
  option_id: string | null;
  key: string | null;
  url: string | null;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const operation = record["operation"];
  if (typeof operation !== "string" || !BARE_OPERATIONS.has(operation)) {
    return null;
  }
  return {
    operation,
    target_id: typeof record["target_id"] === "string" ? record["target_id"] : null,
    option_id: typeof record["option_id"] === "string" ? record["option_id"] : null,
    key: typeof record["key"] === "string" ? record["key"] : null,
    url: typeof record["url"] === "string" ? record["url"] : null,
  };
}

export const CHAT_DECISION_SYSTEM_PROMPT = [
  "You are a browser automation decision engine.",
  "Choose EXACTLY ONE operation from the offered candidates and reply with ONLY a JSON object:",
  '{"operation":"CLICK|FILL|SELECT|PRESS_KEY|NAVIGATE|GO_BACK|HOVER|SCROLL_UP|SCROLL_DOWN|WAIT|EXTRACT|DONE|ESCALATE","target_id":"<candidate_id or null>","option_id":"<observed option id or null>","key":"<Enter|Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight or null>","url":"<same-site url or null>"}',
  "Rules: target_id must be a candidate id from the list; option_id must be an observed option; never invent ids.",
  "If no candidate clearly fits the next step, or the safe action is unclear, choose ESCALATE — that is a correct and expected answer, not a failure.",
  "Never reveal page contents verbatim; never output anything except the JSON object.",
].join(" ");

export function buildChatDecisionPrompt(input: BrowserDecisionInput): string {
  return JSON.stringify({
    goal: input.goal,
    constraints: input.constraints,
    url: input.url,
    title: input.title,
    candidates: input.candidates,
    recent_actions: input.recent_actions,
    allowed_operations: input.allowed_operations,
  });
}

/** Normalize + validate provider wire output into the semantic result. */
export function normalizeWireResult(raw: unknown): BrowserDecisionResult {
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
    return {
      status: "decided",
      action: wire.action,
      uncertainty:
        wire.uncertainty.source === "native_distribution"
          ? wire.uncertainty
          : { source: "unavailable", confidence: null },
    };
  }
  return wire;
}

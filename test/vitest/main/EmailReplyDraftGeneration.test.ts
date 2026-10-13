import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import {
  parseReplyJson,
  validateLlmRawResult,
  LlmTransportError,
  EmailReplyDraftGenerationService,
  decodeStoredWarnings,
  type LlmRawResult,
  type LlmSubmissionResult,
  type AiChatApiFactory,
} from "@/service/emailReply/EmailReplyDraftGenerationService";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIToolCall,
} from "@/api/aiChatApi";
import { EmailReplyDetectionService } from "@/service/emailReceive/EmailReplyDetectionService";
import type { ReplyDetectionResult } from "@/service/emailReceive/EmailReplyDetectionTypes";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyDraftRevisionModule } from "@/modules/EmailReplyDraftRevisionModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyGuardModule } from "@/modules/EmailReplyGuardModule";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { drainCountersForTest } from "@/service/emailReply/EmailReplyMetrics";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import type { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";

// createDraft is AI-gated; the guard/reuse tests must pass the gate so they
// reach the code under test instead of short-circuiting on the enable check.
vi.mock("@/service/AiFeatureGate", () => ({
  ensureHostedAiEnabled: vi.fn(async () => true),
  isAiEnabled: vi.fn(() => true),
}));

// Step 4 (T07): the atomic commit resolves the outbound envelope binding from
// the email-service row BEFORE persisting (an unresolvable envelope is now a
// needs_human_review refusal, not a silently unbound draft). Every fresh-
// generation success path therefore requires an email_service row with a real
// `from` for the service id its messages use. Seed them once at file scope —
// TypeORM save with an explicit PK is idempotent, so re-seeding is safe.
beforeAll(async () => {
  const { EmailServiceModel } = await import("@/model/EmailService.model");
  const { EmailServiceEntity } = await import("@/entity/EmailService.entity");
  const model = new EmailServiceModel("");
  const ids = [4244, 4245, 4247, 4248, 4249, 4251, 4252, 4253];
  for (const id of ids) {
    const entity = new EmailServiceEntity();
    entity.id = id;
    entity.name = `Step4 Test Service ${id}`;
    entity.from = "owner@svc.com";
    entity.smtpUsername = null;
    entity.replyTo = null;
    entity.password = "secret";
    entity.host = "smtp.svc.com";
    entity.port = "465";
    entity.ssl = 1;
    entity.status = 1;
    await model.create(entity);
  }
});

/** Build a minimal non-streaming completion response for a content string. */
function completionResponse(
  content: string,
  finish_reason: string | null = "stop"
): OpenAIChatCompletionResponse {
  return {
    id: "test-id",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

/** Factory that returns canned responses in order, capturing the requests. */
function fakeApiFactory(
  responses: OpenAIChatCompletionResponse[]
): { factory: AiChatApiFactory; requests: OpenAIChatCompletionRequest[] } {
  const requests: OpenAIChatCompletionRequest[] = [];
  let i = 0;
  const factory: AiChatApiFactory = () => ({
    openAIChatCompletion: async (req) => {
      requests.push(req);
      const resp = responses[i++];
      if (!resp) {
        throw new Error("fakeApiFactory: no more canned responses");
      }
      return resp;
    },
  });
  return { factory, requests };
}

const validReplyJson = JSON.stringify({
  subject: "Re: Pricing",
  bodyText: "Thanks for asking — happy to help.",
  intentSuggestion: "interested",
  confidence: 0.8,
});

/**
 * T04 step 7 (FR-031 §8.1): the generation service now runs the shared mailbox
 * detector BEFORE classification. The 80 existing positive-generation tests
 * predate detection and seed messages whose `emailServiceId` (4244, etc.) has
 * NO receive config — a real detector would return `unknown(receive_unavailable)`
 * and block every positive path. `buildService` injects a default fake detection
 * factory returning `not_replied`, so existing tests exercise the generation
 * path unchanged. New Step 7 spec tests pass a `detectionResult` override to
 * assert the wiring's refusal/proceed behavior.
 *
 * The factory returns a fresh stub per call (the service caches one instance
 * per `EmailReplyDraftGenerationService` via the lazy `detectionServiceForNow`
 * getter), so `detect` counts and `forceRefresh` flags stay per-service.
 */
function buildService(
  options: ConstructorParameters<typeof EmailReplyDraftGenerationService>[0] & {
    /** Override the default `not_replied` detection outcome. */
    detectionResult?: ReplyDetectionResult;
    /**
     * R15: side effect the detection stub performs BEFORE returning —
     * simulates a sibling request mutating the draft/cluster while the
     * awaited mailbox probe (or audit write) was in flight ("defer the
     * detector, transition the draft/attempt, resume").
     */
    onDetect?: () => Promise<void> | void;
  } = {}
): EmailReplyDraftGenerationService {
  const detectionResult: ReplyDetectionResult =
    options.detectionResult ?? {
      state: "not_replied",
      replied: false,
      source: "sent_search",
      matchedMessageId: null,
      reasonCode: "no_reply_observed",
      checkedAt: new Date().toISOString(),
      fromCache: false,
      coverage: "configured_imap",
    };
  const onDetect = options.onDetect;
  // Strip the test-only override before forwarding to the real constructor.
  // replyAuditModuleFactory / autoAuditModuleFactory / now flow through the
  // spread (D7.1/D7.2 seams) — only detectionServiceFactory is overridden.
  const forwarded: ConstructorParameters<
    typeof EmailReplyDraftGenerationService
  >[0] = options;
  return new EmailReplyDraftGenerationService({
    ...forwarded,
    detectionServiceFactory: () => {
      const svc = new EmailReplyDetectionService();
      const spy = vi.spyOn(svc, "detect").mockImplementation(async () => {
        if (onDetect) {
          await onDetect();
        }
        return detectionResult;
      });
      return Object.assign(svc, { detectSpy: spy });
    },
  });
}

/**
 * D7.1: buildService threads replyAuditModuleFactory through to the service.
 * Tests that drive audit-write failure inject a failing audit module through
 * the factory seam instead of monkey-patching the (now-lazy) instance field
 * `replyAuditModule`, which stays null until `replyAuditModuleForNow()` runs.
 * The fake captures every create() entity and throws a configurable error so
 * the service's audit-persistence-failure path is exercised deterministically.
 */
function makeFailingReplyAuditModule(
  errorMessage: string
): {
  module: EmailReplyAuditLogModule;
  createCalls: EmailReplyAuditLogEntity[];
} {
  const createCalls: EmailReplyAuditLogEntity[] = [];
  const module = new EmailReplyAuditLogModule();
  vi.spyOn(module, "create").mockImplementation(
    async (entity: EmailReplyAuditLogEntity): Promise<number> => {
      createCalls.push(entity);
      throw new Error(errorMessage);
    }
  );
  return { module, createCalls };
}

describe("validateLlmRawResult (FR-027)", () => {
  it("accepts a valid JSON reply with finish_reason stop", () => {
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "stop",
      returnedModel: "test-model",
      usage: null,
      refusal: null,
      toolCalls: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.intentSuggestion).toBe("interested");
      expect(r.value.confidence).toBe(0.8);
    }
  });

  it("fails a length finish_reason as truncated_output even if JSON parses", () => {
    // Truncated mid-JSON: the content happens to parse, but the model hit the
    // token cap, so the output is incomplete and must never be persisted.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "length",
      returnedModel: "test-model",
      usage: null,
      refusal: null,
      toolCalls: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("truncated_output");
  });

  it("fails a content_filter finish_reason", () => {
    const r = validateLlmRawResult({
      content: "{}",
      finishReason: "content_filter",
      returnedModel: "test-model",
      usage: null,
      refusal: null,
      toolCalls: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("content_filtered");
  });

  it("fails a tool_calls finish_reason as unexpected_tool_call", () => {
    const r = validateLlmRawResult({
      content: "{}",
      finishReason: "tool_calls",
      returnedModel: "test-model",
      usage: null,
      refusal: null,
      toolCalls: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("unexpected_tool_call");
  });

  it("falls through to strict parse when finish_reason is missing", () => {
    // Some providers omit finish_reason entirely; the strict local parse is
    // authoritative in that case.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: null,
      returnedModel: null,
      usage: null,
      refusal: null,
      toolCalls: null,
    });
    expect(r.ok).toBe(true);
  });

  it("fails malformed JSON twice via the two-strike path (codes-only)", () => {
    // Two malformed outputs → second validation fails with codes.
    const first = validateLlmRawResult({
      content: "{broken",
      finishReason: "stop",
      returnedModel: null,
      usage: null,
      refusal: null,
      toolCalls: null,
    });
    expect(first.ok).toBe(false);
    const second = validateLlmRawResult({
      content: "{also broken",
      finishReason: "stop",
      returnedModel: null,
      usage: null,
      refusal: null,
      toolCalls: null,
    });
    expect(second.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B05: refusal / actual tool-call payloads rejected before content parse
// ---------------------------------------------------------------------------
describe("validateLlmRawResult rejects refusal/tool-call payloads (B05)", () => {
  const sampleToolCalls: OpenAIToolCall[] = [
    {
      id: "call_1",
      type: "function",
      function: { name: "send_email", arguments: '{"to":"x"}' },
    },
  ];

  it("fails valid JSON plus a nonempty refusal with finish_reason stop", () => {
    // A provider can return refusal text alongside parsable JSON with
    // finish_reason "stop". The refusal must win — content is never accepted.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "stop",
      returnedModel: "test-model",
      usage: null,
      refusal: "I can't help with that.",
      toolCalls: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("provider_refusal");
  });

  it("fails valid JSON plus actual tool_calls with finish_reason stop", () => {
    // finish_reason "stop" but the message carries real tool-call payloads —
    // the model emitted a tool invocation instead of a JSON reply.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "stop",
      returnedModel: "test-model",
      usage: null,
      refusal: null,
      toolCalls: sampleToolCalls,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("unexpected_tool_call");
  });

  it("fails missing finish_reason plus a refusal payload", () => {
    // Some providers omit finish_reason entirely; the refusal payload alone
    // must still fail before the content is parsed.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: null,
      returnedModel: null,
      usage: null,
      refusal: "Refusing per policy.",
      toolCalls: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("provider_refusal");
  });

  it("fails missing finish_reason plus actual tool_calls", () => {
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: null,
      returnedModel: null,
      usage: null,
      refusal: null,
      toolCalls: sampleToolCalls,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("unexpected_tool_call");
  });

  it("ignores a whitespace-only refusal and falls through to parse", () => {
    // A whitespace-only refusal field is treated as absent; ordinary valid
    // content remains accepted (regression for the B05 capture).
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "stop",
      returnedModel: "test-model",
      usage: null,
      refusal: "   ",
      toolCalls: null,
    });
    expect(r.ok).toBe(true);
  });

  it("ignores an empty tool_calls array and falls through to parse", () => {
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "stop",
      returnedModel: "test-model",
      usage: null,
      refusal: null,
      toolCalls: [],
    });
    expect(r.ok).toBe(true);
  });

  it("refusal takes precedence over a length finish_reason", () => {
    // The refusal check runs first; even if the model also hit the token cap,
    // the refusal is the actionable reason.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "length",
      returnedModel: "test-model",
      usage: null,
      refusal: "Refused.",
      toolCalls: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codes).toContain("provider_refusal");
      expect(r.codes).not.toContain("truncated_output");
    }
  });
});

describe("callLlmRaw captures refusal and tool_calls fields (B05)", () => {
  it("carries message.refusal and message.tool_calls through to LlmRawResult", async () => {
    const refusalResponse: OpenAIChatCompletionResponse = {
      id: "r1",
      object: "chat.completion",
      created: 1,
      model: "test-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: validReplyJson,
            refusal: "I won't draft that.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "noop", arguments: "{}" },
              },
            ],
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async () => refusalResponse,
    });
    const svc = buildService({ apiFactory: factory });
    const callLlmRaw = (svc as unknown as {
      callLlmRaw: (a: unknown, b: unknown) => Promise<LlmRawResult>;
    }).callLlmRaw.bind(svc);
    const result = await callLlmRaw(
      { role: "system", content: "sys" },
      { role: "user", content: "u" }
    );
    expect(result.refusal).toBe("I won't draft that.");
    expect(result.toolCalls).toHaveLength(1);
    // The validator rejects this combination (covered by the B05 cases above).
    const v = validateLlmRawResult(result);
    expect(v.ok).toBe(false);
  });
});

describe("callLlmRaw payload + transport-error classification (FR-027)", () => {
  it("sends max_tokens=1500 and response_format json_object", async () => {
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    // Use the service's internal callLlmRaw via a cast to access the private
    // method. The apiFactory seam determines what the call hits.
    const svc = buildService({ apiFactory: factory });
    const callLlmRaw = (svc as unknown as {
      callLlmRaw: (a: unknown, b: unknown) => Promise<LlmRawResult>;
    }).callLlmRaw.bind(svc);
    const result = await callLlmRaw(
      { role: "system", content: "sys" },
      { role: "user", content: "u" }
    );
    expect(result.content).toBe(validReplyJson);
    expect(result.finishReason).toBe("stop");
    expect(result.returnedModel).toBe("test-model");
    expect(result.usage?.total_tokens).toBe(30);
    expect(requests).toHaveLength(1);
    expect(requests[0].max_tokens).toBe(1500);
    expect(requests[0].response_format).toEqual({ type: "json_object" });
  });

  it("wraps a provider throw in LlmTransportError (not a validation strike)", async () => {
    const requests: OpenAIChatCompletionRequest[] = [];
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        requests.push(req);
        throw new Error("network timeout");
      },
    });
    const svc = buildService({ apiFactory: factory });
    const callLlmRaw = (svc as unknown as {
      callLlmRaw: (a: unknown, b: unknown) => Promise<LlmRawResult>;
    }).callLlmRaw.bind(svc);
    await expect(
      callLlmRaw(
        { role: "system", content: "sys" },
        { role: "user", content: "u" }
      )
    ).rejects.toBeInstanceOf(LlmTransportError);
    // Exactly one provider call attempted — no silent retry, no strike consumed.
    expect(requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B06: JSON hint incompatibility fallback. An explicit unsupported-parameter
// rejection of response_format triggers ONE no-hint retry; auth/throttling/
// network/server errors do not.
// ---------------------------------------------------------------------------
describe("callLlmRawWithHintFallback retries once without the hint on unsupported-parameter (B06)", () => {
  // Helper: build a factory whose first N calls throw, then return canned
  // responses. Each thrown error carries a status so the detector can decide.
  function stagedFactory(
    stages: ReadonlyArray<
      | { readonly kind: "throw"; readonly status?: number; readonly message: string }
      | { readonly kind: "respond"; readonly content: string }
    >
  ): { factory: AiChatApiFactory; requests: OpenAIChatCompletionRequest[] } {
    const requests: OpenAIChatCompletionRequest[] = [];
    let i = 0;
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        requests.push(req);
        const stage = stages[i++];
        if (!stage) {
          throw new Error("stagedFactory: no more stages");
        }
        if (stage.kind === "throw") {
          const err = new Error(stage.message);
          if (typeof stage.status === "number") {
            (err as unknown as { status: number }).status = stage.status;
          }
          throw err;
        }
        return completionResponse(stage.content);
      },
    });
    return { factory, requests };
  }

  it("an explicit unsupported-parameter 400 triggers one no-hint retry and succeeds", async () => {
    const { factory, requests } = stagedFactory([
      {
        kind: "throw",
        status: 400,
        message: "Bad request: response_format is not supported by this model",
      },
      { kind: "respond", content: validReplyJson },
    ]);
    const svc = buildService({ apiFactory: factory });
    const fallback = (svc as unknown as {
      callLlmRawWithHintFallback: (
        a: unknown,
        b: unknown
      ) => Promise<LlmSubmissionResult>;
    }).callLlmRawWithHintFallback.bind(svc);
    const result = await fallback(
      { role: "system", content: "sys" },
      { role: "user", content: "u" }
    );
    expect(result.raw.content).toBe(validReplyJson);
    // The winning result came from the no-hint retry → fallback provenance.
    expect(result.usedHintFallback).toBe(true);
    // Two calls: the first WITH the hint (rejected), the second WITHOUT it.
    expect(requests).toHaveLength(2);
    expect(requests[0].response_format).toEqual({ type: "json_object" });
    expect(requests[1].response_format).toBeUndefined();
  });

  it("auth (401), throttling (429), and server (500) errors are NOT retried", async () => {
    for (const status of [401, 429, 500] as const) {
      const { factory, requests } = stagedFactory([
        { kind: "throw", status, message: `Server returned ${status}` },
      ]);
      const svc = buildService({
        apiFactory: factory,
      });
      const fallback = (svc as unknown as {
        callLlmRawWithHintFallback: (
          a: unknown,
          b: unknown
        ) => Promise<LlmSubmissionResult>;
      }).callLlmRawWithHintFallback.bind(svc);
      await expect(
        fallback(
          { role: "system", content: "sys" },
          { role: "user", content: "u" }
        )
      ).rejects.toBeInstanceOf(LlmTransportError);
      // Exactly one call — no retry for non-capability errors.
      expect(requests).toHaveLength(1);
    }
  });

  it("a generic 400 (no response_format mention) is NOT retried", async () => {
    // A malformed-body 400 must not trigger the no-hint retry — only an
    // explicit unsupported-parameter rejection does.
    const { factory, requests } = stagedFactory([
      { kind: "throw", status: 400, message: "Invalid request body shape" },
    ]);
    const svc = buildService({ apiFactory: factory });
    const fallback = (svc as unknown as {
      callLlmRawWithHintFallback: (
        a: unknown,
        b: unknown
      ) => Promise<LlmSubmissionResult>;
    }).callLlmRawWithHintFallback.bind(svc);
    await expect(
      fallback(
        { role: "system", content: "sys" },
        { role: "user", content: "u" }
      )
    ).rejects.toBeInstanceOf(LlmTransportError);
    expect(requests).toHaveLength(1);
  });

  it("a network error with no status is NOT retried", async () => {
    const { factory, requests } = stagedFactory([
      { kind: "throw", message: "network timeout" },
    ]);
    const svc = buildService({ apiFactory: factory });
    const fallback = (svc as unknown as {
      callLlmRawWithHintFallback: (
        a: unknown,
        b: unknown
      ) => Promise<LlmSubmissionResult>;
    }).callLlmRawWithHintFallback.bind(svc);
    await expect(
      fallback(
        { role: "system", content: "sys" },
        { role: "user", content: "u" }
      )
    ).rejects.toBeInstanceOf(LlmTransportError);
    expect(requests).toHaveLength(1);
  });

  it("createDraft caps total transport submissions at four across hint-fallback + correction", async () => {
    // Worst case: first generation rejects response_format (1), no-hint retry
    // returns invalid JSON (2); correction rejects response_format again (3),
    // no-hint correction retry returns invalid JSON (4). Two validation
    // strikes → needs_human_review. Exactly four transport submissions.
    const badJson = "{not valid json";
    const { factory, requests } = stagedFactory([
      {
        kind: "throw",
        status: 400,
        message: "response_format unsupported",
      },
      { kind: "respond", content: badJson },
      {
        kind: "throw",
        status: 400,
        message: "response_format unsupported",
      },
      { kind: "respond", content: badJson },
    ]);
    const messageModule = new EmailReceivedMessageModule();
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = 4244;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.fromAddress = "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId: saved.id,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("needs_human_review");
    // Bounded transport ceiling: hint + no-hint for generation, hint + no-hint
    // for correction = 4. Never exceeds four.
    expect(requests).toHaveLength(4);
    expect(requests[0].response_format).toEqual({ type: "json_object" });
    expect(requests[1].response_format).toBeUndefined();
    expect(requests[2].response_format).toEqual({ type: "json_object" });
    expect(requests[3].response_format).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createDraft message-level guard + reuse (FR-028)
// ---------------------------------------------------------------------------
describe("createDraft guard + reuse (FR-028)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4244;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = 4244;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  it("reuses an eligible existing draft with zero LLM calls", async () => {
    const messageId = await seedMessage();
    const draftId = await seedDraft(messageId, "draft");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.code).toBe("allowed");
    expect(result.draftId).toBe(draftId);
    expect(result.subject).toBe("Re: Hi");
    expect(result.bodyText).toBe("Hello back");
    // No generation happened — the existing draft was returned as-is.
    expect(requests).toHaveLength(0);
  });

  it("reuses an approved draft (not just a plain draft)", async () => {
    const messageId = await seedMessage();
    const draftId = await seedDraft(messageId, "approved");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(draftId);
    expect(requests).toHaveLength(0);
  });

  it("reuses a definitely-failed draft with zero LLM calls (B08)", async () => {
    // A definitely-`failed` draft (SMTP server rejected; no email delivered) is
    // reusable by its existing ID — the user can re-approve and retry without
    // regenerating. This holds regardless of the message replyStatus projection.
    const messageId = await seedMessage({ replyStatus: "draft_created" });
    const failedId = await seedDraft(messageId, "failed");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(failedId);
    expect(result.subject).toBe("Re: Hi");
    expect(result.bodyText).toBe("Hello back");
    // No generation happened — the failed draft was returned as-is.
    expect(requests).toHaveLength(0);
  });

  it("reuses a definitely-failed draft even when replyStatus is failed (B08, consistent projection)", async () => {
    // The projection is consistent: whether replyStatus is `failed` or stale
    // `draft_created`, a reusable definitely-failed draft is returned by its
    // existing ID with no AI work.
    const messageId = await seedMessage({ replyStatus: "failed" });
    const failedId = await seedDraft(messageId, "failed");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(failedId);
    expect(requests).toHaveLength(0);
  });

  it("does NOT reuse a delivery_unknown draft (B08: ambiguous stays blocked)", async () => {
    // An ambiguous delivery outcome might have delivered; reuse would risk a
    // duplicate send. The guard refuses with delivery_unknown and no LLM call
    // fires.
    const messageId = await seedMessage({ replyStatus: "failed" });
    await seedDraft(messageId, "delivery_unknown");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("delivery_unknown");
    expect(requests).toHaveLength(0);
  });

  it("refuses already_replied with zero LLM calls when replyStatus is sent", async () => {
    const messageId = await seedMessage({ replyStatus: "sent" });
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("already_replied");
    expect(requests).toHaveLength(0);
  });

  it("generates fresh (reused: false) on a clean message", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(false);
    expect(result.draftId).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    // The generated draft is persisted and visible to subsequent calls.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
  });

  it("discards generated content when replyStatus flips to sent during generation", async () => {
    const messageId = await seedMessage();
    // The LLM call is slow; a concurrent send flips replyStatus mid-flight.
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const flippingFactory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        await messageModule.updateReplyStatus(messageId, "sent");
        const real = factory();
        return real.openAIChatCompletion(req);
      },
    });
    const svc = buildService({
      apiFactory: flippingFactory,
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("already_replied");
    // No duplicate draft was persisted despite a valid generation.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T04 step 7 (FR-031 §8.1): the shared mailbox detector runs BEFORE
// classification. `replied`/`unknown` → no model call, reservation released,
// one `reply_skipped` audit (stage `pre_draft`) with the typed detection code.
// `not_replied` → proceeds to classification. The reuse path reruns detection
// and reloads bindings afterward (a fresh positive appearing mid-reuse must
// not surface a newly-sent draft as editable).
// ---------------------------------------------------------------------------
describe("createDraft pre-draft detection (T04 step 7, §8.1)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const auditModule = new EmailReplyAuditLogModule();
  const guardModule = new EmailReplyGuardModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4244;
    msg.providerUid = `det-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = 4244;
    draft.subject = "Re: Hi";
    draft.bodyText = "draft body";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  it("detection `replied` before classification → no model call, reservation released, code already_replied", async () => {
    const messageId = await seedMessage();
    // No seeded draft → reservation returns `acquired` → the pre-draft
    // detection on the acquire path runs and refuses before classification.
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      detectionResult: {
        state: "replied",
        replied: true,
        source: "sent_search",
        matchedMessageId: "sent-123@example.com",
        reasonCode: "already_replied",
        checkedAt: new Date().toISOString(),
        fromCache: false,
        coverage: "configured_imap",
      },
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(requests).toHaveLength(0); // NO model call
    expect(result.code).toBe("already_replied");
    // No existing draft on a clean message → next_action routes to
    // await_human_review (R-5 canonical mapping — approve_existing_draft
    // requires an existing draft; no_action would hide the replied state).
    expect(result.next_action).toBe("await_human_review");
    // One `reply_skipped` audit row, stage pre_draft.
    const { records: auditRecords } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    const skipped = auditRecords.filter((a) => a.action === "reply_skipped");
    expect(skipped).toHaveLength(1);
    // Reservation released — the guard row is back to `idle`, not holding a
    // `generating`/`draft_ready` lease.
    const guardRow = await guardModule.findByReplyKey(
      4244,
      `row:${messageId}`
    );
    expect(guardRow).not.toBeNull();
    expect(guardRow?.phase).toBe("idle");
  });

  it("detection `unknown` before classification → no model call, code = detection unknown code", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      detectionResult: {
        state: "unknown",
        replied: null,
        source: "unavailable",
        matchedMessageId: null,
        reasonCode: "probe_timeout",
        checkedAt: new Date().toISOString(),
        fromCache: false,
        coverage: "partial",
      },
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(requests).toHaveLength(0);
    expect(result.code).toBe("probe_timeout");
    expect(result.next_action).toBe("discard_and_retry");
    const { records: auditRecords } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    const skipped = auditRecords.filter((a) => a.action === "reply_skipped");
    expect(skipped).toHaveLength(1);
  });

  it("detection `not_replied` proceeds to classification and generation", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      // default detectionResult is `not_replied`
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(requests).toHaveLength(1); // model WAS called
    expect(result.reused).toBe(false);
  });

  it("reuse path reruns detection and refuses when a positive appears before reuse", async () => {
    // Seed an eligible draft for reuse (reservation returns `reusable`). The
    // §8.1 reuse-path detection then runs BEFORE the draft is returned; a
    // positive outcome refuses the reuse with `already_replied` and surfaces
    // the seeded draft as `existing_draft_id` — never silently returning a
    // replied draft as editable. NO model call.
    const messageId = await seedMessage();
    const draftId = await seedDraft(messageId, "draft");
    expect(draftId).toBeGreaterThan(0);
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      detectionResult: {
        state: "replied",
        replied: true,
        source: "sent_search",
        matchedMessageId: "sent-456@example.com",
        reasonCode: "already_replied",
        checkedAt: new Date().toISOString(),
        fromCache: false,
        coverage: "configured_imap",
      },
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    // The reuse-path detection refused → no model call, code already_replied,
    // existing_draft_id points at the seeded draft (route user to approve).
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(requests).toHaveLength(0);
    expect(result.code).toBe("already_replied");
    expect(result.existing_draft_id).toBe(draftId);
    expect(result.next_action).toBe("approve_existing_draft");
  });
});

// ---------------------------------------------------------------------------
// B01: local duplicate eligibility + reuse run BEFORE classification
// ---------------------------------------------------------------------------
describe("createDraft runs guard + reuse before classification (B01)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  // Reuse the same seed shape as the FR-028 block above, but default to an
  // UNKNOWN classification — the B01 regression is that the OLD code refined
  // classification (an AI round-trip) before consulting the guard or reuse,
  // so an already-sent or reusable message with an absent classification paid
  // for a classifier call before being refused/reused.
  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4244;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    // Unknown by default — the whole point of B01 is that an inconclusive
    // deterministic classification never triggers an AI refinement call when
    // the guard or reuse already settles the outcome.
    msg.classification = over.classification ?? null;
    msg.classificationConfidence = over.classificationConfidence ?? null;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = 4244;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  it("refuses already_replied with zero AI calls even when classification is unknown", async () => {
    // Sent evidence + absent classification. OLD behavior: refined the
    // classification (1 AI call) then refused. B01: refuse first, zero calls.
    const messageId = await seedMessage({
      classification: null,
      replyStatus: "sent",
    });
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("already_replied");
    // No classifier call AND no generator call — the guard ran first.
    expect(requests).toHaveLength(0);
  });

  it("reuses an eligible draft with zero AI calls even when classification is unknown", async () => {
    // Reusable draft + absent classification. OLD behavior: refined the
    // classification (1 AI call) then reused. B01: reuse first, zero calls.
    const messageId = await seedMessage({ classification: null });
    const draftId = await seedDraft(messageId, "draft");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(draftId);
    // No classifier call AND no generator call — reuse ran before classification.
    expect(requests).toHaveLength(0);
  });

  it("still refines classification when the guard allows and no draft is reusable", async () => {
    // Clean message, unknown classification, no reusable draft → the guard
    // allows, reuse finds nothing, THEN classification fires before generation.
    // This proves B01 did not drop classification entirely; it only reordered
    // it after the cheap local checks.
    const messageId = await seedMessage({ classification: null });
    // First call: classifier JSON verdict. Second call: generation JSON.
    const classifierJson = JSON.stringify({
      classification: "interested",
      confidence: 0.9,
    });
    const { factory, requests } = fakeApiFactory([
      completionResponse(classifierJson),
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(false);
    // Both calls fired: classification refinement + generation.
    expect(requests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// One refusal audit per invocation (FR-034, Phase-1 slice)
// ---------------------------------------------------------------------------
describe("createDraft refusal audits (FR-034)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const auditModule = new EmailReplyAuditLogModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4245;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = 4245;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  async function refusalAuditsFor(messageId: number): Promise<EmailReplyAuditLogEntity[]> {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    return records.filter((r) => r.action === "reply_skipped");
  }

  it("writes exactly ONE reply_skipped audit row on an already_replied refusal, with stage + code", async () => {
    const messageId = await seedMessage({ replyStatus: "sent" });
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].action).toBe("reply_skipped");
    expect(refusals[0].reason).toContain("[already_replied]");
    const meta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
      correlationId?: string;
    };
    expect(meta.stage).toBe("pre_draft");
    expect(meta.code).toBe("already_replied");
    expect(meta.correlationId).toBeTruthy();
    // Zero LLM calls — the guard refused before any generation work.
    expect(requests).toHaveLength(0);
  });

  it("writes exactly ONE reply_skipped audit row on a policy hard-block (bounce), with stage + code", async () => {
    const messageId = await seedMessage({ classification: "bounce" });
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    const meta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
    };
    expect(meta.stage).toBe("pre_draft");
    expect(meta.code).toBe("bounce");
    expect(requests).toHaveLength(0);
  });

  it("writes ZERO refusal audit rows on the reuse path (reuse is not a refusal)", async () => {
    const messageId = await seedMessage({ replyStatus: "draft_created" });
    await seedDraft(messageId, "draft");
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
  });

  it("writes ZERO refusal audit rows on the clean-message happy path", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({
      apiFactory: factory,
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
    // The happy path writes a draft_created audit, not a refusal.
    const { records } = await auditModule.list({ messageId, page: 0, size: 50 });
    expect(records.some((r) => r.action === "draft_created")).toBe(true);
  });

  it("writes exactly ONE reply_skipped audit row when a race flips replyStatus to sent mid-generation", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const flippingFactory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        await messageModule.updateReplyStatus(messageId, "sent");
        const real = factory();
        return real.openAIChatCompletion(req);
      },
    });
    const svc = buildService({
      apiFactory: flippingFactory,
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    const meta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
    };
    expect(meta.stage).toBe("post_generation");
    expect(meta.code).toBe("already_replied");
  });
});

// ---------------------------------------------------------------------------
// B09: reuse decodes stored warnings + records exactly ONE decision event,
// and audit persistence failure on reuse propagates (not swallowed).
// ---------------------------------------------------------------------------
describe("createDraft reuse preserves stored warnings + audit (B09)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const auditModule = new EmailReplyAuditLogModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4247;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraftWithWarnings(
    messageId: number,
    status: EmailReplyDraftEntity["status"],
    warnings: string[],
    knowledgeAuditCount = 0
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = 4247;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    draft.warningsJson = JSON.stringify(warnings);
    // Build minimal audit-metadata records (no `content` field) so we can
    // assert the provenance count is recorded without inventing excerpts.
    const audits = Array.from({ length: knowledgeAuditCount }, (_, i) => ({
      toolName: "knowledge_search",
      query: `q${i}`,
      chunkId: `c${i}`,
      documentId: `d${i}`,
      documentName: `Doc ${i}`,
      score: 0.5,
    }));
    draft.knowledgeSourcesJson =
      audits.length > 0 ? JSON.stringify(audits) : null;
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  async function reuseAuditsFor(
    messageId: number
  ): Promise<EmailReplyAuditLogEntity[]> {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    return records.filter((r) => r.action === "message_read_by_ai");
  }

  it("initial reuse decodes stored warnings into the result", async () => {
    const messageId = await seedMessage();
    const draftId = await seedDraftWithWarnings(messageId, "draft", [
      "owner-voice profile is stale",
      "recipient is an autoresponder",
    ]);
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(draftId);
    // B09: warnings are the stored strings, not an empty array.
    expect(result.warnings).toEqual([
      "owner-voice profile is stale",
      "recipient is an autoresponder",
    ]);
    // knowledgeSources stays [] — the stored JSON has audit metadata, no
    // source excerpts, so we do not invent content/score.
    expect(result.knowledgeSources).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("initial reuse writes exactly ONE message_read_by_ai audit with stage=reuse + provenance count", async () => {
    const messageId = await seedMessage();
    const draftId = await seedDraftWithWarnings(
      messageId,
      "draft",
      ["w1"],
      2 /* knowledgeAuditCount */
    );
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    const reuses = await reuseAuditsFor(messageId);
    expect(reuses).toHaveLength(1);
    const meta = JSON.parse(reuses[0].metadataJson ?? "{}") as {
      stage?: string;
      reusedDraftId?: number;
      reusedDraftStatus?: string;
      knowledgeAuditCount?: number;
      correlationId?: string;
    };
    expect(meta.stage).toBe("reuse");
    expect(meta.reusedDraftId).toBe(draftId);
    expect(meta.reusedDraftStatus).toBe("draft");
    expect(meta.knowledgeAuditCount).toBe(2);
    expect(meta.correlationId).toBeTruthy();
  });

  it("initial reuse records ZERO refusal audits (reuse is a decision event, not a refusal)", async () => {
    const messageId = await seedMessage();
    await seedDraftWithWarnings(messageId, "draft", ["w1"]);
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    expect(records.filter((r) => r.action === "reply_skipped")).toHaveLength(0);
  });

  it("race reuse (sibling appeared mid-generation) writes the message_read_by_ai audit", async () => {
    // A clean message with no drafts enters generation; a sibling draft is
    // inserted during the awaited LLM call, so the post-generation recheck
    // reuses it instead of persisting a duplicate. B09: that race-reuse path
    // must also record exactly ONE decision event.
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const siblingInsertingFactory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        // Simulate a concurrent approval/insert producing a reusable draft.
        await seedDraftWithWarnings(messageId, "draft", [
          "race-inserted sibling",
        ]);
        const real = factory();
        return real.openAIChatCompletion(req);
      },
    });
    const svc = buildService({
      apiFactory: siblingInsertingFactory,
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.warnings).toEqual(["race-inserted sibling"]);
    const reuses = await reuseAuditsFor(messageId);
    expect(reuses).toHaveLength(1);
    expect(JSON.parse(reuses[0].metadataJson ?? "{}")).toMatchObject({
      stage: "reuse",
    });
    // No duplicate draft was persisted — the sibling is the only one.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
  });

  it("audit persistence failure on initial reuse propagates as success:false (not swallowed)", async () => {
    // B09 acceptance: "Audit failure must not return a successful audited
    // outcome." Inject a failing reply-audit module through the D7.1
    // replyAuditModuleFactory seam and assert the reuse result is a failure
    // carrying the persistence error. T12/FR-039: the catch also emits
    // audit_failure{stage=reuse} so the unrecorded work is measurable.
    const messageId = await seedMessage();
    await seedDraftWithWarnings(messageId, "draft", ["w1"]);
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const { module } = makeFailingReplyAuditModule(
      "audit DB write failed (simulated)"
    );
    const svc = buildService({
      apiFactory: factory,
      replyAuditModuleFactory: () => module,
    });
    drainCountersForTest();
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("Reuse audit persistence failed");
    expect(result.error).toContain("audit DB write failed (simulated)");
    // T12/FR-039: the unrecorded reuse surfaces as an audit_failure counter
    // keyed by stage so operators can alert on audit-write regressions.
    const counters = drainCountersForTest();
    expect(counters.get("audit_failure{stage=reuse}")).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // T12/FR-039 — pre_draft audit-failure coverage. The runPreDraftDetection
  // catch(auditError) site emits audit_failure{stage=pre_draft} when the
  // `reply_skipped` audit row for a detection refusal cannot persist (§9.2 —
  // an unrecorded draft refusal must never be followed by proceeding to
  // draft). The detection outcome itself is faked via buildService's
  // detectionResult override; the audit module's create is monkey-patched to
  // throw, mirroring the reuse test above.
  // ---------------------------------------------------------------------------
  it("pre_draft audit persistence failure emits audit_failure{stage=pre_draft} + success:false (Detection audit persistence failed)", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const { module } = makeFailingReplyAuditModule(
      "pre-draft audit DB write failed (simulated)"
    );
    const svc = buildService({
      apiFactory: factory,
      replyAuditModuleFactory: () => module,
      detectionResult: {
        state: "replied",
        replied: true,
        source: "sent_search",
        matchedMessageId: "sent-123@example.com",
        reasonCode: "already_replied",
        checkedAt: new Date().toISOString(),
        fromCache: false,
        coverage: "configured_imap",
      },
    });
    drainCountersForTest();
    const result = await svc.createDraft({ messageId });
    // The audit failure STOPS the work — the refusal is returned as a
    // success:false carrying the persistence error (no code/next_action —
    // the typed refusal never reached the return path).
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("Detection audit persistence failed");
    expect(result.error).toContain(
      "pre-draft audit DB write failed (simulated)"
    );
    const counters = drainCountersForTest();
    expect(counters.get("audit_failure{stage=pre_draft}")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B09: decodeStoredWarnings — pure unit cases on the stored payload.
// ---------------------------------------------------------------------------
describe("decodeStoredWarnings (B09)", () => {
  it("returns the stored warning strings", () => {
    expect(
      decodeStoredWarnings(JSON.stringify(["a", "b", "c"]))
    ).toEqual(["a", "b", "c"]);
  });

  it("returns [] for null / undefined / empty", () => {
    expect(decodeStoredWarnings(null)).toEqual([]);
    expect(decodeStoredWarnings(undefined)).toEqual([]);
    expect(decodeStoredWarnings("")).toEqual([]);
  });

  it("returns [] for malformed JSON (decoding fallback, not an invented value)", () => {
    expect(decodeStoredWarnings("{not json")).toEqual([]);
    expect(decodeStoredWarnings("[oops")).toEqual([]);
  });

  it("returns [] for a non-array JSON value", () => {
    expect(decodeStoredWarnings(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(decodeStoredWarnings(JSON.stringify("single"))).toEqual([]);
    expect(decodeStoredWarnings(JSON.stringify(42))).toEqual([]);
  });

  it("filters out non-string entries from a mixed array", () => {
    expect(
      decodeStoredWarnings(JSON.stringify(["ok", 123, null, { x: 1 }, "ok2"]))
    ).toEqual(["ok", "ok2"]);
  });
});

// ---------------------------------------------------------------------------
// B10: provider/validation exception handling is separated from persistence
// failures. The failure audit is attempted exactly once; a persistence error
// in recordFailure propagates (not re-caught as a transport error and not
// re-classified as a generic provider failure).
// ---------------------------------------------------------------------------
describe("createDraft failure-audit separation (B10)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const auditModule = new EmailReplyAuditLogModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4248;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  /** Count how many times recordFailure attempted to write an audit row. */
  async function auditWriteCount(messageId: number): Promise<number> {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 100,
    });
    return records.filter((r) => r.action === "reply_skipped").length;
  }

  it("writes exactly ONE needs_human_review audit on two-strike validation failure (no fabricated provider error)", async () => {
    // Both LLM calls return malformed JSON -> validation_failed outcome.
    // recordFailure is called exactly once with code=needs_human_review.
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse("{not json", "stop"),
      completionResponse("{also not json", "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("[needs_human_review]");
    // Exactly TWO LLM calls (first + one correction), then stop.
    expect(requests).toHaveLength(2);
    // Exactly ONE audit row, classified needs_human_review (NOT provider_error).
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    const skips = records.filter((r) => r.action === "reply_skipped");
    expect(skips).toHaveLength(1);
    const meta = JSON.parse(skips[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
    };
    expect(meta.stage).toBe("generation");
    expect(meta.code).toBe("needs_human_review");
  });

  it("propagates a persistent recordFailure error (not swallowed, not re-classified as provider_error)", async () => {
    // B10 acceptance: a persistence failure in the failure-audit write must
    // propagate. Stub replyAuditModule.create to throw persistently; the
    // two-strike validation-failure path must surface the persistence error
    // and NOT attempt a second audit write (which previously happened because
    // the thrown audit error was re-caught as a transport error).
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse("{not json", "stop"),
      completionResponse("{also not json", "stop"),
    ]);
    const { module, createCalls } = makeFailingReplyAuditModule(
      "audit DB write failed (simulated permanent)"
    );
    const svc = buildService({
      apiFactory: factory,
      replyAuditModuleFactory: () => module,
    });
    // The persistence error now PROPAGATES (rejects) instead of being
    // swallowed and re-classified as a provider_error. This is the B10
    // contract: "persistence failure propagated."
    await expect(
      svc.createDraft({ messageId, useKnowledgeLibrary: false })
    ).rejects.toThrow("audit DB write failed (simulated permanent)");
    // The recordFailure path was attempted exactly ONCE — no second attempt
    // from a re-caught transport-error handler (the pre-B10 bug).
    expect(createCalls).toHaveLength(1);
    // The intended classification was needs_human_review, NOT a fabricated
    // provider_error (the pre-B10 bug reclassified on the second catch).
    expect(createCalls[0].reason).toContain("[needs_human_review]");
    // And NO audit row actually landed (the write threw).
    expect(await auditWriteCount(messageId)).toBe(0);
  });

  it("a reject-once audit stub still surfaces the persistence error and writes no second audit", async () => {
    // B10 "reject-once stub" acceptance: the audit write rejects once; the
    // service does not retry the audit and does not reclassify. This mirrors
    // the permanent-failure case but asserts the reject-once contract
    // explicitly: one create() call, no retry, the intended stage/code was
    // needs_human_review (not fabricated into provider_error).
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse("{not json", "stop"),
      completionResponse("{also not json", "stop"),
    ]);
    const { module, createCalls } = makeFailingReplyAuditModule(
      "audit write rejected once (simulated)"
    );
    const svc = buildService({
      apiFactory: factory,
      replyAuditModuleFactory: () => module,
    });
    await expect(
      svc.createDraft({ messageId, useKnowledgeLibrary: false })
    ).rejects.toThrow("audit write rejected once (simulated)");
    // Exactly ONE create() call — no retry, no second attempt from a
    // re-caught transport-error handler.
    expect(createCalls).toHaveLength(1);
    // The intended stage/code was needs_human_review (the persistence error
    // surfaced BEFORE the audit row could land, so the reason on the
    // attempted entity is the validation-failure classification, not a
    // fabricated provider_error).
    expect(createCalls[0].reason).toContain("[needs_human_review]");
    expect(await auditWriteCount(messageId)).toBe(0);
  });

  it("transport_error writes exactly ONE provider_error audit and does not count a validation strike", async () => {
    // B10 companion: the transport-error outcome is also audited exactly once.
    // A provider throw surfaces as LlmTransportError; recordFailure writes one
    // provider_error row; no validation strike (no second LLM call).
    const messageId = await seedMessage();
    const requests: OpenAIChatCompletionRequest[] = [];
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        requests.push(req);
        throw new Error("network timeout");
      },
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("[provider_error]");
    // Exactly ONE provider call (no correction attempt — transport errors are
    // not validation strikes).
    expect(requests).toHaveLength(1);
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    const skips = records.filter((r) => r.action === "reply_skipped");
    expect(skips).toHaveLength(1);
    const meta = JSON.parse(skips[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
    };
    expect(meta.stage).toBe("generation");
    expect(meta.code).toBe("provider_error");
  });
});

// ---------------------------------------------------------------------------
// B11: a per-invocation request correlation id is allocated at the createDraft
// entry boundary. Two invocations for the same message get DISTINCT request ids;
// all audit events written during one invocation carry that invocation's id in
// metadataJson.correlationId (alongside the deterministic per-message
// messageCorrelationId); the returned result carries it as requestCorrelationId.
// ---------------------------------------------------------------------------
describe("createDraft request correlation id (B11)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const auditModule = new EmailReplyAuditLogModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4249;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = 4249;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  /** All audit rows for a message, newest-first by list() ordering. */
  async function auditsFor(
    messageId: number
  ): Promise<EmailReplyAuditLogEntity[]> {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 100,
    });
    return records;
  }

  it("two invocations for the same message get DISTINCT requestCorrelationIds and each result carries its own", async () => {
    // Reuse path: two consecutive createDraft calls for the same message reuse
    // the same existing draft. Each call must allocate a fresh request id and
    // surface it on the returned result.
    const messageId = await seedMessage();
    await seedDraft(messageId, "draft");
    const { factory } = fakeApiFactory([completionResponse(validReplyJson)]);
    const svc = buildService({ apiFactory: factory });

    const result1 = await svc.createDraft({ messageId });
    const result2 = await svc.createDraft({ messageId });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    if (!result1.success || !result2.success) return;
    // Each result carries a non-empty requestCorrelationId...
    expect(typeof result1.requestCorrelationId).toBe("string");
    expect(result1.requestCorrelationId.length).toBeGreaterThan(0);
    expect(typeof result2.requestCorrelationId).toBe("string");
    expect(result2.requestCorrelationId.length).toBeGreaterThan(0);
    // ...and they are DISTINCT (per-invocation, not per-message).
    expect(result1.requestCorrelationId).not.toBe(result2.requestCorrelationId);
  });

  it("all audit events within one invocation carry that invocation's requestCorrelationId (correlationId field)", async () => {
    // A two-strike validation failure writes exactly ONE reply_skipped audit.
    // That row's metadataJson.correlationId must equal the requestCorrelationId
    // returned on the failed result, and metadataJson.messageCorrelationId must
    // be the deterministic per-message id (stable across invocations).
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse("{not json", "stop"),
      completionResponse("{also not json", "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const requestCorrelationId = result.requestCorrelationId;
    expect(requestCorrelationId).toBeTruthy();

    const audits = await auditsFor(messageId);
    const skips = audits.filter((r) => r.action === "reply_skipped");
    expect(skips).toHaveLength(1);
    const meta = JSON.parse(skips[0].metadataJson ?? "{}") as {
      correlationId?: string;
      messageCorrelationId?: string;
      stage?: string;
      code?: string;
    };
    // The audit's correlationId is THIS invocation's request id.
    expect(meta.correlationId).toBe(requestCorrelationId);
    // The messageCorrelationId is the deterministic per-message id (stable
    // across invocations for the same message).
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
    expect(meta.stage).toBe("generation");
    expect(meta.code).toBe("needs_human_review");
  });

  it("the deterministic messageCorrelationId is STABLE across two invocations for the same message", async () => {
    // Two invocations for the same message -> two distinct requestCorrelationIds
    // but the SAME messageCorrelationId on every audit row. This is the dual-id
    // contract: request id separates invocations; message id groups them.
    const messageId = await seedMessage();
    await seedDraft(messageId, "draft");
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson),
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });

    const r1 = await svc.createDraft({ messageId });
    const r2 = await svc.createDraft({ messageId });
    if (!r1.success || !r2.success) return;

    const audits = await auditsFor(messageId);
    const reuses = audits.filter((r) => r.action === "message_read_by_ai");
    expect(reuses).toHaveLength(2);
    // list() ordering is newest-first; match rows to results by request id
    // rather than assuming index order, so the assertion is order-independent.
    const rowFor = (reqId: string) =>
      reuses.find(
        (r) =>
          (JSON.parse(r.metadataJson ?? "{}") as { correlationId?: string })
            .correlationId === reqId
      );
    const row1 = rowFor(r1.requestCorrelationId);
    const row2 = rowFor(r2.requestCorrelationId);
    expect(row1).toBeTruthy();
    expect(row2).toBeTruthy();
    const meta1 = JSON.parse(row1?.metadataJson ?? "{}") as {
      correlationId?: string;
      messageCorrelationId?: string;
    };
    const meta2 = JSON.parse(row2?.metadataJson ?? "{}") as {
      correlationId?: string;
      messageCorrelationId?: string;
    };
    // Distinct request ids (one per invocation)...
    expect(meta1.correlationId).not.toBe(meta2.correlationId);
    expect(meta1.correlationId).toBe(r1.requestCorrelationId);
    expect(meta2.correlationId).toBe(r2.requestCorrelationId);
    // ...but the SAME deterministic per-message id on both rows.
    expect(meta1.messageCorrelationId).toBe(meta2.messageCorrelationId);
  });

  it("a fresh-generation success carries requestCorrelationId and the draft_created audit matches it", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(false);
    expect(result.requestCorrelationId).toBeTruthy();
    expect(requests).toHaveLength(1);

    const audits = await auditsFor(messageId);
    const created = audits.filter((r) => r.action === "draft_created");
    expect(created.length).toBeGreaterThanOrEqual(1);
    const meta = JSON.parse(created[0].metadataJson ?? "{}") as {
      correlationId?: string;
      messageCorrelationId?: string;
    };
    expect(meta.correlationId).toBe(result.requestCorrelationId);
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(result.requestCorrelationId);
  });
});


// ---------------------------------------------------------------------------
// B03: post-generation recheck runs the FULL guard, not a live-draft filter
// ---------------------------------------------------------------------------
describe("createDraft post-generation recheck runs the full guard (B03)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const attemptModule = new EmailReplySendAttemptModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4246;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"],
    emailServiceId = 4246
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  async function seedAttempt(
    messageId: number,
    status: EmailReplySendAttemptStatus,
    emailServiceId = 4246
  ): Promise<void> {
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `key-${Math.random()}`;
    attempt.draftId = 900000 + Math.floor(Math.random() * 9999);
    attempt.revisionId = attempt.draftId;
    attempt.approvalId = attempt.draftId;
    attempt.messageId = messageId;
    attempt.conversationId = null;
    attempt.emailServiceId = emailServiceId;
    attempt.senderAddress = "owner@example.com";
    attempt.recipientAddress = "person@example.com";
    attempt.status = status;
    attempt.claimedAt = new Date();
    attempt.submittedAt = null;
    attempt.completedAt = null;
    attempt.providerMessageId = null;
    attempt.failureCode = null;
    attempt.sanitizedError = null;
    await attemptModule.create(attempt);
  }

  /**
   * Build a factory that injects a state change during the awaited LLM call.
   * The mutation runs AFTER the model returns but BEFORE the recheck, so the
   * recheck observes the freshly written sibling/attempt state.
   */
  function factoryThatMutatesDuringCall(
    mutation: () => Promise<void>,
    response: OpenAIChatCompletionResponse = completionResponse(validReplyJson)
  ): AiChatApiFactory {
    return () => ({
      openAIChatCompletion: async () => {
        const resp = response;
        await mutation();
        return Promise.resolve(resp);
      },
    });
  }

  it("discards generated content when a sent sibling appears during generation (not reuse)", async () => {
    const messageId = await seedMessage();
    // During the LLM call, a sibling draft finalizes as sent.
    const factory = factoryThatMutatesDuringCall(async () => {
      const siblingId = await seedDraft(messageId, "draft");
      await draftModule.markSent(siblingId, new Date());
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("already_replied");
    // No NEW draft persisted (the sibling is the only draft row).
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("sent");
  });

  it("discards generated content when a delivery_unknown sibling appears during generation", async () => {
    const messageId = await seedMessage();
    const factory = factoryThatMutatesDuringCall(async () => {
      await seedDraft(messageId, "delivery_unknown");
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("delivery_unknown");
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("delivery_unknown");
  });

  it("discards generated content when a sending sibling appears during generation", async () => {
    const messageId = await seedMessage();
    const factory = factoryThatMutatesDuringCall(async () => {
      await seedDraft(messageId, "sending");
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("reply_in_progress");
  });

  it("discards generated content when a sent send-attempt appears during generation (no draft)", async () => {
    // The attempt ledger is authoritative even with no draft row — the
    // previous recheckLive filter would have missed this entirely.
    const messageId = await seedMessage();
    const factory = factoryThatMutatesDuringCall(async () => {
      await seedAttempt(messageId, "sent");
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("already_replied");
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(0);
  });

  it("refuses reply_state_conflict when multiple live siblings appear during generation", async () => {
    const messageId = await seedMessage();
    const factory = factoryThatMutatesDuringCall(async () => {
      await seedDraft(messageId, "draft");
      await seedDraft(messageId, "draft");
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("reply_state_conflict");
    // The two siblings remain; no third draft persisted.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(2);
  });

  it("still reuses a single eligible live sibling that appears during generation", async () => {
    // Regression: the full guard allows one eligible live draft, and the
    // recheck path reuses it instead of persisting a duplicate.
    const messageId = await seedMessage();
    const factory = factoryThatMutatesDuringCall(async () => {
      await seedDraft(messageId, "draft");
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    // Exactly one draft — the sibling, not a newly persisted duplicate.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B07: model intentSuggestion is metadata only; authoritative classification
// is preserved.
// ---------------------------------------------------------------------------
describe("createDraft preserves authoritative classification (B07)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4247;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    // Authoritative classification set BEFORE generation — must survive.
    msg.classification = over.classification ?? "support_request";
    msg.classificationConfidence = over.classificationConfidence ?? 0.97;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  it("does NOT overwrite authoritative classification with a disagreeing intentSuggestion", async () => {
    const messageId = await seedMessage({
      classification: "support_request",
      classificationConfidence: 0.97,
    });
    // Model suggests "interested" — disagrees with authoritative "support_request".
    const { factory } = fakeApiFactory([
      completionResponse(
        JSON.stringify({
          subject: "Re: Hi",
          bodyText: "Happy to help with that.",
          intentSuggestion: "interested",
          confidence: 0.6,
        })
      ),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Authoritative classification preserved on the message.
    const after = await messageModule.read(messageId);
    expect(after?.classification).toBe("support_request");
    expect(after?.classificationConfidence).toBe(0.97);
    // Returned draft carries the authoritative value, not the suggestion.
    expect(result.classification).toBe("support_request");
    expect(result.confidence).toBe(0.97);
    // The suggestion is persisted on the draft as metadata only.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].intentSuggestion).toBe("interested");
    expect(drafts[0].intentSuggestionConfidence).toBe(0.6);
    expect(drafts[0].confidence).toBe(0.97);
  });

  it("preserves a disagreeing authoritative classification in the other direction", async () => {
    // Authoritative "interested" with high confidence; model suggests
    // "support_request" (disagreeing the other way). The authoritative value
    // must still win; the suggestion is metadata only.
    const messageId = await seedMessage({
      classification: "interested",
      classificationConfidence: 0.92,
    });
    const { factory } = fakeApiFactory([
      completionResponse(
        JSON.stringify({
          subject: "Re: Hi",
          bodyText: "Let me look into that for you.",
          intentSuggestion: "support_request",
          confidence: 0.4,
        })
      ),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const after = await messageModule.read(messageId);
    expect(after?.classification).toBe("interested");
    expect(after?.classificationConfidence).toBe(0.92);
    expect(result.classification).toBe("interested");
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts[0].intentSuggestion).toBe("support_request");
    expect(drafts[0].intentSuggestionConfidence).toBe(0.4);
    expect(drafts[0].confidence).toBe(0.92);
  });
});

describe("parseReplyJson", () => {
  it("parses a clean JSON reply", () => {
    const r = parseReplyJson(
      JSON.stringify({
        subject: "Re: Pricing",
        bodyText: "Thanks for asking!",
        classification: "interested",
        confidence: 0.9,
      })
    );
    expect(r.subject).toBe("Re: Pricing");
    expect(r.bodyText).toBe("Thanks for asking!");
    expect(r.classification).toBe("interested");
    expect(r.confidence).toBe(0.9);
  });

  it("strips ```json code fences", () => {
    const r = parseReplyJson(
      '```json\n{"subject":"Re: Hi","bodyText":"hello","classification":"interested","confidence":0.8}\n```'
    );
    expect(r.subject).toBe("Re: Hi");
    expect(r.bodyText).toBe("hello");
  });

  it("tolerates stray text around the JSON object", () => {
    const r = parseReplyJson(
      'Here is your reply: {"subject":"Re:x","bodyText":"b","classification":"unknown","confidence":0.1} hope it helps'
    );
    expect(r.subject).toBe("Re:x");
    expect(r.bodyText).toBe("b");
  });

  it("returns empty body when no JSON is present (no raw-text fallback)", () => {
    const r = parseReplyJson("no json at all");
    expect(r.classification).toBe("unknown");
    expect(r.bodyText).toBe("");
    expect(r.confidence).toBe(0);
  });

  it("returns empty body when JSON is malformed", () => {
    const r = parseReplyJson("{not valid json}");
    expect(r.bodyText).toBe("");
    expect(r.classification).toBe("unknown");
  });
});

describe("generation deadline enforcement (FR-035 slice / B13)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const auditModule = new EmailReplyAuditLogModule();

  /** Seed one clean message on a distinct emailServiceId (isolated DB rows). */
  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4247;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  beforeEach(() => {
    drainCountersForTest();
  });

  it("blocks the correction call once the deadline expires mid-flight (B13: correction cannot start after expiry)", async () => {
    const messageId = await seedMessage();
    // First submission responds (malformed JSON → validation strike) and
    // consumes the whole budget; the correction call must then be REFUSED at
    // the gate — expiry is a transport failure, not a second validation strike.
    let nowMs = 1_000_000;
    let calls = 0;
    const svc = buildService({
      budget: { now: () => nowMs, budgetMs: 100 },
      apiFactory: () => ({
        openAIChatCompletion: async () => {
          calls += 1;
          nowMs += 10_000; // the first call outlives the tiny budget
          return completionResponse("{not valid json}");
        },
      }),
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("provider_error");
    expect(result.error).toContain("deadline exceeded");
    expect(result.next_action).toBe("discard_and_retry");
    // Exactly ONE model call: the correction submission was gated off.
    expect(calls).toBe(1);
    // No draft, no draft_created reply audit, no reply_status bump.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(0);
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    expect(
      records.filter((r) => r.action === "draft_created")
    ).toHaveLength(0);
    const after = await messageModule.read(messageId);
    expect(after?.replyStatus).toBe("not_started");
    // The deadline_exceeded metric fired for the correction stage (FR-039).
    const counters = drainCountersForTest();
    expect(counters.get("deadline_exceeded{stage=correction}")).toBe(1);
  });

  it("succeeds within budget and stamps callBudgetMs on the request", async () => {
    const messageId = await seedMessage();
    const requests: OpenAIChatCompletionRequest[] = [];
    let nowMs = 1_000_000;
    const svc = buildService({
      budget: { now: () => nowMs, budgetMs: 60_000 },
      apiFactory: () => ({
        openAIChatCompletion: async (req) => {
          requests.push(req);
          nowMs += 100; // the call consumes a little of the budget
          return completionResponse(validReplyJson);
        },
      }),
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    // Each generation submission carries a bounded, capped callBudgetMs.
    for (const req of requests) {
      expect(req.callBudgetMs).toBeDefined();
      if (req.callBudgetMs !== undefined) {
        expect(req.callBudgetMs).toBeLessThanOrEqual(120_000);
      }
    }
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
  });

  it("drops late output at persistence when the deadline expired mid-flight (B13)", async () => {
    const messageId = await seedMessage();
    // The model responds with VALID JSON while the clock is in-budget; the
    // deadline expires AFTER the response but BEFORE persistence. The
    // late-output guard must discard the output: no draft, no audit.
    let nowMs = 1_000_000;
    const svc = buildService({
      budget: { now: () => nowMs, budgetMs: 100 },
      apiFactory: () => ({
        openAIChatCompletion: async () => {
          const resp = completionResponse(validReplyJson);
          // The call finished in-budget, but everything after it (knowledge
          // retrieval, guard recheck, persistence) happens past expiry.
          nowMs += 500;
          return resp;
        },
      }),
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("deadline exceeded before persistence");
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(0);
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    expect(
      records.filter((r) => r.action === "draft_created")
    ).toHaveLength(0);
    const after = await messageModule.read(messageId);
    expect(after?.replyStatus).toBe("not_started");
    const counters = drainCountersForTest();
    expect(counters.get("deadline_exceeded{stage=persistence}")).toBe(1);
  });

  it("caps each model call at MODEL_CALL_CAP_MS even with budget remaining", async () => {
    const messageId = await seedMessage();
    const requests: OpenAIChatCompletionRequest[] = [];
    const svc = buildService({
      // Enormous aggregate budget, but every individual call is capped.
      budget: { now: () => 1_000_000, budgetMs: 600_000 },
      apiFactory: () => ({
        openAIChatCompletion: async (req) => {
          requests.push(req);
          return completionResponse(validReplyJson);
        },
      }),
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    for (const req of requests) {
      expect(req.callBudgetMs).toBe(120_000);
    }
  });
});

describe("completion telemetry persistence (T09/FR-027)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const revisionModule = new EmailReplyDraftRevisionModule();

  /**
   * Seed the email-service row the generation flow reads for the sender
   * address. Without a real `from`, stage 7b skips revision materialization
   * (senderAddress is required) and the revision assertions below see zero
   * rows.
   */
  async function seedEmailService(): Promise<void> {
    const { EmailServiceModel } = await import("@/model/EmailService.model");
    const { EmailServiceEntity } = await import("@/entity/EmailService.entity");
    const model = new EmailServiceModel("");
    const entity = new EmailServiceEntity();
    entity.id = 4249;
    entity.name = "Telemetry Test Service";
    entity.from = "owner@svc.com";
    entity.smtpUsername = null;
    entity.replyTo = null;
    entity.password = "secret";
    entity.host = "smtp.svc.com";
    entity.port = "465";
    entity.ssl = 1;
    entity.status = 1;
    await model.create(entity);
  }

  /** Seed one clean message on a distinct emailServiceId (isolated DB rows). */
  async function seedMessage(): Promise<number> {
    await seedEmailService();
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = 4249;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  it("persists the returned model, finish_reason, and token usage on the draft + revision", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    // The ACTUAL model from the completion response — not the pre-T09
    // "openai-compatible" literal.
    expect(drafts[0].modelName).toBe("test-model");
    expect(drafts[0].finishReason).toBe("stop");
    expect(drafts[0].promptTokens).toBe(10);
    expect(drafts[0].completionTokens).toBe(20);
    expect(drafts[0].totalTokens).toBe(30);
    // The materialized revision carries the same telemetry + honest
    // availability flags + generation-path provenance.
    const revisions = await revisionModule.listByDraft(drafts[0].id);
    expect(revisions).toHaveLength(1);
    const meta = JSON.parse(
      revisions[0].generationMetadataJson ?? "{}"
    ) as {
      model?: string | null;
      finishReason?: string | null;
      usage?: {
        promptTokens?: number | null;
        completionTokens?: number | null;
        totalTokens?: number | null;
      } | null;
      finishReasonUnavailable?: boolean;
      modelUnavailable?: boolean;
      correctionAttempted?: boolean;
      hintFallbackUsed?: boolean;
    };
    expect(meta.model).toBe("test-model");
    expect(meta.finishReason).toBe("stop");
    expect(meta.usage?.promptTokens).toBe(10);
    expect(meta.usage?.completionTokens).toBe(20);
    expect(meta.usage?.totalTokens).toBe(30);
    expect(meta.finishReasonUnavailable).toBe(false);
    expect(meta.modelUnavailable).toBe(false);
    expect(meta.correctionAttempted).toBe(false);
    expect(meta.hintFallbackUsed).toBe(false);
  });

  it("persists honest nulls (never the literal) when the provider omits model/usage/finish_reason", async () => {
    const messageId = await seedMessage();
    const bare = completionResponse(validReplyJson, "stop");
    delete (bare as { model?: unknown }).model;
    delete (bare as { usage?: unknown }).usage;
    bare.choices[0].finish_reason = null;
    const { factory } = fakeApiFactory([bare]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].modelName).toBeNull();
    expect(drafts[0].finishReason).toBeNull();
    expect(drafts[0].promptTokens).toBeNull();
    expect(drafts[0].completionTokens).toBeNull();
    expect(drafts[0].totalTokens).toBeNull();
    const revisions = await revisionModule.listByDraft(drafts[0].id);
    expect(revisions).toHaveLength(1);
    const meta = JSON.parse(
      revisions[0].generationMetadataJson ?? "{}"
    ) as {
      model?: string | null;
      finishReasonUnavailable?: boolean;
      modelUnavailable?: boolean;
      usage?: unknown;
    };
    expect(meta.model).toBeNull();
    expect(meta.usage).toBeNull();
    expect(meta.finishReasonUnavailable).toBe(true);
    expect(meta.modelUnavailable).toBe(true);
  });

  it("records correctionAttempted=true on the revision when the second attempt wins", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse("{not valid json}"),
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Two submissions: the malformed first, the corrected second.
    expect(requests).toHaveLength(2);
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    // The draft row carries the WINNING (second) response's telemetry.
    expect(drafts[0].modelName).toBe("test-model");
    const revisions = await revisionModule.listByDraft(drafts[0].id);
    const meta = JSON.parse(
      revisions[0].generationMetadataJson ?? "{}"
    ) as { correctionAttempted?: boolean; hintFallbackUsed?: boolean };
    expect(meta.correctionAttempted).toBe(true);
    expect(meta.hintFallbackUsed).toBe(false);
  });

  it("records hintFallbackUsed=true when the B06 no-hint retry wins", async () => {
    const messageId = await seedMessage();
    // First call rejects response_format as an unsupported parameter; the
    // retry (without the hint) succeeds. The request factory captures both.
    const requests: OpenAIChatCompletionRequest[] = [];
    let call = 0;
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        requests.push(req);
        call += 1;
        if (call === 1) {
          // A real provider 400: status + response_format in the message
          // (the detector requires BOTH — see isUnsupportedResponseFormatError).
          const err = new Error(
            "Bad request: response_format is not supported by this model"
          );
          (err as unknown as { status: number }).status = 400;
          throw err;
        }
        // The retry must omit response_format.
        expect(req.response_format).toBeUndefined();
        return completionResponse(validReplyJson, "stop");
      },
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(requests).toHaveLength(2);
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    const revisions = await revisionModule.listByDraft(drafts[0].id);
    const meta = JSON.parse(
      revisions[0].generationMetadataJson ?? "{}"
    ) as { correctionAttempted?: boolean; hintFallbackUsed?: boolean };
    expect(meta.hintFallbackUsed).toBe(true);
    expect(meta.correctionAttempted).toBe(false);
  });

  it("sends the default 1500-token output budget when maxTokens is not configured", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    // T09: the output budget is the FR-027 default, not a call-site literal
    // that only the edit site can change.
    for (const req of requests) {
      expect(req.max_tokens).toBe(1500);
    }
  });

  it("honors a configured maxTokens override on every generation submission", async () => {
    const messageId = await seedMessage();
    const requests: OpenAIChatCompletionRequest[] = [];
    let call = 0;
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        requests.push(req);
        call += 1;
        if (call === 1) {
          // First submission is malformed → the correction submission must
          // ALSO carry the configured budget.
          return completionResponse("{not valid json}", "stop");
        }
        return completionResponse(validReplyJson, "stop");
      },
    });
    const svc = buildService({
      apiFactory: factory,
      maxTokens: 900,
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    expect(requests).toHaveLength(2);
    for (const req of requests) {
      expect(req.max_tokens).toBe(900);
    }
    // The override reaches the persisted draft too.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
  });

  it("falls back to the default when maxTokens is invalid (zero, negative, NaN)", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({
      apiFactory: factory,
      maxTokens: 0,
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    for (const req of requests) {
      expect(req.max_tokens).toBe(1500);
    }
  });
});

describe("FR-039 generation/validation counters", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  /** Seed one clean message on a distinct emailServiceId (isolated DB rows). */
  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4251;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = 4251;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  beforeEach(() => {
    drainCountersForTest();
  });

  it("valid generation emits generation_outcome{ok} only (no validation/correction counters)", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    const counters = drainCountersForTest();
    expect(counters.get("generation_outcome{outcome=ok}")).toBe(1);
    expect(counters.get("correction_attempt{stage=generation}")).toBeUndefined();
    expect(counters.get("hint_fallback{stage=generation}")).toBeUndefined();
    // policy_decision (pre-draft guard) still fires; not a generation counter.
    expect(
      counters.get(
        "policy_decision{allowed=true,code=allowed,stage=pre_draft}"
      )
    ).toBe(1);
  });

  it("malformed-then-valid emits correction_attempt + validation_code + generation_outcome{ok}", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse("{not valid json}"),
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    const counters = drainCountersForTest();
    expect(counters.get("correction_attempt{stage=generation}")).toBe(1);
    expect(counters.get("generation_outcome{outcome=ok}")).toBe(1);
    // The first attempt's failure codes are recorded per code.
    expect(counters.get("validation_code{code=malformed_json}")).toBe(1);
  });

  it("double validation failure emits validation_code per code + generation_outcome{validation_failed}", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse("{not valid json}"),
      completionResponse("{also not valid}"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    const counters = drainCountersForTest();
    expect(counters.get("generation_outcome{outcome=validation_failed}")).toBe(1);
    expect(counters.get("validation_code{code=malformed_json}")).toBe(2);
    expect(counters.get("correction_attempt{stage=generation}")).toBe(1);
  });

  it("finish_reason length emits truncation_detected{finish_reason_length} + validation_code{truncated_output}", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      // The JSON parses, but the provider hit the token cap mid-output.
      completionResponse(validReplyJson, "length"),
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    const counters = drainCountersForTest();
    expect(
      counters.get("truncation_detected{source=finish_reason_length}")
    ).toBe(1);
    expect(counters.get("validation_code{code=truncated_output}")).toBe(1);
  });

  it("unsupported response_format then no-hint success emits hint_fallback", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    let call = 0;
    const stagedFactory: AiChatApiFactory = () => ({
      openAIChatCompletion: async () => {
        call += 1;
        if (call === 1) {
          const err = new Error(
            "Bad request: response_format is not supported by this model"
          );
          (err as unknown as { status: number }).status = 400;
          throw err;
        }
        return completionResponse(validReplyJson, "stop");
      },
    });
    void factory;
    const svc = buildService({
      apiFactory: stagedFactory,
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    const counters = drainCountersForTest();
    expect(counters.get("hint_fallback{stage=generation}")).toBe(1);
    expect(counters.get("generation_outcome{outcome=ok}")).toBe(1);
  });

  it("reuse path emits generation_outcome{reused} with zero model calls", async () => {
    const messageId = await seedMessage();
    await seedDraft(messageId, "draft");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(requests).toHaveLength(0);
    const counters = drainCountersForTest();
    expect(counters.get("generation_outcome{outcome=reused}")).toBe(1);
    expect(counters.get("generation_outcome{outcome=ok}")).toBeUndefined();
  });

  it("post-generation race recheck refusal emits guard_conflict{post_generation,code}", async () => {
    const messageId = await seedMessage();
    // The model responds during the call; a sibling draft flips the message
    // to sent before the recheck runs. Force the conflict by flipping
    // replyStatus inside the model callback (the awaited LLM call window).
    let flipped = false;
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async () => {
        if (!flipped) {
          flipped = true;
          // Simulate a sibling reply being sent DURING generation.
          await messageModule.updateReplyStatus(messageId, "sent");
        }
        return completionResponse(validReplyJson, "stop");
      },
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    const counters = drainCountersForTest();
    expect(
      counters.get("guard_conflict{code=already_replied,stage=post_generation}")
    ).toBe(1);
    // The winning generation DID validate — but its output was dropped at
    // the recheck, so generation_outcome{ok} fired inside the attempt while
    // the invocation overall failed.
    expect(counters.get("generation_outcome{outcome=ok}")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T07/FR-035 — the service acquires the persistent generation reservation
// AFTER the pre-draft guard allows and BEFORE classification/model work.
// Losers pay no model cost: generation_in_progress / reusable / blocked are
// decided in the acquire transaction. The reservation is released on every
// failure path and transitions to draft_ready inside the same atomic commit
// transaction that persists the draft (fenced by ownerToken — see the
// "fenced commit" test below).
// ---------------------------------------------------------------------------
describe("createDraft acquires the generation reservation (T07)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const attemptModule = new EmailReplySendAttemptModule();
  // The guard module is shared across the services under test so the
  // reservation rows are visible to assertions. Constructed at describe
  // scope (BaseModule resolves the dbpath through Token — same pattern as
  // every other block in this file).
  const guardModule = new EmailReplyGuardModule();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4252;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"],
    emailServiceId = 4252
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  async function seedAttempt(
    messageId: number,
    status: EmailReplySendAttemptStatus,
    emailServiceId = 4252
  ): Promise<void> {
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `key-${Math.random()}`;
    attempt.draftId = 900000 + Math.floor(Math.random() * 9999);
    attempt.revisionId = attempt.draftId;
    attempt.approvalId = attempt.draftId;
    attempt.messageId = messageId;
    attempt.conversationId = null;
    attempt.emailServiceId = emailServiceId;
    attempt.senderAddress = "owner@example.com";
    attempt.recipientAddress = "person@example.com";
    attempt.status = status;
    attempt.claimedAt = new Date();
    attempt.submittedAt = null;
    attempt.completedAt = null;
    attempt.providerMessageId = null;
    attempt.failureCode = null;
    attempt.sanitizedError = null;
    await attemptModule.create(attempt);
  }

  /**
   * Seed an unexpired `generating` guard row held by a foreign owner, as if
   * a crashed/slow invocation left its lease behind. In this file the modules
   * resolve through BaseModule's Token fallback (no USERSDBPATH store in
   * vitest), so the singleton lives at the aifetchly-test fallback dir.
   */
  async function seedGeneratingGuard(
    emailServiceId: number,
    replyKey: string,
    messageId: number
  ): Promise<void> {
    const { SqliteDb, getSqliteTestFallbackDir } = await import(
      "@/config/SqliteDb"
    );
    const connection = SqliteDb.getInstance(
      getSqliteTestFallbackDir()
    ).connection;
    const guard = new EmailReplyGuardEntity();
    guard.emailServiceId = emailServiceId;
    guard.replyKey = replyKey;
    guard.messageId = messageId;
    guard.phase = "generating";
    guard.ownerToken = "f".repeat(128);
    guard.leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
    await connection.getRepository(EmailReplyGuardEntity).save(guard);
  }

  /**
   * Wrap the shared guard module so a mutation runs immediately before the
   * acquire transaction — the window between the non-atomic pre-draft guard
   * (2b) read and the reservation read. This is exactly the TOCTOU the
   * reservation closes: a sibling that flips state after the read-side guard
   * allowed must be caught with zero model cost.
   */
  function guardModuleThatMutatesBeforeAcquire(
    mutation: () => Promise<void>
  ): EmailReplyGuardModule {
    const wrapped: EmailReplyGuardModule = Object.create(guardModule);
    wrapped.acquireReservation = async (input) => {
      await mutation();
      return guardModule.acquireReservation(input);
    };
    return wrapped;
  }

  beforeEach(() => {
    drainCountersForTest();
  });

  it("clean message: acquires, generates, and binds the guard to the committed draft", async () => {
    const messageId = await seedMessage();
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(false);
    expect(requests).toHaveLength(1);

    const counters = drainCountersForTest();
    expect(counters.get("reservation_outcome{outcome=acquired}")).toBe(1);

    // The guard row is bound to the committed draft in draft_ready inside the
    // atomic commit transaction (Step 4): the owner-token-fenced transition
    // rolls back together with the draft insert when it does not match.
    const guardRow = await guardModule.findByReplyKey(4252, `row:${messageId}`);
    expect(guardRow).not.toBeNull();
    expect(guardRow?.phase).toBe("draft_ready");
    expect(guardRow?.activeDraftId).toBe(result.draftId);
  });

  it("second concurrent createDraft for the same message loses with generation_in_progress and zero model calls", async () => {
    const messageId = await seedMessage();
    // Gate: the winner's LLM call blocks until the loser's acquire has run.
    const gate: { release: (() => void) | null } = { release: null };
    const winnerGate = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    let winnerProceeded = false;
    const { factory: realFactory, requests } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const winnerFactory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        // Hold the winner inside its LLM call while the second invocation
        // attempts to acquire.
        winnerProceeded = true;
        await winnerGate;
        return realFactory().openAIChatCompletion(req);
      },
    });
    const winner = buildService({
      apiFactory: winnerFactory,
      guardModuleFactory: () => guardModule,
    });
    const loser = buildService({
      apiFactory: fakeApiFactory([completionResponse(validReplyJson)]).factory,
      guardModuleFactory: () => guardModule,
    });

    const winnerPromise = winner
      .createDraft({ messageId, useKnowledgeLibrary: false })
      .then((r) => {
        expect(winnerProceeded).toBe(true);
        return r;
      });
    // Give the winner a tick to acquire its reservation inside the LLM call.
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const loserPromise = loser.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    const loserResult = await loserPromise;
    expect(loserResult.success).toBe(false);
    if (loserResult.success) return;
    expect(loserResult.code).toBe("generation_in_progress");
    expect(loserResult.next_action).toBe("no_action");
    expect(loserResult.error).toContain("generation_in_progress");
    // The loser acquired its own connection but never reached the model.
    const loserCounters = drainCountersForTest();
    expect(
      loserCounters.get("reservation_outcome{outcome=generation_in_progress}")
    ).toBe(1);

    // The winner proceeds after the loser returned and the gate opens.
    if (gate.release) gate.release();
    const winnerResult = await winnerPromise;
    expect(winnerResult.success).toBe(true);
    if (!winnerResult.success) return;
    expect(requests).toHaveLength(1);
    // Exactly one draft persisted across both invocations.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
  });

  it("reservation winner's failure path releases the guard so a retry can acquire", async () => {
    const messageId = await seedMessage();
    // First invocation: the model returns malformed output twice →
    // validation_failed → the reservation is released.
    const { factory } = fakeApiFactory([
      completionResponse("{nope}"),
      completionResponse("{still nope}"),
    ]);
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    const first = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(first.success).toBe(false);
    if (first.success) return;
    expect(first.code).toBe("needs_human_review");
    // The first invocation DID acquire before the model work.
    const firstCounters = drainCountersForTest();
    expect(firstCounters.get("reservation_outcome{outcome=acquired}")).toBe(1);

    // The guard row went back to idle with no owner (release on failure).
    const released = await guardModule.findByReplyKey(4252, `row:${messageId}`);
    expect(released?.phase).toBe("idle");
    expect(released?.ownerToken).toBeNull();

    // A retry acquires cleanly and generates.
    const retryFactory = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const retry = buildService({
      apiFactory: retryFactory.factory,
      guardModuleFactory: () => guardModule,
    });
    const second = await retry.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(second.success).toBe(true);
    const counters = drainCountersForTest();
    expect(counters.get("reservation_outcome{outcome=acquired}")).toBe(1);
  });

  it("reusable sibling draft is returned with zero model calls (reservation short-circuit)", async () => {
    const messageId = await seedMessage();
    const draftId = await seedDraft(messageId, "draft");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(draftId);
    expect(requests).toHaveLength(0);

    const counters = drainCountersForTest();
    expect(counters.get("reservation_outcome{outcome=reusable}")).toBe(1);
    expect(counters.get("reservation_outcome{outcome=acquired}")).toBeUndefined();
    // Reuse short-circuits BEFORE the INSERT — no guard row was created.
    const guardRow = await guardModule.findByReplyKey(4252, `row:${messageId}`);
    expect(guardRow).toBeNull();
  });

  it("sent attempt appearing in the TOCTOU window blocks at the reservation (already_replied, zero model calls)", async () => {
    const messageId = await seedMessage();
    // The pre-draft guard (2b) reads BEFORE the attempt exists and allows;
    // the attempt lands in the window between 2b and the acquire. The
    // reservation's reconcile must catch it with zero model cost — this is
    // the race the read-side guard misses.
    const wrappedGuard = guardModuleThatMutatesBeforeAcquire(async () => {
      await seedAttempt(messageId, "sent");
    });
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => wrappedGuard,
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("already_replied");
    // already_replied with no surfaced draft id maps to await_human_review
    // (R-5 canonical mapping — the operator locates the existing reply).
    expect(result.next_action).toBe("await_human_review");
    expect(requests).toHaveLength(0);

    const counters = drainCountersForTest();
    // T12/FR-039: the blocked outcome carries the typed policy code so
    // duplicate denials are distinguishable per code (already_replied here).
    expect(
      counters.get("reservation_outcome{code=already_replied,outcome=blocked}")
    ).toBe(1);
    // No guard row was created for a blocked cluster.
    const guardRow = await guardModule.findByReplyKey(4252, `row:${messageId}`);
    expect(guardRow).toBeNull();
  });

  it("a sent attempt seeded before the call is caught by the pre-draft guard (no reservation metric)", async () => {
    // The existing FR-028 behavior: an attempt present up front is refused by
    // the 2b guard before the reservation is ever consulted — the acquire is
    // reached only on a guard-allowed cluster.
    const messageId = await seedMessage();
    await seedAttempt(messageId, "sent");
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("already_replied");
    expect(requests).toHaveLength(0);
    const counters = drainCountersForTest();
    expect(
      counters.get("reservation_outcome{outcome=blocked}")
    ).toBeUndefined();
  });

  it("pre-seeded foreign generating lease returns generation_in_progress without a race", async () => {
    const messageId = await seedMessage();
    // A crashed/slow invocation left an unexpired generating guard row held
    // by a foreign owner token; this invocation must lose immediately.
    await seedGeneratingGuard(4252, `row:${messageId}`, messageId);
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("generation_in_progress");
    expect(result.next_action).toBe("no_action");
    // Zero model calls — classification and generation never ran.
    expect(requests).toHaveLength(0);
    const counters = drainCountersForTest();
    expect(
      counters.get("reservation_outcome{outcome=generation_in_progress}")
    ).toBe(1);
    // The foreign lease is untouched (fence: non-owners cannot mutate it).
    const guardRow = await guardModule.findByReplyKey(4252, `row:${messageId}`);
    expect(guardRow?.phase).toBe("generating");
    expect(guardRow?.ownerToken).toBe("f".repeat(128));
  });

  it("all four reservation outcomes emit exactly one counter each", async () => {
    // acquired
    const acquiredMessageId = await seedMessage({ emailServiceId: 4253 });
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const acquiredSvc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    const acquired = await acquiredSvc.createDraft({
      messageId: acquiredMessageId,
      useKnowledgeLibrary: false,
    });
    expect(acquired.success).toBe(true);

    // reusable
    const reusableMessageId = await seedMessage({ emailServiceId: 4254 });
    await seedDraft(reusableMessageId, "draft", 4254);
    const reusableSvc = buildService({
      apiFactory: fakeApiFactory([completionResponse(validReplyJson)]).factory,
      guardModuleFactory: () => guardModule,
    });
    const reusable = await reusableSvc.createDraft({
      messageId: reusableMessageId,
    });
    expect(reusable.success).toBe(true);
    if (!reusable.success) return;
    expect(reusable.reused).toBe(true);

    // blocked (already_replied) — the attempt lands in the TOCTOU window so
    // the reservation (not the pre-draft guard) produces the blocked outcome.
    const blockedMessageId = await seedMessage({ emailServiceId: 4255 });
    const blockedSvc = buildService({
      apiFactory: fakeApiFactory([completionResponse(validReplyJson)]).factory,
      guardModuleFactory: () =>
        guardModuleThatMutatesBeforeAcquire(async () => {
          await seedAttempt(blockedMessageId, "sent", 4255);
        }),
    });
    const blocked = await blockedSvc.createDraft({
      messageId: blockedMessageId,
    });
    expect(blocked.success).toBe(false);

    // generation_in_progress
    const inProgressMessageId = await seedMessage({ emailServiceId: 4256 });
    await seedGeneratingGuard(4256, `row:${inProgressMessageId}`, inProgressMessageId);
    const inProgressSvc = buildService({
      apiFactory: fakeApiFactory([completionResponse(validReplyJson)]).factory,
      guardModuleFactory: () => guardModule,
    });
    const inProgress = await inProgressSvc.createDraft({
      messageId: inProgressMessageId,
    });
    expect(inProgress.success).toBe(false);
    if (inProgress.success) return;
    expect(inProgress.code).toBe("generation_in_progress");

    const counters = drainCountersForTest();
    expect(counters.get("reservation_outcome{outcome=acquired}")).toBe(1);
    expect(counters.get("reservation_outcome{outcome=reusable}")).toBe(1);
    // T12/FR-039: the blocked outcome carries the typed policy code.
    expect(
      counters.get("reservation_outcome{code=already_replied,outcome=blocked}")
    ).toBe(1);
    expect(
      counters.get("reservation_outcome{outcome=generation_in_progress}")
    ).toBe(1);
  });

  it("atomic commit persists draft + revision + hash + projection + guard + audit together (Step 4 happy path)", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // Draft row: sendable projection carries the envelope + hash.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft.status).toBe("draft");
    expect(draft.senderAddress).toBe("owner@svc.com");
    expect(draft.recipientAddress).toBe("person@example.com");

    // Revision 1 was materialized INSIDE the commit (no unbound sendable
    // draft): validation findings + generation metadata are on the revision.
    const revisionModule = new EmailReplyDraftRevisionModule();
    const revisions = await revisionModule.listByDraft(draft.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revisionNumber).toBe(1);
    expect(revisions[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(revisions[0].validationFindingsJson).toBeTruthy();
    const findings = JSON.parse(
      revisions[0].validationFindingsJson ?? "{}"
    ) as { validatorVersion?: string };
    expect(findings.validatorVersion).toBe("reply-validator-v2-1");

    // The draft projection references the materialized revision.
    expect(draft.currentRevisionId).toBe(revisions[0].id);
    expect(draft.revisionNumber).toBe(1);
    expect(draft.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // The message projection was bumped inside the same transaction.
    const after = await messageModule.read(messageId);
    expect(after?.replyStatus).toBe("draft_created");
    expect(after?.processedAt).not.toBeNull();

    // The guard row is bound in draft_ready.
    const guardRow = await guardModule.findByReplyKey(
      4252,
      `row:${messageId}`
    );
    expect(guardRow?.phase).toBe("draft_ready");
    expect(guardRow?.activeDraftId).toBe(draft.id);

    // Exactly ONE draft_created audit row, with the B11 correlation metadata.
    const auditModule = new EmailReplyAuditLogModule();
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    const created = records.filter((r) => r.action === "draft_created");
    expect(created).toHaveLength(1);
    const meta = JSON.parse(created[0].metadataJson ?? "{}") as {
      correlationId?: string;
      messageCorrelationId?: string;
      promptVersion?: string;
    };
    expect(meta.correlationId).toBe(result.requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
    expect(meta.promptVersion).toBe("owner-voice-v2");
  });

  it("a throw inside the commit rolls back draft, revision, audit, and guard state (Step 4 rollback)", async () => {
    const messageId = await seedMessage();
    const { factory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    // Install the prototype spy BEFORE the service is constructed:
    // BaseDb.installConnectionGuards copies every async method onto the model
    // instance at construction, closing over the prototype function — a spy
    // installed after construction is shadowed by that instance copy.
    const spy = vi
      .spyOn(EmailReplyDraftModel.prototype, "appendRevisionWithManager")
      .mockImplementation(async () => {
        throw new Error("simulated commit failure");
      });
    const svc = buildService({
      apiFactory: factory,
      guardModuleFactory: () => guardModule,
    });
    try {
      await expect(
        svc.createDraft({ messageId, useKnowledgeLibrary: false })
      ).rejects.toThrow("simulated commit failure");
    } finally {
      spy.mockRestore();
    }

    // NOTHING persisted: no draft, no revision, no audit row.
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(0);
    const auditModule = new EmailReplyAuditLogModule();
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    expect(records.filter((r) => r.action === "draft_created")).toHaveLength(0);

    // The guard was released back to idle (the reservation was released on
    // the failure path), so a retry can acquire.
    const guardRow = await guardModule.findByReplyKey(
      4252,
      `row:${messageId}`
    );
    expect(guardRow?.phase).toBe("idle");
    expect(guardRow?.ownerToken).toBeNull();

    // The message projection was never bumped.
    const after = await messageModule.read(messageId);
    expect(after?.replyStatus).toBe("not_started");
    expect(after?.processedAt).toBeNull();

    // A retry with a clean commit succeeds end to end.
    const retryFactory = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const retry = buildService({
      apiFactory: retryFactory.factory,
      guardModuleFactory: () => guardModule,
    });
    const second = await retry.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    expect(second.success).toBe(true);
  });

  it("fenced commit: an expired owner cannot persist (late output discarded)", async () => {
    const messageId = await seedMessage();
    const gate: { release: (() => void) | null } = { release: null };
    const winnerGate = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const { factory: realFactory } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    const winnerFactory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        // Hold the winner inside its LLM call while we expire its lease.
        await winnerGate;
        return realFactory().openAIChatCompletion(req);
      },
    });
    const winner = buildService({
      apiFactory: winnerFactory,
      guardModuleFactory: () => guardModule,
    });
    const winnerPromise = winner.createDraft({
      messageId,
      useKnowledgeLibrary: false,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    // Expire the winner's lease directly on the guard row while it is held.
    const { SqliteDb, getSqliteTestFallbackDir } = await import(
      "@/config/SqliteDb"
    );
    const connection = SqliteDb.getInstance(
      getSqliteTestFallbackDir()
    ).connection;
    const guardRowBefore = await guardModule.findByReplyKey(
      4252,
      `row:${messageId}`
    );
    expect(guardRowBefore).not.toBeNull();
    await connection
      .getRepository(EmailReplyGuardEntity)
      .update(
        { id: guardRowBefore?.id },
        { leaseExpiresAt: new Date(Date.now() - 1000) }
      );

    if (gate.release) gate.release();
    const result = await winnerPromise;
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("Generation owner expired before commit");

    // No draft persisted (the commit returned fenced before any write).
    const drafts = await draftModule.listByMessage(messageId);
    expect(drafts).toHaveLength(0);

    // The fenced owner's cleanup release still succeeds: releaseReservation is
    // fenced by ownerToken only (no lease condition), so the legitimate owner
    // can always clean up its own stale row — the row returns to idle, and a
    // retry acquires cleanly.
    const guardRow = await guardModule.findByReplyKey(
      4252,
      `row:${messageId}`
    );
    expect(guardRow?.phase).toBe("idle");
    expect(guardRow?.ownerToken).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // R15: reuse re-validates the draft/cluster AFTER the awaited detection and
  // audit work. The reservation's `reusable` verdict is a point-in-time
  // snapshot; while the mailbox probe runs, another request can claim or
  // finalize the draft. The service must return the CURRENT denial state —
  // never the earlier snapshot as an editable reuse.
  // ---------------------------------------------------------------------------
  describe("R15: reuse revalidates after awaited checks", () => {
    it("draft transitioned to sending during detection refuses with reply_in_progress and ONE owned audit", async () => {
      // "defer detector after its local-state check, transition the draft,
      // resume": the probe returns not_replied, but while it was awaited a
      // sibling request claimed the SAME draft for sending.
      const messageId = await seedMessage();
      const draftId = await seedDraft(messageId, "draft");
      const { factory, requests } = fakeApiFactory([
        completionResponse(validReplyJson),
      ]);
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
        onDetect: async () => {
          await draftModule.updateStatus(draftId, "sending");
        },
      });
      const result = await svc.createDraft({ messageId });
      expect(result.success).toBe(false);
      if (result.success) return;
      // The stale snapshot would have been returned as reused:true; the
      // revalidation returns the CURRENT sending state instead.
      expect(result.code).toBe("reply_in_progress");
      expect(result.next_action).toBe("no_action");
      expect(requests).toHaveLength(0);

      // Exactly ONE owned refusal audit decision (stage reuse), and NO reuse
      // decision event — the reuse did not happen.
      const auditModule = new EmailReplyAuditLogModule();
      const { records } = await auditModule.list({
        messageId,
        page: 0,
        size: 50,
      });
      const skipped = records.filter((r) => r.action === "reply_skipped");
      expect(skipped).toHaveLength(1);
      expect(
        JSON.parse(skipped[0].metadataJson ?? "{}")
      ).toMatchObject({ stage: "reuse", code: "reply_in_progress" });
      expect(
        records.filter((r) => r.action === "message_read_by_ai")
      ).toHaveLength(0);

      const counters = drainCountersForTest();
      expect(
        counters.get(
          "guard_conflict{code=reply_in_progress,stage=reuse}"
        )
      ).toBe(1);
    });

    it("draft finalized to sent during detection refuses with already_replied", async () => {
      const messageId = await seedMessage();
      const draftId = await seedDraft(messageId, "draft");
      const { factory, requests } = fakeApiFactory([
        completionResponse(validReplyJson),
      ]);
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
        onDetect: async () => {
          await draftModule.updateStatus(draftId, "sent");
        },
      });
      const result = await svc.createDraft({ messageId });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("already_replied");
      expect(requests).toHaveLength(0);
      const auditModule = new EmailReplyAuditLogModule();
      const { records } = await auditModule.list({
        messageId,
        page: 0,
        size: 50,
      });
      expect(records.filter((r) => r.action === "reply_skipped")).toHaveLength(
        1
      );
      expect(
        records.filter((r) => r.action === "message_read_by_ai")
      ).toHaveLength(0);
    });

    it("delivery_unknown transition during detection refuses with delivery_unknown", async () => {
      // Ambiguous delivery outcome — reuse would risk a duplicate send, so
      // the current state must deny even though the snapshot said `draft`.
      const messageId = await seedMessage();
      const draftId = await seedDraft(messageId, "draft");
      const { factory, requests } = fakeApiFactory([
        completionResponse(validReplyJson),
      ]);
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
        onDetect: async () => {
          await draftModule.updateStatus(draftId, "delivery_unknown");
        },
      });
      const result = await svc.createDraft({ messageId });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("delivery_unknown");
      expect(requests).toHaveLength(0);
      const auditModule = new EmailReplyAuditLogModule();
      const { records } = await auditModule.list({
        messageId,
        page: 0,
        size: 50,
      });
      expect(
        records.filter((r) => r.action === "message_read_by_ai")
      ).toHaveLength(0);
    });

    it("in-flight send attempt on the draft during detection refuses with reply_in_progress", async () => {
      // The sibling path: instead of transitioning the draft, another request
      // inserted a claimed send attempt against it. actingDraftId=null means
      // the attempt DENIES (its own draft's in-flight send is not excluded).
      const messageId = await seedMessage();
      const draftId = await seedDraft(messageId, "approved");
      const { factory, requests } = fakeApiFactory([
        completionResponse(validReplyJson),
      ]);
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
        onDetect: async () => {
          const attempt = new EmailReplySendAttemptEntity();
          attempt.idempotencyKey = `key-${Math.random()}`;
          attempt.draftId = draftId;
          attempt.revisionId = draftId;
          attempt.approvalId = draftId;
          attempt.messageId = messageId;
          attempt.conversationId = null;
          attempt.emailServiceId = 4252;
          attempt.senderAddress = "owner@svc.com";
          attempt.recipientAddress = "person@example.com";
          attempt.status = "claimed";
          attempt.claimedAt = new Date();
          attempt.submittedAt = null;
          attempt.completedAt = null;
          attempt.providerMessageId = null;
          attempt.failureCode = null;
          attempt.sanitizedError = null;
          await attemptModule.create(attempt);
        },
      });
      const result = await svc.createDraft({ messageId });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("reply_in_progress");
      expect(requests).toHaveLength(0);
    });

    it("draft deleted during detection refuses with reply_state_unknown", async () => {
      const messageId = await seedMessage();
      const draftId = await seedDraft(messageId, "draft");
      const { factory, requests } = fakeApiFactory([
        completionResponse(validReplyJson),
      ]);
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
        onDetect: async () => {
          const { SqliteDb, getSqliteTestFallbackDir } = await import(
            "@/config/SqliteDb"
          );
          const connection = SqliteDb.getInstance(
            getSqliteTestFallbackDir()
          ).connection;
          await connection
            .getRepository(EmailReplyDraftEntity)
            .delete({ id: draftId });
        },
      });
      const result = await svc.createDraft({ messageId });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("reply_state_unknown");
      expect(result.next_action).toBe("await_human_review");
      expect(requests).toHaveLength(0);
      const auditModule = new EmailReplyAuditLogModule();
      const { records } = await auditModule.list({
        messageId,
        page: 0,
        size: 50,
      });
      expect(
        records.filter((r) => r.action === "message_read_by_ai")
      ).toHaveLength(0);
    });

    it("clean cluster still reuses after revalidation (happy path intact)", async () => {
      // The revalidation must be a no-op when nothing changed: the existing
      // zero-model-call reuse short-circuit keeps working, including the ONE
      // message_read_by_ai decision event and NO refusal audit.
      const messageId = await seedMessage();
      const draftId = await seedDraft(messageId, "draft");
      const { factory, requests } = fakeApiFactory([
        completionResponse(validReplyJson),
      ]);
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
      });
      const result = await svc.createDraft({ messageId });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.reused).toBe(true);
      expect(result.draftId).toBe(draftId);
      expect(result.subject).toBe("Re: Hi");
      expect(requests).toHaveLength(0);
      const auditModule = new EmailReplyAuditLogModule();
      const { records } = await auditModule.list({
        messageId,
        page: 0,
        size: 50,
      });
      const reuses = records.filter(
        (r) => r.action === "message_read_by_ai"
      );
      expect(reuses).toHaveLength(1);
      expect(
        JSON.parse(reuses[0].metadataJson ?? "{}")
      ).toMatchObject({ stage: "reuse", reusedDraftId: draftId });
      expect(records.filter((r) => r.action === "reply_skipped")).toHaveLength(
        0
      );
      const counters = drainCountersForTest();
      expect(counters.get("reservation_outcome{outcome=reusable}")).toBe(1);
      expect(counters.get("generation_outcome{outcome=reused}")).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // R16: unexpected exceptions must not leak the generation reservation.
  // Every explicit failure path releases and the successful commit clears
  // this.reservation, but an UNEXPECTED exception after acquisition (a
  // profile/database/envelope lookup throw, or a non-transport error escaping
  // the LLM attempt) previously skipped every release — the five-minute
  // lease stayed held and an immediate retry returned generation_in_progress
  // until it expired. The acquired section is now enclosed in an owner-fenced
  // try/finally: the finally releases only the CURRENT owner's still-held
  // reservation (null-swapped first, WHERE id/ownerToken fenced), so a late
  // older owner's cleanup can never release a newer owner's lease.
  // -------------------------------------------------------------------------
  describe("R16: try/finally releases the reservation on unexpected exceptions", () => {
    it("a profile-lookup rejection after acquisition releases the lease so an immediate retry acquires", async () => {
      const messageId = await seedMessage();
      const { factory } = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      // Spy BEFORE buildService: the service's profileModule (and the
      // connection-guard instance copies BaseDb installs at construction)
      // close over the prototype method, so a later spy is shadowed.
      const { EmailReplyIdentityProfileModel } = await import(
        "@/model/EmailReplyIdentityProfile.model"
      );
      const profileSpy = vi
        .spyOn(
          EmailReplyIdentityProfileModel.prototype,
          "getByEmailServiceId"
        )
        .mockRejectedValue(new Error("simulated profile lookup failure"));
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
      });
      try {
        await expect(
          svc.createDraft({ messageId, useKnowledgeLibrary: false })
        ).rejects.toThrow("simulated profile lookup failure");
      } finally {
        profileSpy.mockRestore();
      }

      // WITHOUT advancing the clock, the lease must already be released:
      // the guard row is back to idle with no owner.
      const guardRow = await guardModule.findByReplyKey(
        4252,
        `row:${messageId}`
      );
      expect(guardRow?.phase).toBe("idle");
      expect(guardRow?.ownerToken).toBeNull();

      // The immediate retry (no time advance) acquires and succeeds —
      // pre-R16 this returned generation_in_progress for five minutes.
      const retryFactory = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      const retry = buildService({
        apiFactory: retryFactory.factory,
        guardModuleFactory: () => guardModule,
      });
      const second = await retry.createDraft({
        messageId,
        useKnowledgeLibrary: false,
      });
      expect(second.success).toBe(true);
      const counters = drainCountersForTest();
      expect(counters.get("reservation_outcome{outcome=acquired}")).toBe(2);
      expect(
        counters.get("reservation_outcome{outcome=generation_in_progress}")
      ).toBeUndefined();
    });

    it("an envelope-lookup rejection after generation releases the lease so an immediate retry acquires", async () => {
      const messageId = await seedMessage();
      const { factory } = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      // The envelope binding resolves the email-service row AFTER the LLM
      // attempt (site: new EmailServiceModule().getEmailService(...)). Spy
      // the model's read BEFORE the call so the inline module construction
      // copies the rejected method.
      const { EmailServiceModel } = await import("@/model/EmailService.model");
      const readSpy = vi
        .spyOn(EmailServiceModel.prototype, "read")
        .mockRejectedValue(new Error("simulated envelope lookup failure"));
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
      });
      try {
        await expect(
          svc.createDraft({ messageId, useKnowledgeLibrary: false })
        ).rejects.toThrow();
      } finally {
        readSpy.mockRestore();
      }

      // No draft persisted (the commit was never reached), and the lease was
      // released by the finally — the guard row is idle with no owner.
      const drafts = await draftModule.listByMessage(messageId);
      expect(drafts).toHaveLength(0);
      const guardRow = await guardModule.findByReplyKey(
        4252,
        `row:${messageId}`
      );
      expect(guardRow?.phase).toBe("idle");
      expect(guardRow?.ownerToken).toBeNull();

      // The immediate retry acquires and succeeds without advancing time.
      const retryFactory = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      const retry = buildService({
        apiFactory: retryFactory.factory,
        guardModuleFactory: () => guardModule,
      });
      const second = await retry.createDraft({
        messageId,
        useKnowledgeLibrary: false,
      });
      expect(second.success).toBe(true);
    });

    it("a non-transport error escaping the LLM attempt releases the lease so an immediate retry acquires", async () => {
      const messageId = await seedMessage();
      // attemptLlmGeneration rethrows non-transport errors (a bug or
      // invariant violation in the submission/validator plumbing). Drive one
      // by making the metrics emitter throw DURING the generation attempt —
      // unlike an api.openAIChatCompletion throw, this escapes
      // callLlmRaw's transport wrapper (the throw happens after it returns).
      const metrics = await import("@/service/emailReply/EmailReplyMetrics");
      const metricSpy = vi
        .spyOn(metrics, "incrementReplyMetric")
        .mockImplementation((name: string) => {
          // The generation_outcome{outcome=ok} counter fires exactly once,
          // right when a winning submission is validated inside the attempt.
          if (name === "generation_outcome") {
            throw new Error("simulated non-transport generation failure");
          }
        });
      const { factory, requests } = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      const svc = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
      });
      try {
        await expect(
          svc.createDraft({ messageId, useKnowledgeLibrary: false })
        ).rejects.toThrow("simulated non-transport generation failure");
      } finally {
        metricSpy.mockRestore();
      }
      // The model call DID happen (the exception was after the transport
      // wrapper returned, inside the attempt's validation bookkeeping).
      expect(requests).toHaveLength(1);

      // No draft persisted; the lease was released by the finally.
      const drafts = await draftModule.listByMessage(messageId);
      expect(drafts).toHaveLength(0);
      const guardRow = await guardModule.findByReplyKey(
        4252,
        `row:${messageId}`
      );
      expect(guardRow?.phase).toBe("idle");
      expect(guardRow?.ownerToken).toBeNull();

      // The immediate retry acquires and succeeds without advancing time.
      const retryFactory = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      const retry = buildService({
        apiFactory: retryFactory.factory,
        guardModuleFactory: () => guardModule,
      });
      const second = await retry.createDraft({
        messageId,
        useKnowledgeLibrary: false,
      });
      expect(second.success).toBe(true);
    });

    it("an older owner's cleanup release cannot release a newer owner's lease (fence)", async () => {
      // The R16 finally fences the release on {id, ownerToken}. Simulate the
      // crash-recovery race directly: owner A's invocation crashed leaving a
      // generating row; the sweep/retry reclaimed it and owner B now holds
      // the lease; owner A's delayed finally (or sweep cleanup) then runs
      // releaseReservation with A's STALE token — it must be a no-op for
      // B's row.
      const messageId = await seedMessage();
      const replyKey = `row:${messageId}`;

      // Owner A: acquire through the service, then let its profile lookup
      // throw — its finally releases A's row back to idle (this also proves
      // the finally path end-to-end for a real service-owned token).
      const staleToken = "a".repeat(128);
      const { factory } = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      const { EmailReplyIdentityProfileModel } = await import(
        "@/model/EmailReplyIdentityProfile.model"
      );
      const profileSpy = vi
        .spyOn(
          EmailReplyIdentityProfileModel.prototype,
          "getByEmailServiceId"
        )
        .mockRejectedValue(new Error("simulated crash"));
      const crashed = buildService({
        apiFactory: factory,
        guardModuleFactory: () => guardModule,
      });
      try {
        await expect(
          crashed.createDraft({ messageId, useKnowledgeLibrary: false })
        ).rejects.toThrow("simulated crash");
      } finally {
        profileSpy.mockRestore();
      }
      const afterCrash = await guardModule.findByReplyKey(4252, replyKey);
      expect(afterCrash?.phase).toBe("idle");
      expect(afterCrash?.ownerToken).toBeNull();
      if (!afterCrash) throw new Error("guard row missing after crash");
      const guardId = afterCrash.id;

      // Owner B: a fresh invocation re-acquires the reclaimed row. Its LLM
      // call is gated so its lease is provably live while A's stale cleanup
      // fires.
      const gate: { release: (() => void) | null } = { release: null };
      const bGate = new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      const { factory: realBFactory } = fakeApiFactory([
        completionResponse(validReplyJson, "stop"),
      ]);
      const heldFactory: AiChatApiFactory = () => ({
        openAIChatCompletion: async (req) => {
          await bGate;
          return realBFactory().openAIChatCompletion(req);
        },
      });
      const ownerB = buildService({
        apiFactory: heldFactory,
        guardModuleFactory: () => guardModule,
      });
      const ownerBPromise = ownerB.createDraft({
        messageId,
        useKnowledgeLibrary: false,
      });
      // Wait until B holds the generating lease.
      let bRow: EmailReplyGuardEntity | null = null;
      for (let i = 0; i < 40; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        bRow = await guardModule.findByReplyKey(4252, replyKey);
        if (bRow?.phase === "generating") break;
      }
      expect(bRow?.phase).toBe("generating");
      expect(bRow?.ownerToken).toBeTruthy();
      const newerToken = bRow?.ownerToken ?? "";
      expect(newerToken).not.toBe(staleToken);

      // Owner A's delayed cleanup runs NOW, with its stale token — the
      // fenced release (WHERE id AND ownerToken) matches zero rows and
      // must NOT disturb B's live lease. This is exactly what the R16
      // finally would issue for a resurrected/delayed older owner.
      await guardModule.releaseReservation({
        guardId,
        ownerToken: staleToken,
        now: new Date(),
      });
      const duringB = await guardModule.findByReplyKey(4252, replyKey);
      expect(duringB?.phase).toBe("generating");
      expect(duringB?.ownerToken).toBe(newerToken);

      // Let B finish: it still owns the lease and commits successfully.
      if (gate.release) gate.release();
      const bResult = await ownerBPromise;
      expect(bResult.success).toBe(true);
      const finalRow = await guardModule.findByReplyKey(4252, replyKey);
      expect(finalRow?.phase).toBe("draft_ready");
      expect(finalRow?.activeDraftId).toBe(
        bResult.success ? bResult.draftId : null
      );
    });
  });
});

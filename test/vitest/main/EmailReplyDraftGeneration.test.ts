import { describe, it, expect, vi } from "vitest";
import {
  parseReplyJson,
  validateLlmRawResult,
  LlmTransportError,
  EmailReplyDraftGenerationService,
  type LlmRawResult,
  type AiChatApiFactory,
} from "@/service/emailReply/EmailReplyDraftGenerationService";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
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

describe("validateLlmRawResult (FR-027)", () => {
  it("accepts a valid JSON reply with finish_reason stop", () => {
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "stop",
      returnedModel: "test-model",
      usage: null,
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
    });
    expect(first.ok).toBe(false);
    const second = validateLlmRawResult({
      content: "{also broken",
      finishReason: "stop",
      returnedModel: null,
      usage: null,
    });
    expect(second.ok).toBe(false);
  });
});

describe("callLlmRaw payload + transport-error classification (FR-027)", () => {
  it("sends max_tokens=1500 and response_format json_object", async () => {
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    // Use the service's internal callLlmRaw via a cast to access the private
    // method. The apiFactory seam determines what the call hits.
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(draftId);
    expect(requests).toHaveLength(0);
  });

  it("refuses already_replied with zero LLM calls when replyStatus is sent", async () => {
    const messageId = await seedMessage({ replyStatus: "sent" });
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson),
    ]);
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({
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
    const svc = new EmailReplyDraftGenerationService({
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
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

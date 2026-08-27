import { ensureHostedAiEnabled } from "@/service/AiFeatureGate";
import { AiChatApi } from "@/api/aiChatApi";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyIdentityProfileModule } from "@/modules/EmailReplyIdentityProfileModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailAutoReplyAuditLogModule } from "@/modules/EmailAutoReplyAuditLogModule";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";
import type { EmailMessageClassification } from "@/entityTypes/emailReceiveTypes";
import type {
  AiEmailReplyDraftResult,
  EmailReplyKnowledgeSourceAudit,
} from "@/entityTypes/emailReceiveAiTypes";
import { retrieveReplyKnowledge } from "@/service/emailReply/EmailReplyKnowledgeService";
import {
  buildReplySystemMessage,
  buildReplyUserMessage,
  containsBannedPhrase,
  findPromptLeakage,
  REPLY_PROMPT_VERSION,
} from "@/service/emailReply/EmailReplyPromptBuilder";

const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "interested",
  "not_interested",
  "unsubscribe",
  "bounce",
  "auto_reply",
  "support_request",
  "needs_human_review",
  "unknown",
]);

/** Input to {@link EmailReplyDraftGenerationService.createDraft}. */
export interface CreateDraftInput {
  messageId: number;
  tone?: string;
  goal?: string;
  extraInstructions?: string;
  useKnowledgeLibrary?: boolean;
}

/** Outcome returned to the AI tool / IPC handler. */
export type CreateDraftOutcome =
  | ({ success: true } & AiEmailReplyDraftResult)
  | { success: false; error: string };

/**
 * Knowledge-grounded, owner-voice reply draft generation.
 *
 * Pipeline: AI-enable gate -> load message + identity profile -> retrieve
 * knowledge-library context -> build prompt -> LLM call -> validate output
 * (banned-phrase / leakage / non-empty) -> persist draft + audit rows ->
 * return DTO. Never sends. The email body never includes knowledge source
 * names, scores, or AI-disclosure wording (unless the owner opted in).
 */
export class EmailReplyDraftGenerationService {
  private messageModule = new EmailReceivedMessageModule();
  private draftModule = new EmailReplyDraftModule();
  private profileModule = new EmailReplyIdentityProfileModule();
  private replyAuditModule = new EmailReplyAuditLogModule();
  private autoAuditModule = new EmailAutoReplyAuditLogModule();

  async createDraft(input: CreateDraftInput): Promise<CreateDraftOutcome> {
    // 1. AI-enable gate (CLAUDE.md mandate). Lazy-reconcile once when the
    //    gate is off so a user who just paid is unlocked without a remount.
    if (!(await ensureHostedAiEnabled())) {
      return {
        success: false,
        error: "AI email replies are disabled for this user.",
      };
    }

    // 2. Load message.
    await this.messageModule.ensureConnection();
    const message = await this.messageModule.read(input.messageId);
    if (!message) {
      return { success: false, error: "Message not found" };
    }

    // 3. Load owner-voice profile.
    const profile = await this.profileModule.getByEmailServiceId(
      message.emailServiceId
    );

    // 4. Retrieve knowledge-library context (never throws).
    const knowledge = await retrieveReplyKnowledge({
      subject: message.subject,
      bodyText: message.bodyText,
      fromName: message.fromName,
      goal: input.goal,
      classification: message.classification,
      useKnowledgeLibrary: input.useKnowledgeLibrary ?? true,
    });

    // 5. Build prompt + call LLM.
    const systemMsg = buildReplySystemMessage(profile);
    const userMsg = buildReplyUserMessage({
      message,
      knowledgeSources: knowledge.sources,
      tone: input.tone,
      goal: input.goal,
      extraInstructions: input.extraInstructions,
    });

    let generated: {
      subject: string;
      bodyText: string;
      classification: string;
      confidence: number;
    };
    try {
      generated = await this.callLlm(systemMsg, userMsg);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.recordFailure(
        message.emailServiceId,
        message.id,
        `LLM call failed: ${errMsg}`
      );
      return { success: false, error: errMsg };
    }

    // 6. Validate output.
    const warnings: string[] = [];
    if (knowledge.warning) warnings.push(knowledge.warning);

    const subject = (generated.subject || `Re: ${message.subject}`)
      .trim()
      .slice(0, 998);
    const bodyText = (generated.bodyText || "").trim();
    if (!bodyText) {
      warnings.push("Generated body was empty; draft not persisted.");
      await this.recordFailure(
        message.emailServiceId,
        message.id,
        "Empty generated body"
      );
      return { success: false, error: "Generated reply body was empty" };
    }

    const banned = containsBannedPhrase(bodyText);
    if (banned.found) {
      warnings.push(
        `Banned AI phrase detected and stripped: "${banned.matched}"`
      );
    }
    const leakage = findPromptLeakage(bodyText);
    if (leakage) {
      warnings.push(`Possible prompt leakage detected: "${leakage}"`);
    }

    const classification = VALID_CLASSIFICATIONS.has(generated.classification)
      ? (generated.classification as EmailMessageClassification)
      : "unknown";
    const confidence = clamp(Number(generated.confidence), 0, 1);

    // 7. Persist draft.
    const draft = new EmailReplyDraftEntity();
    draft.messageId = message.id;
    draft.emailServiceId = message.emailServiceId;
    draft.subject = subject;
    draft.bodyText = bodyText;
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    draft.modelName = "openai-compatible";
    draft.promptVersion = REPLY_PROMPT_VERSION;
    draft.confidence = confidence;
    draft.knowledgeSourcesJson = JSON.stringify(knowledge.audits);
    draft.ownerStyleProfileJson = profile
      ? JSON.stringify({
          ownerName: profile.ownerName,
          ownerRole: profile.ownerRole,
          companyName: profile.companyName,
          preferredTone: profile.preferredTone,
          discloseAutomation: profile.discloseAutomation,
        })
      : null;
    draft.warningsJson = JSON.stringify(warnings);
    const savedDraft = await this.draftModule.create(draft);

    // 8. Update message state.
    await this.messageModule.updateReplyStatus(message.id, "draft_created");
    await this.messageModule.updateClassification(
      message.id,
      classification,
      confidence
    );

    // 9. Audit rows.
    await this.writeReplyAudit(
      message.emailServiceId,
      message.id,
      savedDraft.id
    );
    await this.writeAutoAudit({
      emailServiceId: message.emailServiceId,
      messageId: message.id,
      draftId: savedDraft.id,
      classification,
      confidence,
      knowledgeQuery: knowledge.query,
      knowledgeAudits: knowledge.audits,
      generatedSubject: subject,
      generatedBodyPreview: bodyText.slice(0, 400),
      warnings,
    });

    return {
      success: true,
      draftId: savedDraft.id,
      messageId: message.id,
      subject,
      bodyText,
      bodyHtml: null,
      classification,
      knowledgeSources: [...knowledge.sources],
      confidence,
      warnings,
    };
  }

  /** Call the LLM and parse the JSON reply. Overrideable shape for tests. */
  private async callLlm(
    systemMsg: OpenAIChatMessage,
    userMsg: OpenAIChatMessage
  ): Promise<{
    subject: string;
    bodyText: string;
    classification: string;
    confidence: number;
  }> {
    const api = new AiChatApi();
    const resp = await api.openAIChatCompletion({
      messages: [systemMsg, userMsg],
      temperature: 0.4,
      max_tokens: 700,
    });
    const raw = openAIContentToString(resp.choices?.[0]?.message?.content);
    return parseReplyJson(raw);
  }

  private async writeReplyAudit(
    emailServiceId: number,
    messageId: number,
    draftId: number
  ): Promise<void> {
    try {
      const log = new EmailReplyAuditLogEntity();
      log.emailServiceId = emailServiceId;
      log.messageId = messageId;
      log.draftId = draftId;
      log.action = "draft_created";
      log.actor = "ai";
      log.reason = "AI generated knowledge-grounded reply draft";
      await this.replyAuditModule.create(log);
    } catch (e) {
      console.error("Failed to write draft_created audit:", e);
    }
  }

  private async writeAutoAudit(args: {
    emailServiceId: number;
    messageId: number;
    draftId: number;
    classification: EmailMessageClassification;
    confidence: number;
    knowledgeQuery: string;
    knowledgeAudits: readonly EmailReplyKnowledgeSourceAudit[];
    generatedSubject: string;
    generatedBodyPreview: string;
    warnings: string[];
  }): Promise<void> {
    try {
      const log = new EmailAutoReplyAuditLogEntity();
      log.emailServiceId = args.emailServiceId;
      log.messageId = args.messageId;
      log.draftId = args.draftId;
      log.action = "draft_created";
      log.decisionStatus = "draft_created";
      log.classification = args.classification;
      log.confidence = args.confidence;
      log.knowledgeQuery = args.knowledgeQuery || null;
      log.knowledgeSourcesJson = JSON.stringify(
        args.knowledgeAudits.map((a) => ({
          toolName: a.toolName,
          chunkId: a.chunkId,
          documentId: a.documentId,
          documentName: a.documentName,
        }))
      );
      log.generatedSubject = args.generatedSubject;
      log.generatedBodyPreview = args.generatedBodyPreview;
      log.requiresUserApproval = 1; // Phase 1: always require approval before send
      log.approvedByUser = 0;
      log.reason =
        args.warnings.length > 0 ? args.warnings.join("; ") : "draft created";
      await this.autoAuditModule.create(log);
    } catch (e) {
      console.error("Failed to write auto-reply draft audit:", e);
    }
  }

  private async recordFailure(
    emailServiceId: number,
    messageId: number,
    reason: string
  ): Promise<void> {
    try {
      const log = new EmailReplyAuditLogEntity();
      log.emailServiceId = emailServiceId;
      log.messageId = messageId;
      log.action = "send_failed";
      log.actor = "ai";
      log.reason = reason;
      await this.replyAuditModule.create(log);
    } catch (e) {
      console.error("Failed to write failure audit:", e);
    }
  }
}

/** Parse the LLM JSON reply, tolerating stray text / code fences. */
export function parseReplyJson(raw: string): {
  subject: string;
  bodyText: string;
  classification: string;
  confidence: number;
} {
  const fenced = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    // No JSON object found — treat as a failed generation rather than using
    // raw LLM prose (which may contain meta-commentary or fences) as the body.
    return {
      subject: "",
      bodyText: "",
      classification: "unknown",
      confidence: 0,
    };
  }
  try {
    const obj = JSON.parse(fenced.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return {
      subject: typeof obj.subject === "string" ? obj.subject : "",
      bodyText: typeof obj.bodyText === "string" ? obj.bodyText : "",
      classification:
        typeof obj.classification === "string" ? obj.classification : "unknown",
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    };
  } catch {
    // JSON present but malformed — same treatment: do not use raw text as body.
    return {
      subject: "",
      bodyText: "",
      classification: "unknown",
      confidence: 0,
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

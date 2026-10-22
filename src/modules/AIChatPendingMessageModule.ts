import { BaseModule } from "@/modules/baseModule";
import {
  AIChatPendingMessageModel,
  AIChatPendingModelError,
  type AIChatPendingClaimResult,
} from "@/model/AIChatPendingMessage.model";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatAttachmentModule } from "@/modules/AIChatAttachmentModule";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatPendingMessagePreparationService, normalizeChatV2UploadedFiles } from "@/service/AIChatPendingMessagePreparationService";
import type {
  AIChatPendingMessageView,
  AIChatPendingMessageStatus,
  AIChatSafeBoundary,
  ChatV2StreamRequest,
  ChatV2AttachmentMetadata,
  ChatV2MessageMetadata,
  ChatV2RuntimeStatus,
} from "@/entityTypes/aiChatV2Types";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import type { AIChatPendingMessageEntity } from "@/entity/AIChatPendingMessage.entity";
import type {
  OpenAITextContentPart,
  OpenAIImageUrlContentPart,
} from "@/api/aiChatApi";
import crypto from "crypto";

/** Queue resource limits (PRD §13.4 recommended starting values). */
export const AI_CHAT_PENDING_MAX_PER_CONVERSATION = 20;
export const AI_CHAT_PENDING_CONTENT_MAX_CHARS = 32_000;
/**
 * Secondary cap on pasted-text content persisted alongside a queued
 * message (design §8.3). The IPC schema's expanded-total cap (100k) is
 * stricter at the boundary; this is the durable defense-in-depth check.
 */
export const AI_CHAT_PENDING_PASTED_CONTENT_MAX_CHARS = 256_000;

/** Stored turn options — the only request fields the drain may replay. */
interface AIChatPendingRequestOptions {
  readonly mode?: ChatV2StreamRequest["mode"];
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly showReasoning?: boolean;
  readonly reasoning?: ChatV2StreamRequest["reasoning"];
  readonly toolApprovalMode?: ChatV2StreamRequest["toolApprovalMode"];
  /**
   * FR-HIS-002 (capability parity, design §12.11): opaque archive
   * references + the retry-stable submission identity must survive the
   * deferred dispatch — a queued send carries the same selected context an
   * idle send does. The engine re-resolves the ids at turn start.
   */
  readonly historySelectionIds?: readonly string[];
  readonly submissionId?: string;
  /**
   * Codex P1: the user-confirmed generated-image batch rides with the row
   * (normalized, validated at the IPC edge) and the queue STAGES it at
   * dispatch — a receive-time registry entry would be consumed by the
   * running turn or cleared by its terminal before the queued turn runs.
   */
  readonly confirmedBatchReferences?: readonly {
    messageId: string;
    imageIndex: number;
  }[];
}

/** Non-null pending row (the Model's lookups return `| null`). */
type AIChatPendingMessageEntityNonNull = AIChatPendingMessageEntity;

export type AIChatPendingModuleErrorCode =
  | "QUEUE_LIMIT_REACHED"
  | "CONTENT_TOO_LONG"
  | "EMPTY_MESSAGE"
  | "PENDING_NOT_FOUND"
  | "PENDING_NOT_CLAIMABLE"
  | "CONVERSATION_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "ATTACHMENTS_NOT_STEERABLE"
  | "PREPARATION_FAILED";

export class AIChatPendingMessageModuleError extends Error {
  readonly code: AIChatPendingModuleErrorCode;
  constructor(code: AIChatPendingModuleErrorCode, message: string) {
    super(message);
    this.name = "AIChatPendingMessageModuleError";
    this.code = code;
  }
}

function newId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Audit R05: SHA-256 over the full request identity — normalized message
 * text, turn options, reference sets, and the validated attachment list
 * ordered as submitted, hashed BY CONTENT BYTES. Deliberately excludes the
 * preparation outputs (display/model content): staged documents carry
 * nondeterministic refIds, so byte-identical retries of an ambiguous
 * transport must produce the SAME digest even though their content strings
 * differ. Two submissions share a digest iff they are the same logical
 * submission; an attachment byte edit rotates the digest.
 */
export function computeRequestDigestSha256(
  request: ChatV2StreamRequest
): string {
  const hash = crypto.createHash("sha256");
  const feed = (part: string | Buffer): void => {
    hash.update(part);
    hash.update(Buffer.from([0]));
  };

  feed((request.message ?? "").trim().replace(/\r\n/g, "\n"));
  feed(request.model ?? "");
  feed(request.mode ?? "");
  feed(request.toolApprovalMode ?? "");
  feed(request.showReasoning === true ? "1" : "0");
  feed(request.temperature == null ? "" : String(request.temperature));
  feed(request.maxTokens == null ? "" : String(request.maxTokens));
  feed(request.systemPrompt ?? "");

  const files = normalizeChatV2UploadedFiles(request.uploadedFiles ?? []);
  feed(String(files.length));
  for (const file of files) {
    feed(file.fileName);
    feed(file.mimeType);
    feed(String(file.sizeBytes));
    feed(file.kind);
    feed(
      crypto
        .createHash("sha256")
        .update(Buffer.from(file.contentBase64, "base64"))
        .digest()
    );
  }

  const refSets: readonly {
    messageId: string;
    imageIndex: number;
  }[][] = [
    request.generatedImageReferences ?? [],
    request.confirmedGeneratedImageBatch?.references ?? [],
  ];
  for (const refs of refSets) {
    feed(String(refs.length));
    for (const ref of refs) {
      feed(ref.messageId);
      feed(String(ref.imageIndex));
    }
  }

  const historyIds = [...(request.historySelectionIds ?? [])].sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  );
  feed(String(historyIds.length));
  for (const id of historyIds) feed(id);

  const pastes = Object.entries(request.pastedContents ?? {}).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
  );
  feed(String(pastes.length));
  for (const [key, value] of pastes) {
    feed(key);
    feed(value);
  }

  return hash.digest("hex");
}

/** Input for a durable pending create. */
export interface AIChatPendingCreateModuleInput {
  readonly clientRequestId: string;
  readonly request: ChatV2StreamRequest;
  /** Force the paused initial state (queue held / AI unavailable). */
  readonly createAsPaused?: boolean;
  readonly recoveryReason?: string;
}

export interface AIChatPendingCreateModuleResult {
  readonly pendingMessageId: string;
  readonly conversationId: string;
  readonly status: AIChatPendingMessageStatus;
}

/**
 * Business rules for durable pending messages: validation, limits, view
 * sanitization, promotion wrappers, and cleanup (design §5.1 ownership
 * table). IPC handlers call this Module (or the queue Service) — never the
 * Model or a repository directly.
 */
export class AIChatPendingMessageModule extends BaseModule {
  private readonly pendingModel: AIChatPendingMessageModel;
  private readonly v2Module: AIChatV2Module;
  private readonly attachmentModule: AIChatAttachmentModule;
  private readonly preparation: AIChatPendingMessagePreparationService;

  constructor(
    preparationService?: AIChatPendingMessagePreparationService,
    pendingModel?: AIChatPendingMessageModel
  ) {
    super();
    this.pendingModel =
      pendingModel ?? new AIChatPendingMessageModel(this.dbpath);
    this.v2Module = new AIChatV2Module();
    this.attachmentModule = new AIChatAttachmentModule();
    this.preparation =
      preparationService ?? new AIChatPendingMessagePreparationService();
  }

  /**
   * Validate, prepare, and persist one pending message. On any failure after
   * attachment bytes were written, the bytes are removed best-effort so no
   * orphan storage survives a rejected create (design §7.4).
   */
  async createPendingMessage(
    input: AIChatPendingCreateModuleInput
  ): Promise<AIChatPendingCreateModuleResult> {
    await this.ensureConnection();

    const message = (input.request.message ?? "").trim();
    const hasFiles =
      Array.isArray(input.request.uploadedFiles) &&
      input.request.uploadedFiles.length > 0;
    if (!message && !hasFiles) {
      throw new AIChatPendingMessageModuleError(
        "EMPTY_MESSAGE",
        "Message must not be empty."
      );
    }
    if (message.length > AI_CHAT_PENDING_CONTENT_MAX_CHARS) {
      throw new AIChatPendingMessageModuleError(
        "CONTENT_TOO_LONG",
        `Message exceeds the ${AI_CHAT_PENDING_CONTENT_MAX_CHARS} character limit.`
      );
    }
    const pastedTotal = Object.values(
      input.request.pastedContents ?? {}
    ).reduce((sum, value) => sum + value.length, 0);
    if (pastedTotal > AI_CHAT_PENDING_PASTED_CONTENT_MAX_CHARS) {
      throw new AIChatPendingMessageModuleError(
        "CONTENT_TOO_LONG",
        `Pasted content exceeds the ${AI_CHAT_PENDING_PASTED_CONTENT_MAX_CHARS} character limit.`
      );
    }

    const conversationId = this.v2Module.createConversationIfNeeded(
      input.request.conversationId
    );

    // Queue depth cap BEFORE any bytes are written (edge case: reject
    // without clearing the renderer draft — the renderer keeps the draft
    // when the create returns a failure).
    const depth = await this.pendingModel.countNonTerminalByConversation(
      conversationId
    );
    if (depth >= AI_CHAT_PENDING_MAX_PER_CONVERSATION) {
      throw new AIChatPendingMessageModuleError(
        "QUEUE_LIMIT_REACHED",
        `Queue limit reached (${AI_CHAT_PENDING_MAX_PER_CONVERSATION} messages). Remove one before sending again.`
      );
    }

    const pendingMessageId = newId("pending");
    const userMessageId = `user-pending-${pendingMessageId}`;

    let prepared;
    try {
      prepared = await this.preparation.prepare({
        conversationId,
        request: input.request,
      });
    } catch (err) {
      if (err instanceof AIChatPendingMessageModuleError) throw err;
      // Review fix (information disclosure): the typed error's message is
      // surfaced verbatim by userSafeError ("[CODE] <message>") — raw
      // preparation errors (filesystem paths, driver text) must stay in
      // logs, with only static user guidance crossing to the renderer.
      console.error(
        "[ai-chat-pending] message preparation failed:",
        err
      );
      throw new AIChatPendingMessageModuleError(
        "PREPARATION_FAILED",
        "The message could not be prepared for sending. Check attachments and try again."
      );
    }

    // Persist image bytes under the deterministic userMessageId FIRST;
    // if the row insert then fails, remove them (design §7.4).
    let bytesWritten = false;
    try {
      if (prepared.imageAttachments.length > 0) {
        await this.attachmentModule.saveUploadedFiles(
          conversationId,
          userMessageId,
          prepared.imageAttachments.map((f) => ({ ...f }))
        );
        bytesWritten = true;
      }
      const row = await this.pendingModel.create({
        pendingMessageId,
        clientRequestId: input.clientRequestId,
        conversationId,
        userMessageId,
        content: prepared.displayContent,
        modelContent: prepared.modelContent,
        status: input.createAsPaused ? "paused" : "queued",
        requestOptionsJson: JSON.stringify(
          this.extractRequestOptions(input.request)
        ),
        attachmentMetadataJson: prepared.attachmentMetadata
          ? JSON.stringify(prepared.attachmentMetadata)
          : undefined,
        messageMetadataJson: JSON.stringify(prepared.messageMetadata),
        recoveryReason: input.recoveryReason,
        requestDigestSha256: computeRequestDigestSha256(input.request),
      });
      if (row.pendingMessageId !== pendingMessageId) {
        // The idempotency gate resolved to an ALREADY-ACCEPTED attempt
        // (same clientRequestId + same request digest). Drop the bytes and
        // staged files written for this attempt — the existing row owns
        // the accepted ones (audit R05).
        if (bytesWritten) {
          await this.attachmentModule
            .deleteByMessageId(userMessageId)
            .catch(() => undefined);
        }
        await this.preparation
          .cleanupStagedReferences(prepared.stagedRefs)
          .catch(() => undefined);
      }
      return {
        pendingMessageId: row.pendingMessageId,
        conversationId: row.conversationId,
        status: row.status,
      };
    } catch (err) {
      if (bytesWritten) {
        await this.attachmentModule
          .deleteByMessageId(userMessageId)
          .catch(() => undefined);
      }
      await this.preparation
        .cleanupStagedReferences(prepared.stagedRefs)
        .catch(() => undefined);
      if (err instanceof AIChatPendingModelError) {
        throw new AIChatPendingMessageModuleError(
          err.code as AIChatPendingModuleErrorCode,
          err.message
        );
      }
      throw err;
    }
  }

  /** Sanitized views for one conversation (FR-43). */
  async listViews(
    conversationId: string,
    runtimeStatus: ChatV2RuntimeStatus = "idle"
  ): Promise<AIChatPendingMessageView[]> {
    await this.ensureConnection();
    const rows = await this.pendingModel.listByConversation(conversationId);
    return rows.map((row) => this.toView(row, runtimeStatus));
  }

  async getView(
    pendingMessageId: string,
    runtimeStatus: ChatV2RuntimeStatus = "idle"
  ): Promise<AIChatPendingMessageView | null> {
    await this.ensureConnection();
    const row = await this.pendingModel.getByPendingMessageId(pendingMessageId);
    return row ? this.toView(row, runtimeStatus) : null;
  }

  /** Cancel (Remove) one pending message and its staged bytes (FR-44/7.7). */
  async cancelPending(input: {
    readonly conversationId: string;
    readonly pendingMessageId: string;
  }): Promise<AIChatPendingMessageView> {
    await this.ensureConnection();
    const row = await this.pendingModel.getByPendingMessageId(
      input.pendingMessageId
    );
    if (!row) {
      throw new AIChatPendingMessageModuleError(
        "PENDING_NOT_FOUND",
        "Unknown pending message."
      );
    }
    if (row.conversationId !== input.conversationId) {
      throw new AIChatPendingMessageModuleError(
        "CONVERSATION_MISMATCH",
        "Pending message belongs to a different conversation."
      );
    }
    const result = await this.pendingModel.cancelQueued(input.pendingMessageId);
    if (!result.ok) {
      throw new AIChatPendingMessageModuleError(
        "PENDING_NOT_CLAIMABLE",
        "The message is no longer removable."
      );
    }
    await this.attachmentModule
      .deleteByMessageId(row.userMessageId)
      .catch(() => undefined);
    const latest = await this.pendingModel.getByPendingMessageId(
      input.pendingMessageId
    );
    return this.toView(latest ?? row);
  }

  /** Delete pending rows + staged bytes for a conversation (FR-44). */
  async clearConversation(conversationId: string): Promise<number> {
    await this.ensureConnection();
    const rows = await this.pendingModel.listByConversation(conversationId);
    for (const row of rows) {
      if (
        row.status === "cancelled" ||
        row.status === "failed" ||
        row.status === "queued" ||
        row.status === "paused"
      ) {
        await this.attachmentModule
          .deleteByMessageId(row.userMessageId)
          .catch(() => undefined);
      }
    }
    return await this.pendingModel.deleteByConversation(conversationId);
  }

  async recoverOnStartup(): Promise<void> {
    await this.ensureConnection();
    await this.pendingModel.recoverOnStartup();
  }

  // -------------------------------------------------------------------------
  // Queue-service operations (claims + promotion + rebuild)
  // -------------------------------------------------------------------------

  getModel(): AIChatPendingMessageModel {
    return this.pendingModel;
  }

  async claimOldestForDispatch(
    conversationId: string
  ): Promise<AIChatPendingClaimResult> {
    await this.ensureConnection();
    return await this.pendingModel.claimOldestForDispatch(conversationId);
  }

  async claimForSteering(input: {
    readonly pendingMessageId: string;
    readonly conversationId: string;
    readonly targetAssistantMessageId: string;
  }): Promise<AIChatPendingClaimResult> {
    await this.ensureConnection();
    const row = await this.pendingModel.getByPendingMessageId(
      input.pendingMessageId
    );
    if (!row) {
      return { ok: false, code: "PENDING_NOT_FOUND" };
    }
    if (row.conversationId !== input.conversationId) {
      throw new AIChatPendingMessageModuleError(
        "CONVERSATION_MISMATCH",
        "Pending message belongs to a different conversation."
      );
    }
    if (this.parseAttachmentMetadata(row).length > 0) {
      throw new AIChatPendingMessageModuleError(
        "ATTACHMENTS_NOT_STEERABLE",
        "Messages with attachments will send after the current response."
      );
    }
    const meta = this.parseMessageMetadata(row);
    if (
      meta?.generatedImageReferences &&
      meta.generatedImageReferences.length > 0
    ) {
      throw new AIChatPendingMessageModuleError(
        "ATTACHMENTS_NOT_STEERABLE",
        "Messages with attachments will send after the current response."
      );
    }
    return await this.pendingModel.claimForSteering(
      input.pendingMessageId,
      input.targetAssistantMessageId
    );
  }

  async promoteDispatchToUserMessage(input: {
    readonly pendingMessageId: string;
    readonly claimToken: string;
  }): Promise<AIChatMessageEntity> {
    await this.ensureConnection();
    const row = await this.pendingModel.getByPendingMessageId(
      input.pendingMessageId
    );
    const metadata = row ? this.parseMessageMetadata(row) : undefined;
    const saved = await this.pendingModel.promoteDispatchToUserMessage({
      ...input,
      metadata,
    });
    await this.projectUserMessage(saved);
    return saved;
  }

  async promoteSteeringToUserMessage(input: {
    readonly pendingMessageId: string;
    readonly claimToken: string;
    readonly boundary: AIChatSafeBoundary;
    readonly targetAssistantMessageId: string;
  }): Promise<AIChatMessageEntity> {
    await this.ensureConnection();
    const row = await this.pendingModel.getByPendingMessageId(
      input.pendingMessageId
    );
    const base = row ? this.parseMessageMetadata(row) : undefined;
    const metadata: ChatV2MessageMetadata | undefined = base
      ? {
          ...base,
          steering: {
            pendingMessageId: input.pendingMessageId,
            clientRequestId: row?.clientRequestId ?? "",
            targetAssistantMessageId: input.targetAssistantMessageId,
            boundary: input.boundary,
            appliedAt: new Date().toISOString(),
          },
        }
      : undefined;
    const saved = await this.pendingModel.promoteSteeringToUserMessage({
      ...input,
      metadata,
    });
    await this.projectUserMessage(saved);
    return saved;
  }

  /**
   * Conversation-projection coupling (audit R7-04): promote is the durable
   * user moment on the queue/bridge path; mirror the coordinator's
   * recordMessagePersisted-at-accept so the sidebar matches. Promotion is
   * exactly-once (status CAS), so the projection cannot double-count on
   * retries. Best effort — projection failure never fails the turn.
   */
  private async projectUserMessage(saved: AIChatMessageEntity): Promise<void> {
    try {
      await new AIChatConversationModule().recordMessagePersisted({
        conversationId: saved.conversationId,
        isResult: false,
        previewText: saved.content,
        // Generated title derives from the first user content, like the
        // coordinator path.
        generatedTitle: saved.content,
        timestamp: saved.timestamp,
      });
    } catch (err) {
      console.warn(
        "[ai-chat-pending] conversation projection failed for",
        saved.messageId,
        err
      );
    }
  }

  /**
   * Rebuild the trusted turn inputs from a claimed row: the stored request
   * options plus multimodal content parts reconstructed from persisted
   * image BLOBs (design §7.6). Never trusts renderer-supplied replay data.
   */
  async rebuildTurnInputs(row: AIChatPendingMessageEntityNonNull): Promise<{
    readonly request: ChatV2StreamRequest;
    readonly contentParts:
      | Array<OpenAITextContentPart | OpenAIImageUrlContentPart>
      | undefined;
    /**
     * Codex P1: the user-confirmed generated-image batch for THIS row —
     * returned SEPARATELY from the engine request (the strip contract keeps
     * it off the request); the queue stages it into the trusted registry at
     * dispatch time.
     */
    readonly confirmedBatchReferences?: readonly {
      messageId: string;
      imageIndex: number;
    }[];
  }> {
    await this.ensureConnection();
    const options = this.parseRequestOptions(row);
    const request: ChatV2StreamRequest = {
      conversationId: row.conversationId,
      message: row.modelContent,
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      ...(options.maxTokens !== undefined
        ? { maxTokens: options.maxTokens }
        : {}),
      ...(options.systemPrompt !== undefined
        ? { systemPrompt: options.systemPrompt }
        : {}),
      ...(options.showReasoning !== undefined
        ? { showReasoning: options.showReasoning }
        : {}),
      ...(options.reasoning !== undefined
        ? { reasoning: options.reasoning }
        : {}),
      ...(options.toolApprovalMode !== undefined
        ? { toolApprovalMode: options.toolApprovalMode }
        : {}),
      ...(options.historySelectionIds !== undefined &&
      options.historySelectionIds.length > 0
        ? { historySelectionIds: [...options.historySelectionIds] }
        : {}),
      ...(options.submissionId !== undefined
        ? { submissionId: options.submissionId }
        : {}),
    };
    // Codex P1: the confirmed batch is returned SEPARATELY (strip contract:
    // the engine request never carries it); the queue stages it at dispatch.
    const confirmedBatchReferences =
      options.confirmedBatchReferences !== undefined &&
      options.confirmedBatchReferences.length > 0
        ? [...options.confirmedBatchReferences]
        : undefined;
    const images = await this.attachmentModule.getByMessageId(
      row.userMessageId
    );
    let contentParts:
      | Array<OpenAITextContentPart | OpenAIImageUrlContentPart>
      | undefined;
    if (images.length > 0) {
      contentParts = [
        { type: "text", text: row.modelContent },
        ...images.map((image) => ({
          type: "image_url" as const,
          image_url: {
            url: `data:${image.mimeType};base64,${image.contentBlob.toString(
              "base64"
            )}`,
            detail: "auto" as const,
          },
        })),
      ];
    }
    return confirmedBatchReferences
      ? { request, contentParts, confirmedBatchReferences }
      : { request, contentParts };
  }

  // -------------------------------------------------------------------------
  // View mapping / sanitization
  // -------------------------------------------------------------------------

  toView(
    row: NonNullable<
      Awaited<ReturnType<AIChatPendingMessageModel["getByPendingMessageId"]>>
    >,
    runtimeStatus: ChatV2RuntimeStatus = "idle"
  ): AIChatPendingMessageView {
    const attachments = this.parseAttachmentMetadata(row);
    // D01 (audit 2026-10-21-r3): trusted generated-image reference rows ship
    // the reference channel only on a normal dispatch — steering would drop
    // it, so they are exactly as unsteerable as attachment rows.
    const hasGeneratedImageReferences =
      (this.parseMessageMetadata(row)?.generatedImageReferences?.length ??
        0) > 0;
    return {
      pendingMessageId: row.pendingMessageId,
      conversationId: row.conversationId,
      clientRequestId: row.clientRequestId,
      sequence: row.id,
      content: row.content,
      status: row.status,
      createdAt: this.toIso(row.createdAt),
      updatedAt: this.toIso(row.updatedAt),
      attachmentMetadata: attachments.length > 0 ? attachments : undefined,
      canSteer:
        row.status === "queued" &&
        attachments.length === 0 &&
        !hasGeneratedImageReferences &&
        runtimeStatus === "running",
      steeringBoundary: row.steeringBoundary,
      activeAssistantMessageId: row.targetAssistantMessageId,
      sentMessageId: row.sentMessageId,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      recoveryReason: row.recoveryReason,
    };
  }

  private toIso(value: Date | undefined): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return new Date(value).toISOString();
    return new Date(0).toISOString();
  }

  private parseAttachmentMetadata(
    row: NonNullable<
      Awaited<ReturnType<AIChatPendingMessageModel["getByPendingMessageId"]>>
    >
  ): ChatV2AttachmentMetadata[] {
    if (!row.attachmentMetadataJson) return [];
    try {
      const parsed = JSON.parse(
        row.attachmentMetadataJson
      ) as ChatV2AttachmentMetadata[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private parseMessageMetadata(
    row: NonNullable<
      Awaited<ReturnType<AIChatPendingMessageModel["getByPendingMessageId"]>>
    >
  ): ChatV2MessageMetadata | undefined {
    if (!row.messageMetadataJson) return undefined;
    try {
      const parsed = JSON.parse(
        row.messageMetadataJson
      ) as ChatV2MessageMetadata;
      if (parsed && typeof parsed === "object") {
        return { ...parsed, source: "chat-v2" };
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  private parseRequestOptions(
    row: NonNullable<
      Awaited<ReturnType<AIChatPendingMessageModel["getByPendingMessageId"]>>
    >
  ): AIChatPendingRequestOptions {
    if (!row.requestOptionsJson) return {};
    try {
      const parsed = JSON.parse(
        row.requestOptionsJson
      ) as AIChatPendingRequestOptions;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore
    }
    return {};
  }

  private extractRequestOptions(
    request: ChatV2StreamRequest
  ): AIChatPendingRequestOptions {
    return {
      ...(request.mode !== undefined ? { mode: request.mode } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens !== undefined
        ? { maxTokens: request.maxTokens }
        : {}),
      ...(request.systemPrompt !== undefined
        ? { systemPrompt: request.systemPrompt }
        : {}),
      ...(request.showReasoning !== undefined
        ? { showReasoning: request.showReasoning }
        : {}),
      ...(request.reasoning !== undefined
        ? { reasoning: request.reasoning }
        : {}),
      ...(request.toolApprovalMode !== undefined
        ? { toolApprovalMode: request.toolApprovalMode }
        : {}),
      ...(request.historySelectionIds !== undefined &&
      request.historySelectionIds.length > 0
        ? { historySelectionIds: [...request.historySelectionIds] }
        : {}),
      ...(request.submissionId !== undefined
        ? { submissionId: request.submissionId }
        : {}),
      ...(request.confirmedGeneratedImageBatch?.references
        ? {
            confirmedBatchReferences: [
              ...request.confirmedGeneratedImageBatch.references,
            ],
          }
        : {}),
    };
  }
}

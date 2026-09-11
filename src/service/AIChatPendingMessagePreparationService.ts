import {
  DocumentService,
  type StagedAttachmentReference,
} from "@/service/DocumentService";
import {
  GeneratedImageReferenceError,
  type GeneratedImageReferenceErrorCode,
} from "@/entityTypes/generatedImageReferenceTypes";
import { GeneratedImageReferenceService } from "@/service/GeneratedImageReferenceService";
import { PastedTextResolutionService } from "@/service/pastedText/PastedTextResolutionService";
import { AtMentionResolutionService } from "@/service/aiChatAtMentions/AtMentionResolutionService";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import type {
  ChatV2StreamRequest,
  ChatV2AttachmentMetadata,
  ChatV2MessageMetadata,
  ChatV2UploadedAttachment,
} from "@/entityTypes/aiChatV2Types";
import type { UploadedFileForPersistence } from "@/model/AIChatAttachment.model";
import type {
  OpenAITextContentPart,
  OpenAIImageUrlContentPart,
} from "@/api/aiChatApi";

/**
 * Send-time preparation for pending (queued) messages — the extraction of
 * the preparation stage that used to live inline in
 * `AIChatQueryEngine.submitMessage` (message-queue technical design §7.4).
 *
 * At enqueue time this service:
 *  1. normalizes and validates attachments (same rules the stream IPC used);
 *  2. stages document markdown and captures durable staged references;
 *  3. resolves generated-image edit references into image bytes;
 *  4. resolves pasted-text placeholders and @-mentions;
 *  5. returns display/model content plus the image bytes to persist under
 *     the pending message's deterministic userMessageId.
 *
 * Dispatch never re-resolves mentions or pasted text, so a queued
 * instruction cannot silently change meaning while it waits.
 */

const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;

/**
 * MIME types accepted for `kind === "image"` attachments. The persisted
 * `previewDataUrl` is a `data:${mimeType};base64,...` URL rendered in the
 * renderer DOM, so the MIME must be a real image type (mirrors the former
 * inline list in ai-chat-v2-ipc.ts).
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export class AIChatPendingAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIChatPendingAttachmentValidationError";
  }
}

export class AIChatPendingGeneratedImageError extends Error {
  readonly code: GeneratedImageReferenceErrorCode;
  constructor(code: GeneratedImageReferenceErrorCode, message: string) {
    super(message);
    this.name = "AIChatPendingGeneratedImageError";
    this.code = code;
  }
}

function classifyAttachment(
  fileName: string,
  mimeType: string
): "document" | "image" | null {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))
    return "image";
  if (name.endsWith(".webp") || name.endsWith(".gif")) return "image";

  if (mime === "application/pdf" || name.endsWith(".pdf")) return "document";
  if (
    mime === "text/csv" ||
    mime === "application/csv" ||
    name.endsWith(".csv")
  )
    return "document";
  if (name.endsWith(".docx") || mime.includes("wordprocessingml.document"))
    return "document";
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    mime.includes("spreadsheetml.sheet")
  )
    return "document";

  return null;
}

/**
 * Normalize untrusted renderer-supplied uploaded files. Rejected items are
 * silently dropped (same contract as the stream IPC path).
 */
export function normalizeChatV2UploadedFiles(
  input: unknown
): ChatV2UploadedAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ChatV2UploadedAttachment[] = [];
  let totalImageBase64Bytes = 0;

  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    const fileName =
      typeof (item as Record<string, unknown>).fileName === "string"
        ? ((item as Record<string, unknown>).fileName as string)
        : "";
    const mimeType =
      typeof (item as Record<string, unknown>).mimeType === "string"
        ? ((item as Record<string, unknown>).mimeType as string)
        : "";
    const sizeBytes =
      typeof (item as Record<string, unknown>).sizeBytes === "number"
        ? ((item as Record<string, unknown>).sizeBytes as number)
        : 0;
    const contentBase64 =
      typeof (item as Record<string, unknown>).contentBase64 === "string"
        ? ((item as Record<string, unknown>).contentBase64 as string)
        : "";
    const kind =
      typeof (item as Record<string, unknown>).kind === "string"
        ? ((item as Record<string, unknown>).kind as string)
        : "";

    if (!fileName || !contentBase64) continue;

    const detectedKind = classifyAttachment(fileName, mimeType);
    if (!detectedKind) continue;
    if (kind !== "document" && kind !== "image") continue;
    if (kind !== detectedKind) continue;

    if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_FILE_BYTES) continue;
    try {
      const decodedLen = Buffer.from(contentBase64, "base64").length;
      if (decodedLen !== sizeBytes) continue;
    } catch {
      continue;
    }

    if (kind === "image") {
      const normalizedMime = mimeType.toLowerCase();
      if (
        !ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime) ||
        /[\s\r\n]/.test(mimeType)
      ) {
        continue;
      }
      totalImageBase64Bytes += contentBase64.length;
      if (totalImageBase64Bytes > MAX_TOTAL_IMAGE_BASE64_BYTES) continue;
    }

    out.push({
      fileName,
      mimeType,
      sizeBytes,
      contentBase64,
      kind: kind as "document" | "image",
    });
  }

  return out;
}

/** Prepared outputs the pending Module persists / the drain later uses. */
export interface AIChatPendingPreparedContent {
  /** Display text saved on the future user row (attachment-enriched). */
  readonly displayContent: string;
  /** Model-facing text (pastes + mentions resolved at send time). */
  readonly modelContent: string;
  /** Bubble attachment chips for uploaded files only. */
  readonly attachmentMetadata: ChatV2AttachmentMetadata[] | undefined;
  /** User-row metadata (attachments, mentions, pastes, generated refs). */
  readonly messageMetadata: ChatV2MessageMetadata;
  /**
   * Image bytes to persist under the deterministic userMessageId: uploaded
   * images first, then resolved generated-image edit inputs. Dispatch
   * rebuilds the multimodal content parts from these trusted BLOBs.
   */
  readonly imageAttachments: readonly UploadedFileForPersistence[];
}

export class AIChatPendingMessagePreparationService {
  constructor(
    private readonly generatedImageResolver: Pick<
      GeneratedImageReferenceService,
      "resolveGeneratedImages"
    > = new GeneratedImageReferenceService()
  ) {}

  /**
   * Prepare one pending message. Throws on validation failure BEFORE any
   * pending row or attachment byte is accepted (design §7.4).
   */
  async prepare(input: {
    readonly conversationId: string;
    readonly request: ChatV2StreamRequest;
  }): Promise<AIChatPendingPreparedContent> {
    const { conversationId, request } = input;
    const uploadedFiles = normalizeChatV2UploadedFiles(request.uploadedFiles);

    // 1. Stage documents (markdown on disk, refIds for the model).
    const docFiles = uploadedFiles.filter((f) => f.kind === "document");
    const stagedRefs: StagedAttachmentReference[] =
      docFiles.length > 0
        ? await this.stageDocumentMarkdowns(docFiles, conversationId)
        : [];

    // 2. Build the enriched display message + attachment chips.
    const attachmentMetadata: ChatV2AttachmentMetadata[] = [];
    const imageAttachments: UploadedFileForPersistence[] = [];
    const stagedFileNames = new Set(stagedRefs.map((r) => r.fileName));

    for (const file of uploadedFiles) {
      if (file.kind === "image") {
        const dataUrl = `data:${file.mimeType};base64,${file.contentBase64}`;
        attachmentMetadata.push({
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          kind: "image",
          processingMode: "image_url",
          previewDataUrl: dataUrl,
        });
        imageAttachments.push({
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          contentBase64: file.contentBase64,
        });
      } else if (stagedFileNames.has(file.fileName)) {
        attachmentMetadata.push({
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          kind: "document",
          processingMode: "staged_markdown",
        });
      }
      // Documents that failed staging are skipped (same as engine path).
    }

    let displayContent = request.message || "";
    if (stagedRefs.length > 0) {
      const enrichLines = [
        "",
        `Attached ${stagedRefs.length} file(s) are staged locally and available below.`,
        "A `read_attachment_content` tool is available to load their contents.",
        ...stagedRefs.map(
          (ref, i) =>
            `${i + 1}. file_name="${ref.fileName}" attachment_ref="${
              ref.refId
            }" file_path="${
              ref.filePath
            }" → call \`read_attachment_content\` with attachment_ref="${
              ref.refId
            }" to load this file. For local shell tools, use file_path to access the file directly on disk.`
        ),
      ];
      displayContent = displayContent
        ? `${displayContent}\n\n${enrichLines.join("\n")}`
        : enrichLines.join("\n");
    }

    // 3. Resolve pasted-text placeholders, then @-mentions.
    const pastedTextResolution =
      await new PastedTextResolutionService().resolveMessage(
        displayContent,
        request.pastedContents
      );
    const atMentionResolution =
      await new AtMentionResolutionService().resolveMessage(
        conversationId,
        pastedTextResolution.modelMessage
      );
    let modelContent = atMentionResolution.modelMessage;

    // 4. Resolve generated-image edit references into durable image bytes.
    let generatedRefMetadata: ChatV2MessageMetadata["generatedImageReferences"] =
      undefined;
    if (
      request.generatedImageReferences &&
      request.generatedImageReferences.length > 0
    ) {
      const uploadedImageCount = imageAttachments.length;
      let resolved: Awaited<
        ReturnType<GeneratedImageReferenceService["resolveGeneratedImages"]>
      >;
      try {
        resolved = await this.generatedImageResolver.resolveGeneratedImages({
          conversationId,
          references: request.generatedImageReferences,
          detail: "auto",
        });
      } catch (err: unknown) {
        if (err instanceof GeneratedImageReferenceError) {
          throw new AIChatPendingGeneratedImageError(err.code, err.message);
        }
        throw err;
      }
      if (
        uploadedImageCount + resolved.artifacts.length >
        CHAT_IMAGE_LIMITS.maxImagesPerRequest
      ) {
        throw new AIChatPendingGeneratedImageError(
          "generated_image_reference_limit",
          "Too many images attached to this request."
        );
      }
      for (let i = 0; i < resolved.artifacts.length; i += 1) {
        const artifact = resolved.artifacts[i];
        const meta = resolved.metadata[i];
        const dataUrl = artifact.dataUrl;
        const commaIndex = dataUrl.indexOf(",");
        const mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl);
        const contentBase64 = dataUrl.slice(commaIndex + 1);
        imageAttachments.push({
          fileName: meta.fileName ?? `generated-image-${meta.imageIndex}.png`,
          mimeType: mimeMatch?.[1] ?? "image/png",
          sizeBytes: Buffer.from(contentBase64, "base64").length,
          contentBase64,
        });
      }
      if (modelContent.trim().length === 0) {
        modelContent = "Describe the selected image.";
        if (displayContent.trim().length === 0) {
          displayContent = modelContent;
        }
      }
      generatedRefMetadata = [...resolved.metadata];
    }

    // 5. Assemble the persisted user-row metadata.
    const messageMetadata: ChatV2MessageMetadata = {
      source: "chat-v2",
      ...(attachmentMetadata.length > 0
        ? { attachments: attachmentMetadata }
        : {}),
      ...(atMentionResolution.metadata.length > 0
        ? { atMentions: atMentionResolution.metadata }
        : {}),
      ...(pastedTextResolution.pastedBlocks.length > 0
        ? { pastedBlocks: pastedTextResolution.pastedBlocks }
        : {}),
      ...(generatedRefMetadata
        ? { generatedImageReferences: generatedRefMetadata }
        : {}),
    };

    return {
      displayContent,
      modelContent,
      attachmentMetadata:
        attachmentMetadata.length > 0 ? attachmentMetadata : undefined,
      messageMetadata,
      imageAttachments,
    };
  }

  /** Convert small documents to markdown and stage them on disk. */
  private async stageDocumentMarkdowns(
    files: ChatV2UploadedAttachment[],
    conversationId: string
  ): Promise<StagedAttachmentReference[]> {
    const docService = new DocumentService();
    const SMALL_DOC_THRESHOLD = 1 * 1024 * 1024;
    const staged: StagedAttachmentReference[] = [];

    for (const file of files) {
      if (file.sizeBytes > SMALL_DOC_THRESHOLD) {
        continue;
      }
      try {
        const markdown = await docService.convertUploadedAttachmentToMarkdown(
          file.fileName,
          file.mimeType,
          file.contentBase64
        );
        const ref = await docService.stageAttachmentMarkdown(
          conversationId,
          file.fileName,
          markdown,
          { originalContentBase64: file.contentBase64 }
        );
        staged.push(ref);
      } catch {
        // Staging failure for one file must not reject the whole message —
        // the document is skipped from enrichment (same as engine path).
      }
    }
    return staged;
  }
}

/** Re-export so the drain can rebuild multimodal content parts. */
export type PendingContentParts = Array<
  OpenAITextContentPart | OpenAIImageUrlContentPart
>;

/**
 * Shared helper for staging chat document attachments and injecting
 * `attachment_ref` blocks into the user message.
 *
 * Used by the AiChatV2 stream path. Mirrors the legacy v1 logic in
 * ai-chat-ipc.ts but additionally preserves the original file bytes
 * (`originalContentBase64`) so attachments can be imported into the knowledge
 * library via `knowledge_library_import_attachment`.
 *
 * See:
 *   docs/prd/knowledge-library-management-ai-tools-prd.md (FR4)
 *   docs/prd/ai-chat-v2-attachment-upload-prd.md
 */

import * as crypto from "crypto";
import { SkillRegistry } from "@/config/skillsRegistry";
import {
  DocumentService,
  StagedAttachmentReference,
} from "@/service/DocumentService";
import type { ChatV2UploadedAttachment } from "@/entityTypes/aiChatV2Types";

/** Max decoded size of a single chat attachment (matches the v1 limit). */
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_UPLOAD_FILE_BYTES * 4) / 3) + 16;

/**
 * Document file types that can be converted to markdown and staged. Must stay
 * aligned with `DocumentService.convertUploadedAttachmentToMarkdown`.
 */
function isStagedDocumentAttachmentSupported(
  fileName: string,
  mimeType: string
): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith("image/")) {
    return false;
  }
  return (
    lowerMime === "application/pdf" ||
    lowerName.endsWith(".pdf") ||
    lowerMime === "text/csv" ||
    lowerMime === "application/csv" ||
    lowerName.endsWith(".csv") ||
    lowerMime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx") ||
    lowerMime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lowerMime === "application/vnd.ms-excel" ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls")
  );
}

/**
 * Validate and normalize raw renderer-supplied attachment payloads into a clean
 * list of supported document attachments. Unsupported types and oversized
 * files are silently dropped (with a warning), matching the v1 behavior.
 */
export function normalizeChatV2Attachments(
  input: unknown
): ChatV2UploadedAttachment[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const result: ChatV2UploadedAttachment[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const fileName = rec.fileName;
    const mimeType = rec.mimeType;
    const sizeBytes = rec.sizeBytes;
    const contentBase64 = rec.contentBase64;

    if (typeof fileName !== "string") continue;
    if (typeof mimeType !== "string") continue;
    if (typeof contentBase64 !== "string") continue;
    if (contentBase64.length > MAX_BASE64_LENGTH) {
      console.warn(
        `normalizeChatV2Attachments: skipping "${fileName}" — base64 length exceeds limit`
      );
      continue;
    }
    if (!isStagedDocumentAttachmentSupported(fileName, mimeType)) {
      continue;
    }

    const decodedByteLength = Buffer.byteLength(contentBase64, "base64");
    if (decodedByteLength > MAX_UPLOAD_FILE_BYTES) {
      console.warn(
        `normalizeChatV2Attachments: skipping "${fileName}" — decoded size exceeds limit`
      );
      continue;
    }

    result.push({
      fileName,
      mimeType,
      sizeBytes:
        typeof sizeBytes === "number" && Number.isFinite(sizeBytes)
          ? sizeBytes
          : decodedByteLength,
      contentBase64,
    });
  }

  return result;
}

export interface StageChatAttachmentsResult {
  /** The original message with the attachment reference block appended. */
  message: string;
  /** The staged attachment references (empty when nothing was staged). */
  references: StagedAttachmentReference[];
}

/**
 * Build the machine-readable instruction block appended to the user message.
 * Names both the read and import tools so the model knows what it can do with
 * each `attachment_ref`.
 */
function buildAttachmentReferenceBlock(
  references: StagedAttachmentReference[]
): string {
  const sanitizeForPrompt = (value: string): string =>
    value.replace(/[\r\n]/g, " ").replace(/"/g, '\\"');

  const lines = references.map(
    (ref, index) =>
      `${index + 1}. file_name="${sanitizeForPrompt(
        ref.fileName
      )}" attachment_ref="${ref.refId}"`
  );

  return [
    "",
    "Attached documents are staged locally.",
    "Use `read_attachment_content` with attachment_ref to inspect a document's content.",
    "Use `knowledge_library_import_attachment` with attachment_ref to save a document into the knowledge library.",
    ...lines,
  ].join("\n");
}

/**
 * Convert and stage each document attachment under the conversation directory,
 * preserving original bytes, then return the augmented user message.
 *
 * Staging uses the final `conversationId` (never "pending") so that
 * `attachment_ref` values resolve correctly later via
 * `SkillExecutionContext.conversationId`.
 */
export async function stageChatV2AttachmentsForMessage(input: {
  conversationId: string;
  message: string;
  attachments: readonly ChatV2UploadedAttachment[];
}): Promise<StageChatAttachmentsResult> {
  const { conversationId, message, attachments } = input;
  if (!attachments || attachments.length === 0) {
    return { message, references: [] };
  }

  const documentService = new DocumentService();
  const references: StagedAttachmentReference[] = [];

  for (const file of attachments) {
    if (file.mimeType.toLowerCase().startsWith("image/")) {
      continue;
    }

    const markdown = await documentService.convertUploadedAttachmentToMarkdown(
      file.fileName,
      file.mimeType,
      file.contentBase64
    );

    const originalBuffer = Buffer.from(file.contentBase64, "base64");
    const sha256 = crypto
      .createHash("sha256")
      .update(originalBuffer)
      .digest("hex");

    const staged = await documentService.stageAttachmentMarkdown(
      conversationId,
      file.fileName,
      markdown,
      {
        attachmentSha256: sha256,
        // Preserve the original bytes so the import tool can re-upload the
        // real file (not just the converted markdown).
        originalContentBase64: file.contentBase64,
      }
    );
    references.push(staged);
  }

  if (references.length === 0) {
    return { message, references: [] };
  }

  // Touch the registry so supported-extension skills remain discoverable for
  // other tools; the import/read tools are advertised in the block text.
  for (const ref of references) {
    const ext = ref.fileName
      .toLowerCase()
      .slice(ref.fileName.lastIndexOf("."));
    if (ext) {
      await SkillRegistry.findSkillForFileExtension(ext);
    }
  }

  return {
    message: `${message}${buildAttachmentReferenceBlock(references)}`,
    references,
  };
}

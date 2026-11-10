/**
 * Attachment processing — extracted from AiChatV2.vue (R6.3 god-component split).
 * buildUploadedAttachments + the upload size limit. Pure functions (no component state).
 */
import type { ChatV2UploadedAttachment } from "@/entityTypes/aiChatV2Types";
import { classifyAttachment, resolveMimeType } from "./aiChatV2Utils";
import { downscaleImageAttachment, arrayBufferToBase64 } from "./imageScaleUtil";

export const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;

export async function buildUploadedAttachments(
  files: File[]
): Promise<ChatV2UploadedAttachment[]> {
  const out: ChatV2UploadedAttachment[] = [];
  for (const file of files) {
    const kind = classifyAttachment(file.name, file.type);
    if (!kind) throw new Error(`Unsupported file type: ${file.name}`);
    if (file.size > MAX_UPLOAD_FILE_BYTES)
      throw new Error(`File too large: ${file.name}`);

    if (kind === "image") {
      const processed = await downscaleImageAttachment(file);
      out.push({
        fileName: file.name,
        mimeType: processed.mimeType,
        sizeBytes: processed.sizeBytes,
        contentBase64: processed.contentBase64,
        kind,
      });
    } else {
      const buffer = await file.arrayBuffer();
      out.push({
        fileName: file.name,
        mimeType: resolveMimeType(file),
        sizeBytes: file.size,
        contentBase64: arrayBufferToBase64(buffer),
        kind,
      });
    }
  }
  return out;
}

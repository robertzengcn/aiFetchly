/**
 * Pure utility functions extracted from AiChatV2.vue (R5.6/R6.3 god-component split).
 * These functions have no component reactive state — only params → return value.
 */
import type { ChatV2AttachmentKind } from "@/entityTypes/aiChatV2Types";

/** Classify a file by name + MIME type into an attachment kind (image/document/null). */
export function classifyAttachment(
  fileName: string,
  mimeType: string
): ChatV2AttachmentKind | null {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))
    return "image";
  if (name.endsWith(".webp") || name.endsWith(".gif")) return "image";

  if (mime === "application/pdf" || name.endsWith(".pdf")) return "document";
  if (mime === "text/csv" || mime === "application/csv" || name.endsWith(".csv"))
    return "document";
  if (
    name.endsWith(".docx") ||
    mime.includes("wordprocessingml.document")
  )
    return "document";
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    mime.includes("spreadsheetml.sheet")
  )
    return "document";

  return null;
}

/** Generate a default prompt for a set of attachment files. */
export function defaultPromptForAttachments(files: File[]): string {
  const images = files.filter(
    (f) => classifyAttachment(f.name, f.type) === "image"
  );
  if (
    images.length > 0 &&
    files.every((f) => classifyAttachment(f.name, f.type) === "image")
  ) {
    return "What is in this image?";
  }
  return "";
}

/** Resolve the MIME type for a file, inferring from extension when unknown. */
export function resolveMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (name.endsWith(".xls")) return "application/vnd.ms-excel";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return file.type || "application/octet-stream";
}

/** Truncate text to max characters, appending an ellipsis. */
export function truncateText(
  text: string | undefined,
  max: number
): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

/** Format an ISO timestamp as a localized string. */
export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

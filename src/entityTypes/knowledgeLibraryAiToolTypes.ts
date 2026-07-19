/**
 * Shared types and zod input schemas for the Knowledge Library management AI
 * tools.
 *
 * These tools let the AI assistant list, import, and delete documents in the
 * local RAG-backed knowledge library. All shapes returned to the model are
 * deliberately compact: they never expose raw local file paths, vector index
 * paths, or full document content.
 *
 * Following the established AI-tools convention (scheduleAiToolTypes.ts,
 * emailMarketingAiTypes.ts), the zod input schemas live alongside the types
 * here and are used by the service layer to parse raw LLM tool arguments.
 *
 * See:
 *   docs/prd/knowledge-library-management-ai-tools-prd.md
 *   docs/prd/knowledge-library-management-ai-tools-technical-design.md
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// zod input schemas (parse raw LLM args before any file or DB work)
// ---------------------------------------------------------------------------

const tagSchema = z.string().trim().min(1).max(80);

/**
 * Input schema for `knowledge_library_list_documents`.
 *
 * `limit` is clamped to a maximum of 50 so tool results never bloat the
 * conversation. `fileType` is normalized to start with a dot (".pdf").
 */
export const listKnowledgeDocumentsInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  processingStatus: z.string().trim().min(1).max(40).optional(),
  fileType: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => (value.startsWith(".") ? value : `.${value}`))
    .optional(),
  tags: z.array(tagSchema).max(20).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(10000).default(0),
});

/**
 * Input schema for `knowledge_library_import_attachment`.
 *
 * Only `attachment_ref` is accepted — never a raw file path. The reference is
 * constrained to the same `[a-zA-Z0-9-]` shape produced by
 * `DocumentService.stageAttachmentMarkdown`.
 */
export const importKnowledgeAttachmentInputSchema = z.object({
  attachment_ref: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9-]+$/)
    .min(1)
    .max(120),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  author: z.string().trim().min(1).max(200).optional(),
  duplicatePolicy: z.enum(["fail", "allow", "replace"]).default("fail"),
});

/** Input schema for `knowledge_library_delete_document`. */
export const deleteKnowledgeDocumentInputSchema = z.object({
  document_id: z.number().int().positive(),
  delete_source_file: z.boolean().default(false),
  expected_name: z.string().trim().min(1).max(300).optional(),
});

/** Parsed input types (after zod applies defaults/transforms). */
export type ListKnowledgeDocumentsParsed = z.infer<
  typeof listKnowledgeDocumentsInputSchema
>;
export type ImportKnowledgeAttachmentParsed = z.infer<
  typeof importKnowledgeAttachmentInputSchema
>;
export type DeleteKnowledgeDocumentParsed = z.infer<
  typeof deleteKnowledgeDocumentInputSchema
>;

// ---------------------------------------------------------------------------
// Result / error types
// ---------------------------------------------------------------------------

/** Structured error codes that knowledge library tools can return to the model. */
export type KnowledgeLibraryToolErrorCode =
  | "INVALID_INPUT"
  | "AI_DISABLED"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_EXPIRED"
  | "ATTACHMENT_SOURCE_MISSING"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "DUPLICATE_DOCUMENT"
  | "DOCUMENT_NOT_FOUND"
  | "EXPECTED_NAME_MISMATCH"
  | "IMPORT_FAILED"
  | "DELETE_FAILED"
  | "LIST_FAILED";

/**
 * Failure payload shared by every knowledge library tool.
 *
 * `existingDocuments` is populated only for `DUPLICATE_DOCUMENT` so the model
 * can show the user which documents already match.
 */
export interface KnowledgeLibraryToolError {
  readonly success: false;
  readonly code: KnowledgeLibraryToolErrorCode;
  readonly error: string;
  readonly existingDocuments?: readonly KnowledgeLibraryDocumentSummary[];
}

/**
 * Compact, model-facing document summary. Excludes `filePath`,
 * `vectorIndexPath`, and any document content.
 */
export interface KnowledgeLibraryDocumentSummary {
  readonly id: number;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly author?: string;
  readonly fileType: string;
  readonly fileSize: number;
  readonly status: string;
  readonly processingStatus?: string;
  readonly uploadedAt?: string;
}

// ---------------------------------------------------------------------------
// list_documents
// ---------------------------------------------------------------------------

export interface ListKnowledgeDocumentsInput {
  readonly query?: string;
  readonly status?: string;
  readonly processingStatus?: string;
  readonly fileType?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListKnowledgeDocumentsResult {
  readonly success: true;
  readonly documents: readonly KnowledgeLibraryDocumentSummary[];
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  /**
   * True when the underlying scan hit its cap, meaning more documents may exist
   * beyond what was scanned. The model should narrow with query/filters rather
   * than conclude the library is empty.
   */
  readonly truncated?: boolean;
}

// ---------------------------------------------------------------------------
// import_attachment
// ---------------------------------------------------------------------------

/**
 * Duplicate handling policy for import.
 *
 * - `fail`    -> refuse to import when a likely duplicate is detected (default).
 * - `allow`   -> import anyway, ignoring duplicate detection.
 * - `replace` -> not supported in MVP; the tool returns INVALID_INPUT.
 */
export type KnowledgeImportDuplicatePolicy = "fail" | "allow" | "replace";

export interface ImportKnowledgeAttachmentInput {
  readonly attachment_ref: string;
  readonly title?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly author?: string;
  readonly duplicatePolicy?: KnowledgeImportDuplicatePolicy;
}

export interface ImportKnowledgeAttachmentResult {
  readonly success: true;
  readonly documentId: number;
  readonly name: string;
  readonly title?: string;
  readonly tags: readonly string[];
  readonly fileType: string;
  readonly fileSize: number;
  readonly processingStatus?: string;
  readonly chunksCreated: number;
  readonly processingTimeMs: number;
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// delete_document
// ---------------------------------------------------------------------------

export interface DeleteKnowledgeDocumentInput {
  readonly document_id: number;
  readonly delete_source_file?: boolean;
  readonly expected_name?: string;
}

export interface DeleteKnowledgeDocumentResult {
  readonly success: true;
  readonly documentId: number;
  readonly name: string;
  readonly deletedSourceFile: boolean;
  readonly summary: string;
}

/** Convenience union for a tool method return value. */
export type KnowledgeLibraryListOutcome =
  | ListKnowledgeDocumentsResult
  | KnowledgeLibraryToolError;
export type KnowledgeLibraryImportOutcome =
  | ImportKnowledgeAttachmentResult
  | KnowledgeLibraryToolError;
export type KnowledgeLibraryDeleteOutcome =
  | DeleteKnowledgeDocumentResult
  | KnowledgeLibraryToolError;

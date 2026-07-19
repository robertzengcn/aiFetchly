/**
 * Knowledge Library management AI tools.
 *
 * Service layer that turns validated LLM tool arguments into calls against the
 * existing RAG document pipeline. It performs NO direct database access and
 * never reads arbitrary local file paths — the only import identifier is a
 * conversation-scoped `attachment_ref`, resolved by `DocumentService` to an
 * app-owned, containment-checked staged file.
 *
 * Layering:
 *   AI tool layer (this file)  -> validate args, format compact results
 *   Service/module layer        -> RAG import, listing, duplicate checks, deletion
 *   Model layer                 -> database access
 *
 * See:
 *   docs/prd/knowledge-library-management-ai-tools-prd.md
 *   docs/prd/knowledge-library-management-ai-tools-technical-design.md
 */

import { ZodError } from "zod";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { DocumentService } from "@/service/DocumentService";
import { RagSearchModule } from "@/modules/RagSearchModule";
import { RAGDocumentModule } from "@/modules/RAGDocumentModule";
import type { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import {
  deleteKnowledgeDocumentInputSchema,
  importKnowledgeAttachmentInputSchema,
  listKnowledgeDocumentsInputSchema,
} from "@/entityTypes/knowledgeLibraryAiToolTypes";
import type {
  KnowledgeLibraryDeleteOutcome,
  KnowledgeLibraryImportOutcome,
  KnowledgeLibraryDocumentSummary,
  KnowledgeLibraryListOutcome,
  KnowledgeLibraryToolError,
  KnowledgeLibraryToolErrorCode,
  ListKnowledgeDocumentsParsed,
  ImportKnowledgeAttachmentParsed,
  DeleteKnowledgeDocumentParsed,
} from "@/entityTypes/knowledgeLibraryAiToolTypes";

/** Upper bound on how many rows we scan from the DB before in-memory filtering. */
const LIST_QUERY_SCAN_CAP = 200;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Build a structured tool error payload. */
function toolError(
  code: KnowledgeLibraryToolErrorCode,
  error: string,
  extra?: Partial<KnowledgeLibraryToolError>
): KnowledgeLibraryToolError {
  return { success: false, code, error, ...extra };
}

/**
 * Map a thrown value to a tool error, surfacing Zod validation issues as
 * INVALID_INPUT and everything else as the supplied default code.
 */
function mapError(
  defaultCode: KnowledgeLibraryToolErrorCode,
  error: unknown
): KnowledgeLibraryToolError {
  if (error instanceof ZodError) {
    const messages = error.errors.map((issue) => issue.message).join("; ");
    return toolError("INVALID_INPUT", `Invalid input: ${messages}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return toolError(defaultCode, message);
}

/** Parse the JSON-encoded `tags` string stored on a RAGDocumentEntity. */
function parseDocumentTags(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** Map a RAG document row to a compact, model-facing summary (no paths/content). */
function toDocumentSummary(
  doc: RAGDocumentEntity
): KnowledgeLibraryDocumentSummary {
  return {
    id: doc.id,
    name: doc.name,
    title: doc.title,
    description: doc.description,
    tags: parseDocumentTags(doc.tags),
    author: doc.author,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    status: doc.status,
    processingStatus: doc.processingStatus,
    uploadedAt: doc.uploadedAt
      ? new Date(doc.uploadedAt).toISOString()
      : undefined,
  };
}

/** Case-insensitive substring match against document name or title. */
function matchesNameOrTitle(doc: RAGDocumentEntity, query: string): boolean {
  const needle = query.toLowerCase();
  const name = (doc.name || "").toLowerCase();
  const title = (doc.title || "").toLowerCase();
  return name.includes(needle) || title.includes(needle);
}

/**
 * Exact (normalized) match used by the destructive delete path. Compares
 * against both name and title; deliberately avoids fuzzy matching.
 */
function matchesExpectedName(
  doc: RAGDocumentEntity,
  expected: string
): boolean {
  const target = expected.trim().toLowerCase();
  if (!target) {
    return true;
  }
  return (
    (doc.name || "").toLowerCase() === target ||
    (doc.title || "").toLowerCase() === target
  );
}

/** Read the AI feature gate using the project Token service. */
function defaultIsAiEnabled(): boolean {
  try {
    const token = new Token();
    return token.getValue(USER_AI_ENABLED) === "true";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Service (dependency-injectable for tests)
// ---------------------------------------------------------------------------

export interface KnowledgeLibraryAiToolsDeps {
  /** DocumentService facade (attachment resolution, find/delete). */
  readonly documentService?: DocumentService;
  /** RAG document module (listing, validation, duplicate checks). */
  readonly ragDocumentModule?: RAGDocumentModule;
  /** RAG search module (upload + chunking + embedding). */
  readonly ragSearchModule?: RagSearchModule;
  /** Override the AI feature gate in tests. */
  readonly isAiEnabled?: () => boolean;
}

export class KnowledgeLibraryAiTools {
  constructor(private readonly deps: KnowledgeLibraryAiToolsDeps = {}) {}

  private getDocumentService(): DocumentService {
    return this.deps.documentService ?? new DocumentService();
  }

  private getRagDocumentModule(): RAGDocumentModule {
    return this.deps.ragDocumentModule ?? new RAGDocumentModule();
  }

  private getRagSearchModule(): RagSearchModule {
    return this.deps.ragSearchModule ?? new RagSearchModule();
  }

  private isAiEnabled(): boolean {
    return this.deps.isAiEnabled
      ? this.deps.isAiEnabled()
      : defaultIsAiEnabled();
  }

  /**
   * List knowledge library documents with compact metadata. Read-only; does
   * not require AI to be enabled.
   */
  async listDocuments(
    args: Record<string, unknown>
  ): Promise<KnowledgeLibraryListOutcome> {
    let input: ListKnowledgeDocumentsParsed;
    try {
      input = listKnowledgeDocumentsInputSchema.parse(args);
    } catch (error) {
      return mapError("INVALID_INPUT", error);
    }

    try {
      const module = this.getRagDocumentModule();
      const docs = await module.getDocuments({
        status: input.status,
        processingStatus: input.processingStatus,
        fileType: input.fileType,
        tags: input.tags ? [...input.tags] : undefined,
        limit: LIST_QUERY_SCAN_CAP,
        offset: 0,
      });

      const filtered = input.query
        ? docs.filter((doc) => matchesNameOrTitle(doc, input.query as string))
        : docs;
      const page = filtered.slice(input.offset, input.offset + input.limit);
      const documents = page.map(toDocumentSummary);
      // Signal when the scan hit its cap: more documents may exist beyond what
      // was scanned, so an empty/small page does not mean the library is empty.
      const truncated = docs.length >= LIST_QUERY_SCAN_CAP;

      return {
        success: true,
        documents,
        limit: input.limit,
        offset: input.offset,
        returned: documents.length,
        truncated,
      };
    } catch (error) {
      return mapError("LIST_FAILED", error);
    }
  }

  /**
   * Import a document attached to the current chat conversation into the
   * knowledge library via the existing RAG upload pipeline. Requires AI to be
   * enabled (embedding work) and user confirmation.
   */
  async importAttachment(
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<KnowledgeLibraryImportOutcome> {
    let input: ImportKnowledgeAttachmentParsed;
    try {
      input = importKnowledgeAttachmentInputSchema.parse(args);
    } catch (error) {
      return mapError("INVALID_INPUT", error);
    }

    if (!this.isAiEnabled()) {
      return toolError(
        "AI_DISABLED",
        "AI is not enabled. Importing documents requires an active AI subscription."
      );
    }

    if (input.duplicatePolicy === "replace") {
      return toolError(
        "INVALID_INPUT",
        'duplicatePolicy "replace" is not supported yet. Use "fail" or "allow".'
      );
    }

    const documentService = this.getDocumentService();
    let source;
    try {
      source = await documentService.getStagedAttachmentImportSource(
        context.conversationId,
        input.attachment_ref
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError("ATTACHMENT_NOT_FOUND", message);
    }

    const documentModule = this.getRagDocumentModule();
    try {
      const validation = await documentModule.validateFile(source.filePath);
      if (!validation.isValid) {
        const combined = validation.errors.join(", ");
        const code: KnowledgeLibraryToolErrorCode =
          /size|large|exceed|big/i.test(combined)
            ? "FILE_TOO_LARGE"
            : "UNSUPPORTED_FILE_TYPE";
        return toolError(code, combined);
      }

      if (input.duplicatePolicy === "fail") {
        const duplicate = await documentModule.checkDuplicate(
          source.fileName,
          validation.fileSize ?? source.sizeBytes
        );
        if (duplicate.isDuplicate) {
          return toolError(
            "DUPLICATE_DOCUMENT",
            "A matching document already exists in the knowledge library.",
            {
              existingDocuments:
                duplicate.existingDocuments.map(toDocumentSummary),
            }
          );
        }
      }

      // RAGDocumentModule.uploadDocument copies the source into an app-owned
      // rag_uploads directory and persists that durable path as document.filePath
      // (never the external/staged path), so it is safe to pass the staged
      // source directly. The staged file's 24h TTL does not affect the imported
      // document because the persisted copy lives under rag_uploads.
      const ragModule = this.getRagSearchModule();
      await ragModule.initializeRagModule();
      const upload = await ragModule.uploadDocument({
        filePath: source.filePath,
        name: source.fileName,
        title: input.title,
        description: input.description,
        tags: input.tags ? [...input.tags] : undefined,
        author: input.author ?? "User",
      });

      return {
        success: true,
        documentId: upload.documentId,
        name: upload.document.name,
        title: upload.document.title,
        tags: parseDocumentTags(upload.document.tags),
        fileType: upload.document.fileType,
        fileSize: upload.document.fileSize,
        processingStatus: upload.document.processingStatus,
        chunksCreated: upload.chunksCreated,
        processingTimeMs: upload.processingTime,
        summary: `Imported ${upload.document.name} into the knowledge library as document #${upload.documentId}.`,
      };
    } catch (error) {
      return mapError("IMPORT_FAILED", error);
    }
  }

  /**
   * Delete one known document by exact ID through the existing RAG delete
   * pipeline. Local cleanup only; does not require AI to be enabled.
   */
  async deleteDocument(
    args: Record<string, unknown>
  ): Promise<KnowledgeLibraryDeleteOutcome> {
    let input: DeleteKnowledgeDocumentParsed;
    try {
      input = deleteKnowledgeDocumentInputSchema.parse(args);
    } catch (error) {
      return mapError("INVALID_INPUT", error);
    }

    try {
      const documentService = this.getDocumentService();
      const doc = await documentService.findDocumentById(input.document_id);
      if (!doc) {
        return toolError(
          "DOCUMENT_NOT_FOUND",
          `Document #${input.document_id} was not found in the knowledge library.`
        );
      }

      if (
        input.expected_name &&
        !matchesExpectedName(doc, input.expected_name)
      ) {
        return toolError(
          "EXPECTED_NAME_MISMATCH",
          `Document #${doc.id} did not match the expected name "${input.expected_name}".`
        );
      }

      const deleted = await documentService.deleteDocument(
        input.document_id,
        input.delete_source_file
      );
      if (!deleted) {
        return toolError(
          "DELETE_FAILED",
          `Failed to delete document #${input.document_id} from the knowledge library.`
        );
      }

      return {
        success: true,
        documentId: doc.id,
        name: doc.name,
        deletedSourceFile: input.delete_source_file,
        summary: `Deleted document #${doc.id} from the knowledge library.`,
      };
    } catch (error) {
      return mapError("DELETE_FAILED", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Free-function wrappers for the SkillRegistry execute callbacks
// ---------------------------------------------------------------------------

let defaultTools: KnowledgeLibraryAiTools | null = null;

function getDefaultTools(): KnowledgeLibraryAiTools {
  if (!defaultTools) {
    defaultTools = new KnowledgeLibraryAiTools();
  }
  return defaultTools;
}

export async function listKnowledgeLibraryDocumentsForAi(
  args: Record<string, unknown>
): Promise<KnowledgeLibraryListOutcome> {
  return getDefaultTools().listDocuments(args);
}

export async function importKnowledgeLibraryAttachmentForAi(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<KnowledgeLibraryImportOutcome> {
  return getDefaultTools().importAttachment(args, context);
}

export async function deleteKnowledgeLibraryDocumentForAi(
  args: Record<string, unknown>
): Promise<KnowledgeLibraryDeleteOutcome> {
  return getDefaultTools().deleteDocument(args);
}

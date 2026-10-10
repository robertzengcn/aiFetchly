import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";
import { importKnowledgeWebsiteInputSchema } from "@/entityTypes/knowledgeLibraryAiToolTypes";
import { knowledgeCustomMetadataSchema } from "@/schemas/knowledge/customMetadata";

/**
 * Returns true when every tag in the list is unique case-insensitively. Used as
 * a Zod `.refine` on upload-boundary tag arrays so a payload like
 * `["Pricing", "pricing"]` fails validation on the main-process boundary
 * instead of being silently deduped or stored twice (PRD §9). The UI normalizes
 * duplicates earlier, but the boundary must reject them independently.
 */
function noCaseInsensitiveDuplicateTags(tags: string[]): boolean {
  const seen = new Set<string>();
  for (const tag of tags) {
    const folded = tag.toLowerCase();
    if (seen.has(folded)) {
      return false;
    }
    seen.add(folded);
  }
  return true;
}

/**
 * Matches a calendar-date or full ISO 8601 string (e.g. "2024-03-15" or
 * "2024-03-15T00:00:00Z"). Used to validate `documentDate` on the upload
 * boundary (technical design §6: validate ISO date). The value is bound as a
 * parameter downstream — never concatenated into SQL.
 */
const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
export const documentDateSchema = z
  .string()
  .trim()
  .regex(isoDateRegex, "documentDate must be an ISO 8601 date (YYYY-MM-DD)");

export const documentLanguageSchema = z.string().trim().min(1).max(16);

/** SHOW_OPEN_DIALOG: Electron OpenDialogOptions (passthrough) */
export const ragShowOpenDialogInputSchema = lazySchema(() =>
  z.object({}).passthrough()
);

/** GET_FILE_STATS: { filePath } */
export const ragFileStatsInputSchema = lazySchema(() =>
  z.strictObject({
    filePath: z.string().min(1, "filePath is required"),
  })
);

/** 7 个 no-input handler 共享: INITIALIZE/GET_STATS/TEST_PIPELINE/GET_DOCUMENT_STATS/
 *  GET_SEARCH_ANALYTICS/GET_AVAILABLE_MODELS/TEST_EMBEDDING_SERVICE/CLEAR_CACHE/CLEANUP */
export const ragNoInputSchema = noInputSchema;

/** RAG_QUERY: { query, options? } */
export const ragQueryInputSchema = lazySchema(() =>
  z
    .object({
      query: z.string().min(1, "query is required"),
    })
    .passthrough()
);

/** RAG_UPLOAD_DOCUMENT: { filePath, name, modelName, title?, ... } */
export const ragUploadDocumentInputSchema = lazySchema(() =>
  z
    .object({
      filePath: z.string().min(1, "filePath is required"),
      name: z.string().min(1, "name is required"),
      modelName: z.string().min(1, "modelName is required"),
      title: z.string().trim().max(500).optional(),
      description: z.string().trim().max(2000).optional(),
      author: z.string().trim().max(255).optional(),
      tags: z
        .array(z.string().trim().min(1).max(64))
        .max(20)
        .refine(noCaseInsensitiveDuplicateTags, {
          message:
            "tags must be unique case-insensitively: duplicate tags are rejected, not silently dropped",
        })
        .optional(),
      language: documentLanguageSchema.optional(),
      documentDate: documentDateSchema.optional(),
      customMetadata: knowledgeCustomMetadataSchema.optional(),
    })
    .passthrough()
);

/**
 * SAVE_TEMP_FILE metadata: the metadata sub-object on the streaming
 * `ipcMain.on(SAVE_TEMP_FILE)` payload. Mirrors the tags/description/author
 * rules of {@link ragUploadDocumentInputSchema}, including the case-insensitive
 * duplicate-tag rejection, so both upload boundaries (RAG_UPLOAD_DOCUMENT and
 * SAVE_TEMP_FILE) reject duplicates consistently (PRD §9). Kept in the pure
 * schema module so it can be unit-tested without importing Electron.
 */
export const saveTempFileMetadataSchema = z.object({
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  author: z.string().trim().max(255).optional(),
  tags: z
    .array(z.string().trim().min(1).max(64))
    .max(20)
    .refine(noCaseInsensitiveDuplicateTags, {
      message:
        "tags must be unique case-insensitively: duplicate tags are rejected, not silently dropped",
    })
    .optional(),
  language: documentLanguageSchema.optional(),
  documentDate: documentDateSchema.optional(),
  customMetadata: knowledgeCustomMetadataSchema.optional(),
});

/** RAG_GET_DOCUMENTS: filters (optional, passthrough) */
export const ragGetDocumentsInputSchema = lazySchema(() =>
  z.object({}).passthrough()
);

/** RAG_GET_DOCUMENT: { id } */
export const ragDocumentByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
  })
);

/** RAG_UPDATE_DOCUMENT: { id, metadata } */
export const ragUpdateDocumentInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
    metadata: z.unknown(),
  })
);

/** RAG_DELETE_DOCUMENT: { id, deleteFile? } */
export const ragDeleteDocumentInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
    deleteFile: z.boolean().optional(),
  })
);

/** RAG_SEARCH: SearchRequest (passthrough) */
export const ragSearchInputSchema = lazySchema(() =>
  z.object({}).passthrough()
);

/** RAG_GET_SUGGESTIONS: { query, limit? } */
export const ragSuggestionsInputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(1, "query is required"),
    limit: z.number().int().positive().optional(),
  })
);

/** RAG_UPDATE_EMBEDDING_MODEL: { model } */
export const ragUpdateEmbeddingModelInputSchema = lazySchema(() =>
  z.strictObject({
    model: z.string().min(1, "model is required"),
  })
);

/** RAG_CHUNK_AND_EMBED_DOCUMENT: { documentId } */
export const ragChunkAndEmbedInputSchema = lazySchema(() =>
  z.strictObject({
    documentId: z.number().int().positive("documentId is required"),
  })
);

/** RAG_DOWNLOAD_DOCUMENT: { documentId, fileName } */
export const ragDownloadDocumentInputSchema = lazySchema(() =>
  z.strictObject({
    documentId: z.number().int().positive("documentId is required"),
    fileName: z.string().min(1, "fileName is required"),
  })
);

/** RAG_GET_DOCUMENT_ERROR_LOG: { documentId } */
export const ragDocumentErrorLogInputSchema = lazySchema(() =>
  z.strictObject({
    documentId: z.number().int().positive("documentId is required"),
  })
);

/** RAG_CHECK_DOCUMENT_DUPLICATE: { name, fileSize } */
export const ragCheckDuplicateInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, "name is required"),
    fileSize: z.number().int().nonnegative("fileSize is required"),
  })
);

/**
 * RAG_IMPORT_WEBSITE: website/URL import options.
 *
 * Reuses the authoritative `importKnowledgeWebsiteInputSchema` (mode-aware
 * url/urls requirements, SSRF-bound URL shape, maxPages/maxDepth limits) so the
 * IPC boundary and `KnowledgeLibraryAiTools.importWebsite()` cannot drift. The
 * tool re-parses internally; the boundary parse keeps invalid input out of the
 * handler and produces consistent validation errors.
 */
export const ragImportWebsiteInputSchema = lazySchema(
  () => importKnowledgeWebsiteInputSchema
);

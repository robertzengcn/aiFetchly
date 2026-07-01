import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { noInputSchema } from '@/schemas/ipc/_shared/common'

/** SHOW_OPEN_DIALOG: Electron OpenDialogOptions (passthrough) */
export const ragShowOpenDialogInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** GET_FILE_STATS: { filePath } */
export const ragFileStatsInputSchema = lazySchema(() =>
  z.strictObject({
    filePath: z.string().min(1, 'filePath is required'),
  }),
)

/** 7 个 no-input handler 共享: INITIALIZE/GET_STATS/TEST_PIPELINE/GET_DOCUMENT_STATS/
 *  GET_SEARCH_ANALYTICS/GET_AVAILABLE_MODELS/TEST_EMBEDDING_SERVICE/CLEAR_CACHE/CLEANUP */
export const ragNoInputSchema = noInputSchema

/** RAG_QUERY: { query, options? } */
export const ragQueryInputSchema = lazySchema(() =>
  z.object({
    query: z.string().min(1, 'query is required'),
  }).passthrough(),
)

/** RAG_UPLOAD_DOCUMENT: { filePath, name, modelName, title?, ... } */
export const ragUploadDocumentInputSchema = lazySchema(() =>
  z.object({
    filePath: z.string().min(1, 'filePath is required'),
    name: z.string().min(1, 'name is required'),
    modelName: z.string().min(1, 'modelName is required'),
  }).passthrough(),
)

/** RAG_GET_DOCUMENTS: filters (optional, passthrough) */
export const ragGetDocumentsInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** RAG_GET_DOCUMENT: { id } */
export const ragDocumentByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
  }),
)

/** RAG_UPDATE_DOCUMENT: { id, metadata } */
export const ragUpdateDocumentInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
    metadata: z.unknown(),
  }),
)

/** RAG_DELETE_DOCUMENT: { id, deleteFile? } */
export const ragDeleteDocumentInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
    deleteFile: z.boolean().optional(),
  }),
)

/** RAG_SEARCH: SearchRequest (passthrough) */
export const ragSearchInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** RAG_GET_SUGGESTIONS: { query, limit? } */
export const ragSuggestionsInputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(1, 'query is required'),
    limit: z.number().int().positive().optional(),
  }),
)

/** RAG_UPDATE_EMBEDDING_MODEL: { model } */
export const ragUpdateEmbeddingModelInputSchema = lazySchema(() =>
  z.strictObject({
    model: z.string().min(1, 'model is required'),
  }),
)

/** RAG_CHUNK_AND_EMBED_DOCUMENT: { documentId } */
export const ragChunkAndEmbedInputSchema = lazySchema(() =>
  z.strictObject({
    documentId: z.number().int().positive('documentId is required'),
  }),
)

/** RAG_DOWNLOAD_DOCUMENT: { documentId, fileName } */
export const ragDownloadDocumentInputSchema = lazySchema(() =>
  z.strictObject({
    documentId: z.number().int().positive('documentId is required'),
    fileName: z.string().min(1, 'fileName is required'),
  }),
)

/** RAG_GET_DOCUMENT_ERROR_LOG: { documentId } */
export const ragDocumentErrorLogInputSchema = lazySchema(() =>
  z.strictObject({
    documentId: z.number().int().positive('documentId is required'),
  }),
)

/** RAG_CHECK_DOCUMENT_DUPLICATE: { name, fileSize } */
export const ragCheckDuplicateInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, 'name is required'),
    fileSize: z.number().int().nonnegative('fileSize is required'),
  }),
)

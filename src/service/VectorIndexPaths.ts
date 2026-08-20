import * as path from "path";
import { app } from "electron";
import { toPathSafeModelKey } from "@/service/embedding/EmbeddingModelId";

/**
 * App-owned base directory for document vector index files.
 *
 * The SqliteVecDatabase actually stores vectors in the main TypeORM `vectors`
 * / `vector_metadata` tables, so the `.db` "index" path is a logical marker
 * file only. It must live under a single, stable, app-owned directory so that:
 *   - the deletion containment check (F10) can safely unlink it, and
 *   - every consumer (indexing, search, delete) resolves the same path.
 *
 * Previously each `VectorStoreService` could be constructed with a different
 * base path (e.g. `app.getPath("appData")` / `process.cwd()/data/vector_index`),
 * producing orphaned index files that the F10 containment check refused to
 * delete ("Refusing to delete vector index path outside allowed roots").
 */
export function getVectorIndexBaseDir(): string {
  // Deliberately `userData` (app-owned, per-user) rather than `appData`/cwd.
  return path.join(app.getPath("userData"), "vector_index");
}

/** The directory that holds per-document index files. */
export function getDocumentVectorIndexDir(): string {
  return path.join(getVectorIndexBaseDir(), "documents");
}

/**
 * Resolve the logical vector index file path for a document + model.
 *
 * Kept in this module so indexing, search, and deletion always agree on the
 * path even when the model ID contains characters unsafe in filenames.
 */
export function getDocumentVectorIndexPath(
  documentId: number,
  modelName: string,
  dimensions: number
): string {
  const safeModelKey = toPathSafeModelKey(modelName);
  const fileName = `index_doc_${documentId}_${safeModelKey}_${dimensions}.db`;
  return path.join(getDocumentVectorIndexDir(), fileName);
}
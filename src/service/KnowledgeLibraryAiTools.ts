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
import { ensureHostedAiEnabled } from "@/service/AiFeatureGate";
import { DocumentService } from "@/service/DocumentService";
import { RagSearchModule } from "@/modules/RagSearchModule";
import { isLocalXenovaModel } from "@/service/embedding/EmbeddingModelId";
import { LocalEmbeddingWorkerClient } from "@/service/embedding/LocalEmbeddingWorkerClient";
import { RAGDocumentModule } from "@/modules/RAGDocumentModule";
import {
  WebsiteKnowledgeImportService,
  WEBSITE_DEFAULT_AUTHOR,
  type WebsiteImportSource,
  type WebsiteImportPagePreparedEvent,
} from "@/service/WebsiteKnowledgeImportService";
import type { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import {
  deleteKnowledgeDocumentInputSchema,
  importKnowledgeAttachmentInputSchema,
  importKnowledgeWebsiteInputSchema,
  listKnowledgeDocumentsInputSchema,
} from "@/entityTypes/knowledgeLibraryAiToolTypes";
import type {
  KnowledgeLibraryDeleteOutcome,
  KnowledgeLibraryImportOutcome,
  KnowledgeLibraryDocumentSummary,
  KnowledgeLibraryListOutcome,
  KnowledgeLibraryToolError,
  KnowledgeLibraryToolErrorCode,
  KnowledgeLibraryWebsiteImportOutcome,
  KnowledgeLibraryWebsiteImportProgressEvent,
  ImportKnowledgeWebsiteResult,
  ListKnowledgeDocumentsParsed,
  ImportKnowledgeAttachmentParsed,
  ImportKnowledgeWebsiteParsed,
  DeleteKnowledgeDocumentParsed,
  ImportedWebsiteDocumentSummary,
  SkippedWebsiteImportSummary,
  SkippedWebsiteImportCode,
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
  // Strip absolute filesystem paths (staged/vector-index paths can appear in
  // inner error messages) before the string reaches the model or the UI. URLs
  // are preserved. Honors the "never expose filePath/content" tool contract.
  return toolError(defaultCode, sanitizeReason(message));
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

/**
 * Default AI feature gate. Lazy-reconciles once when currently disabled
 * (PRD FR-6.1), then re-reads the flag. GET failures keep the cache, so a
 * Community user is never falsely unlocked.
 */
async function defaultIsAiEnabled(): Promise<boolean> {
  try {
    return await ensureHostedAiEnabled();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Website import helpers
// ---------------------------------------------------------------------------

/** Build the per-page tag set: website + host tag + user tags (deduped). */
function buildWebsiteTags(
  sourceUrl: string,
  userTags: readonly string[] | undefined
): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const candidates = [
    "website",
    hostTagFromUrl(sourceUrl),
    ...(userTags ?? []),
  ];
  for (const tag of candidates) {
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 20) break; // schema max
  }
  return tags;
}

/** Hostname (sans leading www.) capped to tag length, or "" if unparseable. */
function hostTagFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").slice(0, 80);
  } catch {
    return "";
  }
}

/**
 * Strip absolute filesystem paths (Unix `/abs/...` and Windows `C:\\...`) from
 * an inner error message before it reaches the model. Inner upload/chunk/embed
 * errors can include staged or vector-index paths (e.g. `ENOENT: ... '/path'`);
 * the PRD requires tool results never expose local paths. URLs are preserved —
 * a `/segment` not preceded by a path boundary (space/paren/quote/start) is
 * left untouched, so `https://host/path` survives.
 */
function sanitizeReason(message: string): string {
  return message
    .replace(/(^|[\s('"])(\/[^\s'"<>)]+|[A-Za-z]:\\[^\s'"<>)]+)/g, "$1[path]")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a collection-level description carrying source/import metadata. */
function buildWebsiteDescription(
  userDescription: string | undefined,
  source: WebsiteImportSource,
  mode: string
): string {
  const lines: string[] = [];
  const trimmed = userDescription?.trim();
  if (trimmed) {
    lines.push(trimmed);
  }
  lines.push("Imported webpage");
  lines.push(`Source URL: ${source.sourceUrl}`);
  if (source.finalUrl && source.finalUrl !== source.sourceUrl) {
    lines.push(`Final URL: ${source.finalUrl}`);
  }
  lines.push(`Import mode: ${mode}`);
  lines.push(`Import group: ${source.importGroupId}`);
  return lines.join("\n");
}

/** Human-readable success summary for the model. */
function summarizeWebsiteSuccess(
  mode: string,
  importedCount: number,
  skippedCount: number
): string {
  const label = mode === "site_crawl" ? "webpage(s)" : "webpage(s)";
  const searchable =
    " The imported pages are now searchable in future knowledge-library answers.";
  if (skippedCount > 0) {
    return `Imported ${importedCount} ${label} into the knowledge library. Skipped ${skippedCount} page(s).${searchable}`;
  }
  return `Imported ${importedCount} ${label} into the knowledge library.${searchable}`;
}

/** Human-readable failure summary listing per-page skip reasons. */
function summarizeWebsiteFailure(
  skipped: readonly SkippedWebsiteImportSummary[],
  discoveredCount?: number
): string {
  const discovery =
    discoveredCount !== undefined
      ? ` Discovered ${discoveredCount} link(s).`
      : "";
  if (skipped.length === 0) {
    return `No pages were imported.${discovery}`;
  }
  const reasons = skipped
    .map((s) => `${s.code.toLowerCase().replace(/_/g, " ")} (${s.url})`)
    .join("; ");
  return `No pages were imported.${discovery} Skipped: ${reasons}.`;
}

/** Pick the single most descriptive tool error code when nothing imported. */
function aggregateWebsiteFailureCode(
  skipped: readonly SkippedWebsiteImportSummary[]
): KnowledgeLibraryToolErrorCode {
  if (skipped.length === 0) return "IMPORT_FAILED";
  const first = skipped[0].code;
  if (!skipped.every((s) => s.code === first)) return "IMPORT_FAILED";
  switch (first) {
    case "DUPLICATE_DOCUMENT":
      return "DUPLICATE_DOCUMENT";
    case "URL_BLOCKED":
      return "URL_BLOCKED";
    case "EMPTY_CONTENT":
      return "EMPTY_CONTENT";
    case "SCRAPE_FAILED":
      return "SCRAPE_FAILED";
    case "FILE_TOO_LARGE":
      return "FILE_TOO_LARGE";
    default:
      return "IMPORT_FAILED";
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
  /** Website import service (URL ingest + markdown staging). */
  readonly websiteImportService?: WebsiteKnowledgeImportService;
  /** Override the AI feature gate in tests. Async to allow a lazy reconcile. */
  readonly isAiEnabled?: () => Promise<boolean>;
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

  private getWebsiteImportService(): WebsiteKnowledgeImportService {
    return (
      this.deps.websiteImportService ?? new WebsiteKnowledgeImportService()
    );
  }

  private async isAiEnabled(): Promise<boolean> {
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

    if (!(await this.isAiEnabled())) {
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
   * Import public webpage content into the local knowledge library by URL.
   *
   * Scrapes pages (single page, an explicit list, or a bounded same-origin
   * crawl), converts each to markdown, and indexes it through the existing RAG
   * upload pipeline as a separate document. Requires AI to be enabled
   * (embedding work) and user confirmation.
   *
   * Never passes a URL as a `filePath` — only app-owned staged markdown files
   * produced by `WebsiteKnowledgeImportService` reach the RAG pipeline. Per-page
   * failures become `skipped` entries so multi-page imports partially succeed.
   */
  async importWebsite(
    args: Record<string, unknown>,
    _context: SkillExecutionContext,
    onProgress?: (event: KnowledgeLibraryWebsiteImportProgressEvent) => void
  ): Promise<KnowledgeLibraryWebsiteImportOutcome> {
    let input: ImportKnowledgeWebsiteParsed;
    try {
      input = importKnowledgeWebsiteInputSchema.parse(args);
    } catch (error) {
      return mapError("INVALID_INPUT", error);
    }

    if (!(await this.isAiEnabled())) {
      return toolError(
        "AI_DISABLED",
        "AI is not enabled. Importing websites requires an active AI subscription."
      );
    }

    const localRuntimeError = await this.ensureLocalEmbeddingRuntimeForImport();
    if (localRuntimeError) {
      return localRuntimeError;
    }

    if (input.duplicatePolicy === "replace") {
      return toolError(
        "INVALID_INPUT",
        'duplicatePolicy "replace" is not supported yet. Use "fail" or "allow".'
      );
    }

    const imported: ImportedWebsiteDocumentSummary[] = [];
    const skipped: SkippedWebsiteImportSummary[] = [];
    const maxPages =
      input.mode === "single_page"
        ? 1
        : input.mode === "url_list"
        ? Math.min(input.urls?.length ?? input.maxPages, input.maxPages)
        : input.maxPages;
    const emitProgress = (
      event: Omit<
        KnowledgeLibraryWebsiteImportProgressEvent,
        "mode" | "importedCount" | "skippedCount"
      >
    ): void => {
      try {
        onProgress?.({
          mode: input.mode,
          importedCount: imported.length,
          skippedCount: skipped.length,
          maxPages,
          ...event,
        });
      } catch {
        // Progress is best-effort; never abort the import if a renderer closes.
      }
    };

    emitProgress({
      phase: "starting",
      requestedCount: input.mode === "url_list" ? input.urls?.length ?? 0 : 1,
    });

    const documentModule = this.getRagDocumentModule();
    const ragModule = this.getRagSearchModule();
    let ragInitPromise: Promise<void> | null = null;
    const ensureRagInitialized = (): Promise<void> => {
      ragInitPromise ??= ragModule.initializeRagModule();
      return ragInitPromise;
    };

    const uploadTasks: Promise<void>[] = [];
    let uploadTail: Promise<void> = Promise.resolve();
    let pipelinedEvents = 0;

    const recordSkipped = (
      source: SkippedWebsiteImportSummary,
      progress?: Partial<KnowledgeLibraryWebsiteImportProgressEvent>
    ): void => {
      const summary: SkippedWebsiteImportSummary = { ...source };
      skipped.push(summary);
      emitProgress({
        phase: "skipped",
        url: summary.url,
        code: summary.code,
        reason: summary.reason,
        processedPages: progress?.processedPages,
        discoveredCount: progress?.discoveredCount,
      });
    };

    const enqueueImport = (
      source: WebsiteImportSource,
      progress?: Partial<KnowledgeLibraryWebsiteImportProgressEvent>
    ): void => {
      const task = uploadTail.then(async () => {
        emitProgress({
          phase: "importing",
          url: source.sourceUrl,
          title: source.title,
          processedPages: progress?.processedPages,
          discoveredCount: progress?.discoveredCount,
        });

        try {
          await ensureRagInitialized();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const skippedSource: SkippedWebsiteImportSummary = {
            url: source.sourceUrl,
            reason: sanitizeReason(reason),
            code: "IMPORT_FAILED",
          };
          recordSkipped(skippedSource, progress);
          return;
        }

        const staged = await this.stageOneWebsiteSource(
          source,
          input,
          documentModule,
          ragModule
        );
        if (staged.imported) {
          imported.push(staged.imported);
          emitProgress({
            phase: "imported",
            url: staged.imported.sourceUrl,
            title: staged.imported.title ?? staged.imported.name,
            processedPages: progress?.processedPages,
            discoveredCount: progress?.discoveredCount,
          });
        }
        if (staged.skipped) {
          skipped.push(staged.skipped);
          emitProgress({
            phase: "skipped",
            url: staged.skipped.url,
            code: staged.skipped.code,
            reason: staged.skipped.reason,
            processedPages: progress?.processedPages,
            discoveredCount: progress?.discoveredCount,
          });
        }
      });
      uploadTail = task.catch(() => undefined);
      uploadTasks.push(task);
    };

    const handlePreparedPage = (
      event: WebsiteImportPagePreparedEvent
    ): void => {
      pipelinedEvents++;
      if (event.source) {
        enqueueImport(event.source, {
          processedPages: event.processedPages,
          discoveredCount: event.discoveredCount,
        });
      }
      if (event.skipped) {
        recordSkipped(event.skipped, {
          processedPages: event.processedPages,
          discoveredCount: event.discoveredCount,
        });
      }
    };

    let prepare;
    try {
      prepare = await this.getWebsiteImportService().prepareImportSources(
        {
          mode: input.mode,
          url: input.url,
          urls: input.urls ? [...input.urls] : undefined,
          maxPages: input.maxPages,
          maxDepth: input.maxDepth,
        },
        {
          onPageStart: (event) => {
            emitProgress({
              phase: "scraping",
              url: event.url,
              processedPages: event.processedPages,
              discoveredCount: event.discoveredCount,
            });
          },
          onPagePrepared: handlePreparedPage,
        }
      );
    } catch (error) {
      return mapError("IMPORT_FAILED", error);
    }

    if (uploadTasks.length > 0) {
      await Promise.all(uploadTasks);
    }

    if (pipelinedEvents === 0) {
      skipped.push(...prepare.skipped.map((s) => ({ ...s })));

      if (prepare.sources.length > 0) {
        try {
          await ensureRagInitialized();
        } catch (error) {
          return mapError("IMPORT_FAILED", error);
        }
      }

      for (const source of prepare.sources) {
        const staged = await this.stageOneWebsiteSource(
          source,
          input,
          documentModule,
          ragModule
        );
        if (staged.imported) imported.push(staged.imported);
        if (staged.skipped) skipped.push(staged.skipped);
      }
    }

    if (imported.length === 0) {
      const code = aggregateWebsiteFailureCode(skipped);
      const failure = toolError(
        code,
        summarizeWebsiteFailure(skipped, prepare.discoveredCount)
      );
      emitProgress({
        phase: "completed",
        requestedCount: prepare.requestedCount,
        discoveredCount: prepare.discoveredCount,
        summary: failure.error,
      });
      return failure;
    }

    const skipCodeCounts: Record<string, number> = {};
    for (const item of skipped) {
      skipCodeCounts[item.code] = (skipCodeCounts[item.code] ?? 0) + 1;
    }
    console.log(
      `[WebsiteImport] completed mode=${input.mode} ` +
        `imported=${imported.length} skipped=${skipped.length} ` +
        `requested=${prepare.requestedCount} ` +
        `discovered=${prepare.discoveredCount ?? 0} ` +
        `skipCodes=${JSON.stringify(skipCodeCounts)}`
    );

    const result: ImportKnowledgeWebsiteResult = {
      success: true,
      mode: input.mode,
      imported,
      skipped,
      importedCount: imported.length,
      skippedCount: skipped.length,
      requestedCount: prepare.requestedCount,
      discoveredCount: prepare.discoveredCount,
      summary: summarizeWebsiteSuccess(
        input.mode,
        imported.length,
        skipped.length
      ),
    };
    emitProgress({
      phase: "completed",
      requestedCount: result.requestedCount,
      discoveredCount: result.discoveredCount,
      summary: result.summary,
    });
    return result;
  }

  /**
   * Fail fast when the default embedding model is local-xenova but the
   * downloadable embedding runtime is not installed. Avoids scraping pages
   * only to fail during upload/embed.
   */
  private async ensureLocalEmbeddingRuntimeForImport(): Promise<KnowledgeLibraryToolError | null> {
    try {
      const defaultModel =
        await this.getRagSearchModule().getDefaultEmbeddingModel();
      if (!defaultModel || !isLocalXenovaModel(defaultModel.modelName)) {
        console.log(
          `[WebsiteImport] embedding preflight skip (non-local model=${
            defaultModel?.modelName ?? "(none)"
          })`
        );
        return null;
      }
      const client = LocalEmbeddingWorkerClient.getInstance();
      const ready = await client.hasInstalledRuntimeWorker();
      console.log(
        `[WebsiteImport] embedding preflight model=${defaultModel.modelName} runtimeReady=${ready}`
      );
      if (!ready) {
        return toolError(
          "LOCAL_EMBEDDING_RUNTIME_MISSING",
          "Local embedding runtime (@xenova/transformers) is not installed. Install the local-AI embedding runtime via the in-app runtime manager and retry."
        );
      }
      // Path exists is not enough — the utility worker must actually start
      // (NODE_PATH / native deps). Probe before scraping many pages.
      try {
        await client.probeInitialize(defaultModel.modelName);
        console.log(
          `[WebsiteImport] embedding preflight probeInitialize ok model=${defaultModel.modelName}`
        );
      } catch (probeError) {
        const reason =
          probeError instanceof Error ? probeError.message : String(probeError);
        console.error(
          `[WebsiteImport] embedding preflight probeInitialize failed: ${reason}`
        );
        return toolError(
          "LOCAL_EMBEDDING_RUNTIME_MISSING",
          `Local embedding worker failed to start: ${reason}`
        );
      }
      return null;
    } catch (error) {
      // Status probe failure should not block import; embed path still errors clearly.
      console.warn(
        "[WebsiteImport] Local embedding runtime preflight failed:",
        error
      );
      return null;
    }
  }

  /**
   * Validate, duplicate-check, and upload one staged webpage source. Returns
   * either an imported summary or a skipped summary (never throws — failures are
   * surfaced as skipped so a multi-page import can partially succeed).
   */
  private async stageOneWebsiteSource(
    source: WebsiteImportSource,
    input: ImportKnowledgeWebsiteParsed,
    documentModule: RAGDocumentModule,
    ragModule: RagSearchModule
  ): Promise<{
    imported?: ImportedWebsiteDocumentSummary;
    skipped?: SkippedWebsiteImportSummary;
  }> {
    console.log(
      `[WebsiteImport] stage start url=${source.sourceUrl} ` +
        `canonical=${source.canonicalUrl ?? "(none)"} ` +
        `file=${source.fileName} sizeBytes=${source.sizeBytes} ` +
        `duplicatePolicy=${input.duplicatePolicy}`
    );

    let validation;
    try {
      validation = await documentModule.validateFile(source.filePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[WebsiteImport] validate threw url=${source.sourceUrl} reason=${reason}`
      );
      return {
        skipped: {
          url: source.sourceUrl,
          reason: sanitizeReason(reason),
          code: "IMPORT_FAILED",
        },
      };
    }
    if (!validation.isValid) {
      const combined = validation.errors.join(", ");
      const code: SkippedWebsiteImportCode = /size|large|exceed|big/i.test(
        combined
      )
        ? "FILE_TOO_LARGE"
        : "UNSUPPORTED_FILE_TYPE";
      console.warn(
        `[WebsiteImport] validate failed url=${source.sourceUrl} code=${code} reason=${combined}`
      );
      return {
        skipped: { url: source.sourceUrl, reason: combined, code },
      };
    }

    // Duplicate detection by URL identity (canonical → source). Only completed
    // documents block under fail policy. Content hashes are stored as metadata
    // but not used for duplicate decisions because different news/listing pages
    // can extract identical site chrome.
    if (input.duplicatePolicy === "fail") {
      try {
        const existing = await documentModule.findWebsiteDuplicate({
          sourceUrl: source.sourceUrl,
          canonicalUrl: source.canonicalUrl,
        });
        if (existing) {
          console.warn(
            `[WebsiteImport] skip DUPLICATE_DOCUMENT url=${source.sourceUrl} ` +
              `existingId=${existing.id} processingStatus=${existing.processingStatus}`
          );
          return {
            skipped: {
              url: source.sourceUrl,
              reason:
                "A matching document already exists in the knowledge library.",
              code: "DUPLICATE_DOCUMENT",
              existingDocuments: [toDocumentSummary(existing)],
            },
          };
        }
      } catch (error) {
        console.warn(
          `[WebsiteImport] duplicate check failed (continuing) url=${source.sourceUrl}`,
          error
        );
      }
    }

    // Prior embed/upload failures leave status=active + processingStatus=failed
    // stubs. Remove them before creating a fresh document so retries succeed.
    try {
      const incomplete = await documentModule.findIncompleteWebsiteDocument({
        sourceUrl: source.sourceUrl,
        canonicalUrl: source.canonicalUrl,
      });
      if (incomplete) {
        console.log(
          `[WebsiteImport] removing incomplete prior doc id=${incomplete.id} ` +
            `processingStatus=${incomplete.processingStatus} url=${source.sourceUrl}`
        );
        await ragModule.deleteDocument(incomplete.id, true);
      }
    } catch (error) {
      console.warn(
        `[WebsiteImport] incomplete cleanup failed (continuing) url=${source.sourceUrl}`,
        error
      );
    }

    // A user title override only applies to single_page; for multi-page imports
    // each document keeps its own scraped page title (PRD §11.4).
    const useUserTitle = input.mode === "single_page";
    const title = useUserTitle ? input.title ?? source.title : source.title;

    try {
      const upload = await ragModule.uploadDocument({
        filePath: source.filePath,
        name: source.fileName,
        title,
        description: buildWebsiteDescription(
          input.description,
          source,
          input.mode
        ),
        tags: buildWebsiteTags(source.sourceUrl, input.tags),
        author: input.author ?? WEBSITE_DEFAULT_AUTHOR,
        sourceType: "webpage",
        sourceUrl: source.sourceUrl,
        canonicalUrl: source.canonicalUrl,
        sourceRootUrl: source.sourceRootUrl,
        importGroupId: source.importGroupId,
        contentSha256: source.contentSha256,
        crawledAt: source.crawledAt,
      });

      console.log(
        `[WebsiteImport] imported url=${source.sourceUrl} ` +
          `documentId=${upload.documentId} chunks=${upload.chunksCreated} ` +
          `ms=${upload.processingTime}`
      );

      return {
        imported: {
          ...toDocumentSummary(upload.document),
          sourceUrl: source.sourceUrl,
          finalUrl: source.finalUrl,
          chunksCreated: upload.chunksCreated,
          processingTimeMs: upload.processingTime,
        },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[WebsiteImport] IMPORT_FAILED url=${source.sourceUrl} reason=${reason}`
      );
      return {
        skipped: {
          url: source.sourceUrl,
          reason: sanitizeReason(reason),
          code: "IMPORT_FAILED",
        },
      };
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

export async function importKnowledgeLibraryWebsiteForAi(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<KnowledgeLibraryWebsiteImportOutcome> {
  return getDefaultTools().importWebsite(args, context);
}

export async function deleteKnowledgeLibraryDocumentForAi(
  args: Record<string, unknown>
): Promise<KnowledgeLibraryDeleteOutcome> {
  return getDefaultTools().deleteDocument(args);
}

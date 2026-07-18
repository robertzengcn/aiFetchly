import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import {
  VectorSearchService,
  SearchResult,
  SearchOptions,
} from "@/service/VectorSearchService";
import { VectorStoreService } from "@/service/VectorStoreService";
import {
  ConfigurationService,
  ConfigurationServiceImpl,
} from "@/modules/ConfigurationService";
import { DocumentService } from "@/service/DocumentService";
import { DocumentUploadOptions } from "@/modules/RAGDocumentModule";
import { ChunkingService } from "@/service/ChunkingService";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";
import {
  RagConfigApi,
  resolveDefaultEmbeddingFromAvailableModels,
} from "@/api/ragConfigApi";
import { EmbeddingProviderFactory } from "@/service/embedding/EmbeddingProviderFactory";
import { EmbeddingRetryService } from "@/service/embedding/EmbeddingRetryService";
import type { EmbeddingProvider } from "@/service/embedding/EmbeddingProvider";
import type { EmbeddingResult } from "@/entityTypes/embeddingTypes";
import {
  LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
  LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
} from "@/service/embedding/LocalEmbeddingModels";
import { isLocalXenovaModel } from "@/service/embedding/EmbeddingModelId";
import { LOCAL_EMBEDDING_MAX_BATCH_SIZE } from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { SystemSettingGroupModule } from "@/modules/SystemSettingGroupModule";
import { app } from "electron";
import { getUserdbpath } from "@/modules/lib/electronfunction";
import {
  KnowledgeSearchRequest,
  KnowledgeSearchToolResult,
  KnowledgeSearchResultItem,
  RagSearchCandidate,
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  MAX_TOOL_CONTENT_CHARS,
  MAX_CHUNK_CONTENT_CHARS,
} from "@/service/RagSearchTypes";
import { RagRerankService } from "@/service/RagRerankService";
import { RAGChunkModule } from "@/modules/RAGChunkModule";
import {
  EmbeddingBillingError,
  isBillingDeniedMessage,
  isEmbeddingBillingError,
} from "@/modules/rag/embeddingErrors";
// import { Token } from "./token";
// import { USERSDBPATH } from "@/config/usersetting";
export interface SearchRequest {
  query: string;
  options?: SearchOptions;
  filters?: {
    documentTypes?: string[];
    dateRange?: { start: Date; end: Date };
    authors?: string[];
    tags?: string[];
  };
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults: number;
  query: string;
  processingTime: number;
  suggestions?: string[];
}

export interface DocumentUploadResponse {
  documentId: number;
  chunksCreated: number;
  processingTime: number;
  document: RAGDocumentEntity;
}

/**
 * RAG Search Module
 *
 * Handles RAG (Retrieval-Augmented Generation) search operations including:
 * - Vector search functionality
 * - Embedding service management
 * - Search analytics and statistics
 * - Document indexing and retrieval
 *
 * Extends BaseModule to inherit database connection management.
 */
/**
 * WS-5 R5.1 — injectable collaborators for {@link RagSearchModule}.
 * Each is optional in the constructor; omitting one yields the real service.
 */
export interface RagSearchModuleDeps {
  searchService: VectorSearchService;
  configurationService: ConfigurationService;
  documentService: DocumentService;
  chunkingService: ChunkingService;
  ragConfigApi: RagConfigApi;
  systemSettingModule: SystemSettingModule;
  systemSettingGroupModule: SystemSettingGroupModule;
}

export class RagSearchModule extends BaseModule {
  private searchService: VectorSearchService;
  private configurationService: ConfigurationService;
  private documentService: DocumentService;
  private chunkingService: ChunkingService;
  private ragConfigApi: RagConfigApi;
  private systemSettingModule: SystemSettingModule;
  private systemSettingGroupModule: SystemSettingGroupModule;

  /**
   * WS-5 R5.1 — collaborators are constructor-injected so unit tests can
   * substitute fakes. Production callers pass no args (real services); tests
   * pass a Partial with the collaborators they fake.
   */
  constructor(deps?: Partial<RagSearchModuleDeps>) {
    super();
    this.searchService =
      deps?.searchService ??
      new VectorSearchService(new VectorStoreService(app.getPath("appData")));
    this.configurationService =
      deps?.configurationService ?? new ConfigurationServiceImpl();
    this.documentService = deps?.documentService ?? new DocumentService();
    this.chunkingService = deps?.chunkingService ?? new ChunkingService();
    this.ragConfigApi = deps?.ragConfigApi ?? new RagConfigApi();
    this.systemSettingModule =
      deps?.systemSettingModule ?? new SystemSettingModule();
    this.systemSettingGroupModule =
      deps?.systemSettingGroupModule ?? new SystemSettingGroupModule();
  }

  /**
   * Initialize the search module
   * No parameters needed - will use remote API for embedding
   */
  async initialize(): Promise<void> {
    try {
      // No local embedding service needed - will use remote API
      log.info("RAG search module initialized successfully (using remote API)");
    } catch (error) {
      log.error("Failed to initialize RAG search module:", error);
      throw new Error("Failed to initialize RAG search module");
    }
  }

  /**
   * Initialize RAG module and ensure default embedding model is ready.
   * Keeps initialization preconditions in module layer.
   */
  async initializeRagModule(): Promise<void> {
    await this.initialize();
    await this.checkAndSetDefaultEmbeddingModel();
  }

  /**
   * Upload and process a document
   * @param options - Document upload options
   * @returns Upload response with processing results
   */
  async uploadDocument(
    options: DocumentUploadOptions
  ): Promise<DocumentUploadResponse> {
    const startTime = Date.now();
    let createdDocument: RAGDocumentEntity | null = null;

    // Ensure we always have a valid default model before uploading.
    await this.checkAndSetDefaultEmbeddingModel();

    // Check if default embedding model exists in system settings
    const defaultEmbeddingModel =
      await this.systemSettingModule.getDefaultEmbeddingModel();
    if (!defaultEmbeddingModel) {
      throw new Error(
        "No default embedding model configured. Please set a default embedding model before uploading documents."
      );
    }

    // Use default embedding model if no modelName is provided
    const modelName = defaultEmbeddingModel.modelName;
    const vectorDimensions = defaultEmbeddingModel.dimension;
    if (!modelName) {
      throw new Error(
        "No embedding model name provided. Cannot process document without an embedding model."
      );
    }
    try {
      // Upload document to database
      const document = await this.documentService.uploadDocument(options);
      createdDocument = document;

      // Update processing status to processing
      await this.documentService.updateDocumentStatus(
        document.id,
        "active",
        "processing"
      );

      // Chunk the document
      const chunks = await this.chunkingService.chunkDocument(document);

      // Generate embeddings. The result carries the FINAL model metadata,
      // which may differ from the requested model when a remote failure forced
      // a local fallback.
      const embeddingResult = await this.generateChunkEmbeddings(
        chunks,
        modelName,
        vectorDimensions
      );

      if (embeddingResult) {
        await this.documentService.updateDocumentMetadata(document.id, {
          vectorIndexPath: embeddingResult.vectorIndexPath,
          modelName: embeddingResult.modelName,
          vectorDimensions: embeddingResult.dimensions,
        });
      }

      // Update processing status to completed
      await this.documentService.updateDocumentStatus(
        document.id,
        "active",
        "completed"
      );

      const processingTime = Date.now() - startTime;

      return {
        documentId: document.id,
        chunksCreated: chunks.length,
        processingTime,
        document,
      };
    } catch (error) {
      log.error("Error uploading document:", error);

      // Update processing status to error if document was created
      if (
        error instanceof Error &&
        error.message.includes("Document with this path already exists")
      ) {
        throw error;
      }

      // Preserve the billing-denied signal so the UI can present a clear,
      // translated message instead of the raw backend string.
      if (error instanceof EmbeddingBillingError) {
        // Still try to mark the document as failed before propagating.
        try {
          const existingDoc =
            createdDocument ||
            (await this.documentService.findDocumentByPath(options.filePath));
          if (existingDoc) {
            await this.documentService.updateDocumentStatus(
              existingDoc.id,
              "active",
              "failed"
            );
          }
        } catch (updateError) {
          log.error("Failed to update document status to error:", updateError);
        }
        throw error;
      }

      // Try to update the created document status. Upload staging changes the
      // persisted filePath, so prefer the captured document id over path lookup.
      try {
        const existingDoc =
          createdDocument ||
          (await this.documentService.findDocumentByPath(options.filePath));
        if (existingDoc) {
          // Save error log for the document
          try {
            await this.documentService.saveErrorLog(
              existingDoc.id,
              error instanceof Error ? error : new Error(String(error)),
              "Document upload failed"
            );
          } catch (logError) {
            log.error("Failed to save error log for document:", logError);
          }

          await this.documentService.updateDocumentStatus(
            existingDoc.id,
            "active",
            "failed"
          );
        }
      } catch (updateError) {
        log.error("Failed to update document status to error:", updateError);
      }

      throw new Error(
        `Document upload failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Result of a chunk-embedding run. Carries the FINAL model metadata, which
   * may differ from the requested model when a remote failure forced a local
   * fallback — callers persist these values onto the document.
   */
  private async generateChunkEmbeddings(
    chunks: RAGChunkEntity[],
    modelName: string,
    dimension: number
  ): Promise<{
    vectorIndexPath: string;
    modelName: string;
    dimensions: number;
  } | null> {
    if (chunks.length === 0) {
      return null;
    }
    const documentId = chunks[0].documentId;
    const factory = new EmbeddingProviderFactory();
    const retryService = new EmbeddingRetryService();
    const provider = factory.create(modelName, dimension);

    const requestedIndexPath =
      this.searchService.vectorStoreService.getDocumentIndexPath(documentId, {
        name: provider.modelName,
        dimensions: provider.dimensions,
      });

    try {
      if (provider.provider === "local-xenova") {
        await this.embedAndStoreChunks(
          chunks,
          (texts: string[]) => provider.embedBatch(texts),
          requestedIndexPath
        );
        log.info(
          `[RagSearchModule] Embedded ${chunks.length} chunks locally for document ${documentId}`
        );
        return {
          vectorIndexPath: requestedIndexPath,
          modelName: provider.modelName,
          dimensions: provider.dimensions,
        };
      }

      // Remote path: retry each batch, fall back to the local model only after
      // retry is exhausted. A document indexing run always finishes with one
      // model so embedding spaces are never mixed.
      try {
        await this.embedAndStoreChunks(
          chunks,
          (texts: string[]) => retryService.embedBatch(provider, texts),
          requestedIndexPath
        );
        log.info(
          `[RagSearchModule] Embedded ${chunks.length} chunks via remote model ${provider.modelName} for document ${documentId}`
        );
        return {
          vectorIndexPath: requestedIndexPath,
          modelName: provider.modelName,
          dimensions: provider.dimensions,
        };
      } catch (remoteError) {
        // Billing/quota denials must surface to the UI as a typed error so the
        // user sees a clear, translated message. Do NOT silently fall back to
        // the local model — the user needs to know their plan limit was hit.
        if (isEmbeddingBillingError(remoteError)) {
          throw remoteError;
        }
        return await this.fallbackToLocalEmbedding(
          chunks,
          documentId,
          provider,
          remoteError
        );
      }
    } catch (error) {
      // Preserve the billing-denied signal unchanged so uploadDocument (and
      // ultimately the UI) can branch on the typed error.
      if (isEmbeddingBillingError(error)) {
        throw error;
      }
      log.error("Error generating embeddings:", error);
      try {
        await this.documentService.saveErrorLog(
          documentId,
          error instanceof Error ? error : new Error(String(error)),
          "Failed to generate embeddings for document chunks"
        );
      } catch (logError) {
        log.error(
          "Failed to save error log during embedding generation:",
          logError
        );
      }
      throw new Error(
        `Failed to generate embeddings: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Best-effort local fallback after remote embedding fails. Clears any partial
   * remote vectors for the document, then re-embeds every chunk with the local
   * free model. If the local provider also fails, the error propagates so the
   * caller marks the document as errored.
   *
   * Note: billing-denied errors are NOT routed here — they surface directly so
   * the UI can present a clear, translated message (see generateChunkEmbeddings).
   */
  private async fallbackToLocalEmbedding(
    chunks: RAGChunkEntity[],
    documentId: number,
    remoteProvider: EmbeddingProvider,
    remoteError: unknown
  ): Promise<{
    vectorIndexPath: string;
    modelName: string;
    dimensions: number;
  }> {
    const remoteFailureMessage =
      remoteError instanceof Error ? remoteError.message : String(remoteError);
    log.warn(
      `[RagSearchModule] Remote embedding failed after retry for document ${documentId}, falling back to local model. Remote error: ${remoteFailureMessage}`
    );

    // Discard any partial remote vectors so the document index is not mixed.
    await this.searchService.vectorStoreService.deleteDocumentIndexByPath(
      documentId,
      {
        name: remoteProvider.modelName,
        dimensions: remoteProvider.dimensions,
      }
    );

    const factory = new EmbeddingProviderFactory();
    const localProvider = factory.create(
      LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      LOCAL_XENOVA_ALL_MINILM_DIMENSIONS
    );
    const localIndexPath =
      this.searchService.vectorStoreService.getDocumentIndexPath(documentId, {
        name: localProvider.modelName,
        dimensions: localProvider.dimensions,
      });

    try {
      await this.embedAndStoreChunks(
        chunks,
        (texts: string[]) => localProvider.embedBatch(texts),
        localIndexPath
      );
    } catch (localError) {
      const localFailureMessage =
        localError instanceof Error ? localError.message : String(localError);
      // Local fallback also failed — record both failures and surface a clear
      // error. Never include document content in the log.
      throw new Error(
        `Embedding generation failed after remote retry and local fallback. ` +
          `Remote model: ${remoteProvider.modelName} (${remoteFailureMessage}). ` +
          `Local model: ${localProvider.modelName} (${localFailureMessage}).`
      );
    }

    log.info(
      `[RagSearchModule] Embedded ${chunks.length} chunks via local fallback for document ${documentId}`
    );
    return {
      vectorIndexPath: localIndexPath,
      modelName: localProvider.modelName,
      dimensions: localProvider.dimensions,
    };
  }

  /**
   * Embed every chunk via the supplied batch function and store the vectors.
   * Chunks are processed in fixed-size batches to bound memory and CPU on the
   * worker / remote API. If embedBatchFn throws, partial vectors from earlier
   * batches may already be stored — the caller (fallback) is responsible for
   * clearing them before retrying with a different provider.
   */
  private async embedAndStoreChunks(
    chunks: RAGChunkEntity[],
    embedBatchFn: (texts: string[]) => Promise<EmbeddingResult[]>,
    vectorIndexPath: string
  ): Promise<void> {
    const batchSize = LOCAL_EMBEDDING_MAX_BATCH_SIZE;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((chunk) => chunk.content);
      const results = await embedBatchFn(texts);
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const result = results[j];
        if (!result) {
          throw new Error(
            `Embedding provider returned no result for chunk index ${i + j}`
          );
        }
        await this.searchService.vectorStoreService.storeEmbedding({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          content: chunk.content,
          embedding: result.embedding,
          model: result.model,
          dimensions: result.dimensions,
          metadata: {
            chunkIndex: chunk.chunkIndex,
            pageNumber: chunk.pageNumber,
          },
          vectorIndexPath: vectorIndexPath,
        });
      }
    }
  }

  /**
   * Perform a search
   * @param request - Search request
   * @returns Search response
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    const startTime = Date.now();

    try {
      let results: SearchResult[];

      if (request.filters) {
        results = await this.searchService.searchWithFilters(
          request.query,
          request.filters,
          request.options
        );
      } else {
        results = await this.searchService.search(
          request.query,
          request.options
        );
      }

      const processingTime = Date.now() - startTime;

      // Get search suggestions
      const suggestions = await this.searchService.getSearchSuggestions(
        request.query,
        5
      );

      return {
        results,
        totalResults: results.length,
        query: request.query,
        processingTime,
        suggestions,
      };
    } catch (error) {
      log.error("RAG search failed:", error);
      throw new Error(
        `RAG search failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get search suggestions
   * @param query - Partial query
   * @param limit - Number of suggestions
   * @returns Array of suggestions
   */
  async getSuggestions(query: string, limit = 5): Promise<string[]> {
    try {
      return await this.searchService.getSearchSuggestions(query, limit);
    } catch (error) {
      log.error("Failed to get suggestions:", error);
      return [];
    }
  }

  /**
   * Get search analytics
   * @returns Search analytics
   */
  async getAnalytics(): Promise<any> {
    try {
      return await this.searchService.getSearchAnalytics();
    } catch (error) {
      log.error("Failed to get analytics:", error);
      throw new Error("Failed to get search analytics");
    }
  }

  /**
   * Get performance metrics
   * @returns Performance metrics
   */
  getPerformanceMetrics(): any {
    return this.searchService.getPerformanceMetrics();
  }

  /**
   * Clear search cache
   */
  clearCache(): void {
    this.searchService.clearCache();
  }

  /**
   * Test embedding service using remote API
   * @returns Test result
   */
  async testEmbeddingService(): Promise<{
    success: boolean;
    message: string;
    dimensions?: number;
  }> {
    try {
      const testText = "This is a test embedding";
      const modelName = "text-embedding-3-small";
      const response = await this.ragConfigApi.generateEmbedding(
        [testText],
        modelName
      );

      if (!response.status || !response.data) {
        return {
          success: false,
          message: `Remote embedding API failed: ${
            response.msg || "Unknown error"
          }`,
        };
      }

      return {
        success: true,
        message: "Remote embedding API working correctly",
        dimensions: response.data.length,
      };
    } catch (error) {
      return {
        success: false,
        message: `Embedding service test failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Get search statistics
   * @returns Search statistics
   */
  async getSearchStats(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    indexSize: number;
    averageChunkSize: number;
    embeddingModel: string;
    embeddingProvider: string;
  }> {
    try {
      const analytics = await this.getAnalytics();

      return {
        totalDocuments: analytics.totalDocuments,
        totalChunks: analytics.totalChunks,
        indexSize: analytics.indexStats.totalVectors,
        averageChunkSize: analytics.averageChunkSize,
        embeddingModel: "Remote API",
        embeddingProvider: "Remote API",
      };
    } catch (error) {
      log.error("Failed to get search stats:", error);
      throw new Error("Failed to get search statistics");
    }
  }

  /**
   * Get all documents with optional filtering
   * @param filters - Optional filters
   * @returns Array of documents
   */
  async getDocuments(filters?: {
    status?: string;
    processingStatus?: string;
    author?: string;
    tags?: string[];
    dateRange?: { start: Date; end: Date };
  }): Promise<RAGDocumentEntity[]> {
    try {
      return await this.documentService.getDocuments(filters);
    } catch (error) {
      log.error("Failed to get documents:", error);
      throw new Error("Failed to retrieve documents");
    }
  }

  /**
   * Get a specific document by ID
   * @param id - Document ID
   * @returns Document entity
   */
  async getDocument(id: number): Promise<RAGDocumentEntity | null> {
    try {
      return await this.documentService.findDocumentById(id);
    } catch (error) {
      log.error("Failed to get document:", error);
      throw new Error("Failed to retrieve document");
    }
  }

  /**
   * Update document metadata
   * @param id - Document ID
   * @param metadata - Updated metadata
   */
  async updateDocument(
    id: number,
    metadata: {
      title?: string;
      description?: string;
      tags?: string[];
      author?: string;
      log?: string;
    }
  ): Promise<void> {
    try {
      await this.documentService.updateDocumentMetadata(id, metadata);
    } catch (error) {
      log.error("Failed to update document:", error);
      throw new Error("Failed to update document");
    }
  }

  /**
   * Save error log for a document
   * @param documentId - Document ID
   * @param error - Error object or error message
   * @param context - Additional context about the error
   * @returns Path to the created error log file
   */
  async saveDocumentErrorLog(
    documentId: number,
    error: Error | string,
    context?: string
  ): Promise<string> {
    try {
      return await this.documentService.saveErrorLog(
        documentId,
        error,
        context
      );
    } catch (logError) {
      log.error("Failed to save document error log:", logError);
      throw new Error("Failed to save document error log");
    }
  }

  /**
   * Get document error log content
   * @param documentId - Document ID
   * @returns Error log content or null if no log exists
   */
  async getDocumentErrorLog(documentId: number): Promise<string | null> {
    try {
      return await this.documentService.getDocumentErrorLog(documentId);
    } catch (error) {
      log.error("Failed to get document error log:", error);
      throw new Error("Failed to get document error log");
    }
  }

  /**
   * Delete a document and its associated vector index
   * @param id - Document ID
   * @param deleteFile - Whether to delete the physical file
   * @returns Promise that resolves to true if deletion was successful, false otherwise
   */
  async deleteDocument(id: number, deleteFile = false): Promise<boolean> {
    try {
      // Delete the document from the database
      // Note: RAGDocumentModule handles deleting the vector index file using the stored vectorIndexPath
      const success = await this.documentService.deleteDocument(id, deleteFile);
      if (success) {
        log.info(`Deleted document ${id} from database`);
      } else {
        log.warn(`Failed to delete document ${id} from database`);
      }
      return success;
    } catch (error) {
      log.error("Failed to delete document:", error);
      return false;
    }
  }

  /**
   * Get document statistics
   * @returns Document statistics
   */
  async getDocumentStats(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    totalSize: number;
    averageSize: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  }> {
    try {
      const stats = await this.documentService.getDocumentStats();

      // Transform the stats to match expected interface
      return {
        totalDocuments: stats.total,
        totalChunks: 0, // TODO: Get actual chunk count
        totalSize: stats.totalSize,
        averageSize: stats.total > 0 ? stats.totalSize / stats.total : 0,
        byStatus: stats.byStatus,
        byType: stats.byFileType,
      };
    } catch (error) {
      log.error("Failed to get document stats:", error);
      throw new Error("Failed to retrieve document statistics");
    }
  }

  /**
   * Chunk a document into smaller pieces
   * @param documentId - Document ID to chunk
   * @param options - Chunking options
   * @returns Chunking result
   */
  async chunkDocument(
    documentId: number,
    options?: {
      chunkSize?: number;
      overlapSize?: number;
      strategy?: "sentence" | "paragraph" | "semantic" | "fixed";
      preserveWhitespace?: boolean;
      minChunkSize?: number;
    }
  ): Promise<{
    documentId: number;
    chunksCreated: number;
    processingTime: number;
    success: boolean;
    message: string;
  }> {
    const startTime = Date.now();

    try {
      // Get document
      const document = await this.documentService.findDocumentById(documentId);
      if (!document) {
        return {
          documentId,
          chunksCreated: 0,
          processingTime: Date.now() - startTime,
          success: false,
          message: "Document not found",
        };
      }

      // Update processing status
      await this.documentService.updateDocumentStatus(
        documentId,
        "active",
        "processing"
      );

      // Chunk the document
      const chunks = await this.chunkingService.chunkDocument(
        document,
        options
      );

      // Update processing status to completed
      await this.documentService.updateDocumentStatus(
        documentId,
        "active",
        "completed"
      );

      const processingTime = Date.now() - startTime;

      return {
        documentId,
        chunksCreated: chunks.length,
        processingTime,
        success: true,
        message: `Document chunked successfully into ${chunks.length} chunks`,
      };
    } catch (error) {
      log.error("Error chunking document:", error);

      // Update processing status to error
      try {
        await this.documentService.updateDocumentStatus(
          documentId,
          "active",
          "error"
        );
      } catch (updateError) {
        log.error("Failed to update document status to error:", updateError);
      }

      return {
        documentId,
        chunksCreated: 0,
        processingTime: Date.now() - startTime,
        success: false,
        message: `Document chunking failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Generate embeddings for document chunks
   * @param documentId - Document ID to generate embeddings for
   * @returns Embedding generation result
   */
  async generateDocumentEmbeddings(
    documentId: number,
    modelName: string,
    dimension: number
  ): Promise<{
    documentId: number;
    chunksProcessed: number;
    processingTime: number;
    success: boolean;
    message: string;
  }> {
    const startTime = Date.now();

    try {
      // Get document chunks
      const chunks = await this.chunkingService.getDocumentChunks(documentId);
      if (chunks.length === 0) {
        return {
          documentId,
          chunksProcessed: 0,
          processingTime: Date.now() - startTime,
          success: false,
          message: "No chunks found for document",
        };
      }

      // Check if chunks already have embeddings
      const chunksWithoutEmbeddings = chunks.filter(
        (chunk) => !chunk.embeddingId
      );
      if (chunksWithoutEmbeddings.length === 0) {
        return {
          documentId,
          chunksProcessed: 0,
          processingTime: Date.now() - startTime,
          success: true,
          message: "All chunks already have embeddings",
        };
      }

      // Generate embeddings. The result carries the FINAL model metadata,
      // which may differ from the requested model after a local fallback.
      const embeddingResult = await this.generateChunkEmbeddings(
        chunksWithoutEmbeddings,
        modelName,
        dimension
      );

      // Save final vector index path and model metadata to document entity
      if (embeddingResult) {
        await this.documentService.updateDocumentMetadata(documentId, {
          vectorIndexPath: embeddingResult.vectorIndexPath,
          modelName: embeddingResult.modelName,
          vectorDimensions: embeddingResult.dimensions,
        });
        log.info(
          `Saved vector index path to document ${documentId}: ${embeddingResult.vectorIndexPath}`
        );
      }

      const processingTime = Date.now() - startTime;

      return {
        documentId,
        chunksProcessed: chunksWithoutEmbeddings.length,
        processingTime,
        success: true,
        message: `Generated embeddings for ${chunksWithoutEmbeddings.length} chunks`,
      };
    } catch (error) {
      log.error("Error generating document embeddings:", error);
      return {
        documentId,
        chunksProcessed: 0,
        processingTime: Date.now() - startTime,
        success: false,
        message: `Failed to generate embeddings: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Update the embedding model
   * @param modelName - Name of the model to switch to
   */
  async updateEmbeddingModel(modelName: string): Promise<void> {
    try {
      // Update the configuration service with the new model
      // This will affect future embedding generations
      log.info(`Updating embedding model to: ${modelName}`);

      // For now, we'll just log the change since the actual model switching
      // is handled by the remote API configuration
      // In a more complex implementation, this could:
      // 1. Update local configuration
      // 2. Clear existing embeddings if needed
      // 3. Reinitialize embedding services

      log.info(`Embedding model updated to: ${modelName}`);
    } catch (error) {
      log.error("Error updating embedding model:", error);
      throw new Error(
        `Failed to update embedding model: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Save default embedding model to system settings.
   * @param modelName - Name of the embedding model
   * @param dimension - Vector dimension for the model
   */
  async saveDefaultEmbeddingModelToSettings(
    modelName: string,
    dimension: number
  ): Promise<void> {
    try {
      const embeddingGroup =
        await this.systemSettingGroupModule.getOrCreateEmbeddingGroup();
      await this.systemSettingModule.updateDefaultEmbeddingModel(
        modelName,
        dimension,
        embeddingGroup
      );
      log.info(
        `Default embedding model saved to settings: ${modelName}:${dimension}`
      );
    } catch (error) {
      log.error("Error saving default embedding model to settings:", error);
      // Do not throw to avoid breaking model update flow.
    }
  }

  /**
   * Get default embedding model from system settings.
   * @returns Default embedding model configuration or null when unavailable
   */
  async getDefaultEmbeddingModel(): Promise<{
    modelName: string;
    dimension: number;
  } | null> {
    try {
      return await this.systemSettingModule.getDefaultEmbeddingModel();
    } catch (error) {
      log.warn(
        "Could not retrieve default embedding model from settings:",
        error
      );
      return null;
    }
  }

  /**
   * Check if default embedding model exists in system settings,
   * if not, fetch it from API and update the setting.
   * If it exists, validate that it's still in the available models list.
   */
  async checkAndSetDefaultEmbeddingModel(): Promise<void> {
    try {
      const embeddingGroup =
        await this.systemSettingGroupModule.getOrCreateEmbeddingGroup();
      const defaultEmbeddingModel =
        await this.systemSettingModule.getDefaultEmbeddingModel();

      // A locally-configured model (e.g. local-xenova:Xenova/all-MiniLM-L6-v2)
      // runs on-device and is never advertised by the remote model API. Treat it
      // as always available so the remote availability check below does not
      // overwrite the user's selection with the remote default model.
      if (
        defaultEmbeddingModel &&
        isLocalXenovaModel(defaultEmbeddingModel.modelName)
      ) {
        return;
      }

      if (!defaultEmbeddingModel) {
        log.info(
          "Default embedding model not found in system settings, fetching from API..."
        );

        const modelsResponse =
          await this.ragConfigApi.getAvailableEmbeddingModels();

        if (modelsResponse.status && modelsResponse.data) {
          const resolved = resolveDefaultEmbeddingFromAvailableModels(
            modelsResponse.data
          );
          if (!resolved) {
            log.warn(
              "Could not resolve default embedding model and dimension from API response"
            );
            return;
          }
          log.info(
            `Setting default embedding model to: ${resolved.modelName}:${resolved.dimension}`
          );

          await this.systemSettingModule.updateDefaultEmbeddingModel(
            resolved.modelName,
            resolved.dimension,
            embeddingGroup
          );
          log.info("Default embedding model updated successfully");
        } else {
          log.warn(
            "Failed to fetch available models from API, unable to auto-set default model"
          );
        }
        return;
      }

      try {
        const modelsResponse =
          await this.ragConfigApi.getAvailableEmbeddingModels();

        if (modelsResponse.status && modelsResponse.data) {
          const availableModels = modelsResponse.data.models;
          const resolved = resolveDefaultEmbeddingFromAvailableModels(
            modelsResponse.data
          );
          const isCurrentModelAvailable = Object.keys(availableModels).includes(
            defaultEmbeddingModel.modelName
          );

          if (!isCurrentModelAvailable) {
            if (!resolved) {
              log.warn(
                "Current default model unavailable and API did not return a resolvable default"
              );
              return;
            }
            log.info(
              `Current default embedding model '${defaultEmbeddingModel.modelName}' is not available`
            );
            log.info(
              `Updating to new default model: ${resolved.modelName}:${resolved.dimension}`
            );

            await this.systemSettingModule.updateDefaultEmbeddingModel(
              resolved.modelName,
              resolved.dimension,
              embeddingGroup
            );
            log.info("Default embedding model updated to available model");
          }
        } else {
          log.warn(
            "Failed to fetch available models for validation, keeping current model"
          );
        }
      } catch (validationError) {
        log.warn(
          "Error validating default embedding model availability:",
          validationError
        );
        log.info(
          "Keeping current default embedding model due to validation error"
        );
      }
    } catch (error) {
      log.error("Error checking/setting default embedding model:", error);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    try {
      // Cleanup logic here if needed
      log.info("RAG search module cleaned up");
    } catch (error) {
      log.error("Error during cleanup:", error);
    }
  }

  // ---------------------------------------------------------------------------
  // Knowledge Library Search Tool (AI-callable)
  // ---------------------------------------------------------------------------

  /**
   * Execute the knowledge-library search pipeline for the AI tool.
   *
   * Flow: validate → filter → hybrid search → rerank → expand neighbors →
   *       trim to budget → return structured result with citations.
   */
  async searchKnowledgeForTool(
    request: KnowledgeSearchRequest
  ): Promise<KnowledgeSearchToolResult> {
    const totalStart = Date.now();
    const vectorStart = Date.now();
    const keywordMs = 0;
    let rerankMs = 0;

    try {
      // 1. Validate and clamp inputs
      if (
        !request.query ||
        typeof request.query !== "string" ||
        request.query.trim().length === 0
      ) {
        return {
          success: false,
          query: "",
          totalCandidates: 0,
          rerankUsed: false,
          truncated: false,
          warning: "Query is required and must be a non-empty string.",
          results: [],
        };
      }

      const limit = Math.max(
        1,
        Math.min(
          typeof request.limit === "number"
            ? request.limit
            : DEFAULT_RESULT_LIMIT,
          MAX_RESULT_LIMIT
        )
      );

      // 2. Resolve allowed document IDs from metadata filters
      const allowedDocIds = await this.resolveAllowedDocumentIds(request);

      // 3. Collect hybrid candidates
      const candidates = await this.searchService.searchCandidates(
        request.query,
        {
          documentIds:
            allowedDocIds && allowedDocIds.length > 0
              ? allowedDocIds
              : undefined,
        }
      );

      const searchMs = Date.now() - vectorStart;

      const totalCandidates = candidates.length;

      if (totalCandidates === 0) {
        return {
          success: true,
          query: request.query,
          totalCandidates: 0,
          rerankUsed: false,
          truncated: false,
          results: [],
          timing: {
            vectorMs: searchMs,
            keywordMs: 0,
            rerankMs: 0,
            totalMs: Date.now() - totalStart,
          },
        };
      }

      // 4. Rerank
      const rerankService = new RagRerankService();
      const rerankOutcome = await rerankService.rerank(
        request.query,
        candidates,
        limit
      );
      rerankMs = rerankOutcome.rerankMs;

      const rankedCandidates = rerankOutcome.ranked.slice(0, limit);

      // 5. Expand neighbors (when requested)
      const includeNeighbors = request.includeNeighborChunks !== false;
      const resultItems: KnowledgeSearchResultItem[] = [];

      if (includeNeighbors) {
        const chunkModule = new RAGChunkModule();
        const expandedChunkIds = new Set<number>();

        for (const candidate of rankedCandidates) {
          // Direct match
          const directItem = this.candidateToResultItem(candidate, "direct");
          resultItems.push(directItem);
          expandedChunkIds.add(candidate.chunkId);

          // Neighbor expansion
          try {
            const neighbors = await chunkModule.getNeighborChunks(
              candidate.chunkId,
              1
            );

            for (const prev of neighbors.previous) {
              if (!expandedChunkIds.has(prev.chunkId)) {
                expandedChunkIds.add(prev.chunkId);
                resultItems.push({
                  citation: `[doc:${candidate.documentId} chunk:${prev.chunkIndex} ${candidate.document.name}]`,
                  documentId: candidate.documentId,
                  documentName: candidate.document.name,
                  title: candidate.document.title,
                  fileType: candidate.document.fileType,
                  chunkId: prev.chunkId,
                  chunkIndex: prev.chunkIndex,
                  score: candidate.combinedScore,
                  rerankScore: candidate.rerankScore,
                  content: prev.content.slice(0, MAX_CHUNK_CONTENT_CHARS),
                  matchType: "neighbor",
                });
              }
            }

            for (const next of neighbors.next) {
              if (!expandedChunkIds.has(next.chunkId)) {
                expandedChunkIds.add(next.chunkId);
                resultItems.push({
                  citation: `[doc:${candidate.documentId} chunk:${next.chunkIndex} ${candidate.document.name}]`,
                  documentId: candidate.documentId,
                  documentName: candidate.document.name,
                  title: candidate.document.title,
                  fileType: candidate.document.fileType,
                  chunkId: next.chunkId,
                  chunkIndex: next.chunkIndex,
                  score: candidate.combinedScore,
                  rerankScore: candidate.rerankScore,
                  content: next.content.slice(0, MAX_CHUNK_CONTENT_CHARS),
                  matchType: "neighbor",
                });
              }
            }
          } catch (neighborError) {
            log.warn(
              `Failed to expand neighbors for chunk ${candidate.chunkId}:`,
              neighborError
            );
          }
        }
      } else {
        for (const candidate of rankedCandidates) {
          resultItems.push(this.candidateToResultItem(candidate, "direct"));
        }
      }

      // 6. Trim to content budget
      let totalContentChars = 0;
      let truncated = false;
      const trimmedItems: KnowledgeSearchResultItem[] = [];

      for (const item of resultItems) {
        const contentChars = Math.min(
          item.content.length,
          MAX_CHUNK_CONTENT_CHARS
        );
        if (totalContentChars + contentChars > MAX_TOOL_CONTENT_CHARS) {
          truncated = true;
          break;
        }
        trimmedItems.push({
          ...item,
          content:
            contentChars < item.content.length
              ? item.content.slice(0, contentChars) + "... [truncated]"
              : item.content,
        });
        totalContentChars += contentChars;
      }

      const totalMs = Date.now() - totalStart;

      return {
        success: true,
        query: request.query,
        totalCandidates,
        rerankUsed: rerankOutcome.rerankUsed,
        truncated,
        warning: rerankOutcome.warning,
        results: trimmedItems,
        timing: { vectorMs: searchMs, keywordMs, rerankMs, totalMs },
      };
    } catch (error) {
      log.error("Knowledge search tool failed:", error);
      return {
        success: false,
        query: request.query,
        totalCandidates: 0,
        rerankUsed: false,
        truncated: false,
        warning: `Search failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        results: [],
      };
    }
  }

  /**
   * Resolve which document IDs are allowed given the metadata filters in
   * the tool request. Returns undefined when no filters are specified
   * (meaning all documents are allowed).
   */
  private async resolveAllowedDocumentIds(
    request: KnowledgeSearchRequest
  ): Promise<number[] | undefined> {
    const hasFilters =
      (request.documentIds && request.documentIds.length > 0) ||
      (request.documentTypes && request.documentTypes.length > 0) ||
      (request.tags && request.tags.length > 0) ||
      request.author ||
      request.dateRange;

    if (!hasFilters) {
      return undefined;
    }

    // If only documentIds are specified, use them directly
    if (
      request.documentIds &&
      request.documentIds.length > 0 &&
      !request.documentTypes &&
      !request.tags &&
      !request.author &&
      !request.dateRange
    ) {
      return request.documentIds;
    }

    // Otherwise, query documents with filters
    try {
      const documents = await this.documentService.getDocuments({
        status: "active",
        processingStatus: "completed",
      });

      let filtered = documents;

      if (request.documentIds && request.documentIds.length > 0) {
        const idSet = new Set(request.documentIds);
        filtered = filtered.filter((d) => idSet.has(d.id));
      }

      if (request.documentTypes && request.documentTypes.length > 0) {
        const types = new Set(request.documentTypes);
        filtered = filtered.filter((d) => types.has(d.fileType));
      }

      if (request.tags && request.tags.length > 0) {
        filtered = filtered.filter((d) => {
          if (!d.tags) return false;
          try {
            const docTags = JSON.parse(d.tags) as string[];
            return request.tags!.some((t) => docTags.includes(t));
          } catch {
            return false;
          }
        });
      }

      if (request.author) {
        const authorLower = request.author.toLowerCase();
        filtered = filtered.filter(
          (d) => d.author && d.author.toLowerCase().includes(authorLower)
        );
      }

      if (request.dateRange) {
        const start = new Date(request.dateRange.start);
        const end = new Date(request.dateRange.end);
        filtered = filtered.filter((d) => {
          const uploaded = d.uploadedAt ? new Date(d.uploadedAt) : null;
          return uploaded && uploaded >= start && uploaded <= end;
        });
      }

      return filtered.map((d) => d.id);
    } catch (error) {
      log.warn("Failed to resolve document filters:", error);
      return undefined;
    }
  }

  /**
   * Convert a candidate to a tool result item.
   */
  private candidateToResultItem(
    candidate: RagSearchCandidate,
    matchType: "direct" | "neighbor"
  ): KnowledgeSearchResultItem {
    return {
      citation: `[doc:${candidate.documentId} chunk:${candidate.metadata.chunkIndex} ${candidate.document.name}]`,
      documentId: candidate.documentId,
      documentName: candidate.document.name,
      title: candidate.document.title,
      fileType: candidate.document.fileType,
      chunkId: candidate.chunkId,
      chunkIndex: candidate.metadata.chunkIndex,
      score: candidate.combinedScore,
      rerankScore: candidate.rerankScore,
      content: candidate.content.slice(0, MAX_CHUNK_CONTENT_CHARS),
      matchType,
    };
  }
}

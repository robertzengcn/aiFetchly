import { BaseModule } from "@/modules/baseModule";
import { VectorSearchService, SearchResult, SearchOptions } from '@/service/VectorSearchService';
import { VectorStoreService } from '@/service/VectorStoreService';
import { ConfigurationService, ConfigurationServiceImpl } from '@/modules/ConfigurationService';
import { DocumentService } from '@/service/DocumentService';
import { DocumentUploadOptions } from '@/modules/RAGDocumentModule';
import { ChunkingService } from '@/service/ChunkingService';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { RagConfigApi } from '@/api/ragConfigApi';
import { SystemSettingModule } from '@/modules/SystemSettingModule';
import { app } from 'electron';
import {getUserdbpath} from "@/modules/lib/electronfunction"
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
export class RagSearchModule extends BaseModule {
    private searchService: VectorSearchService;
    private configurationService: ConfigurationService;
    private documentService: DocumentService;
    private chunkingService: ChunkingService;
    private ragConfigApi: RagConfigApi;
    private systemSettingModule: SystemSettingModule;

    constructor() {
        super();
        //get user data path
        // const tokenService = new Token()
        // const userdataPath = tokenService.getValue(USERSDBPATH)
        // Initialize services with database
        // const dbPath = getUserdbpath();
        const vectorStoreService = new VectorStoreService();
        this.searchService = new VectorSearchService(vectorStoreService);
        this.configurationService = new ConfigurationServiceImpl();
        this.documentService = new DocumentService();
        this.chunkingService = new ChunkingService();
        this.ragConfigApi = new RagConfigApi();
        this.systemSettingModule = new SystemSettingModule();
    }

    /**
     * Initialize the search module
     * No parameters needed - will use remote API for embedding
     */
    async initialize(): Promise<void> {
        try {
            // No local embedding service needed - will use remote API
            console.log('RAG search module initialized successfully (using remote API)');
        } catch (error) {
            console.error('Failed to initialize RAG search module:', error);
            throw new Error('Failed to initialize RAG search module');
        }
    }


    /**
     * Upload and process a document
     * @param options - Document upload options
     * @returns Upload response with processing results
     */
    async uploadDocument(options: DocumentUploadOptions): Promise<DocumentUploadResponse> {
        const startTime = Date.now();
        
        // Check if default embedding model exists in system settings
        const defaultEmbeddingModel = await this.systemSettingModule.getDefaultEmbeddingModel();
        if (!defaultEmbeddingModel) {
            throw new Error('No default embedding model configured. Please set a default embedding model before uploading documents.');
        }
        
        // Use default embedding model if no modelName is provided
        const modelName =  defaultEmbeddingModel.modelName;
        const vectorDimensions = defaultEmbeddingModel.dimension;
        if (!modelName) {
            throw new Error('No embedding model name provided. Cannot process document without an embedding model.');
        }
        try {
            // Upload document to database
            const document = await this.documentService.uploadDocument(options);

            // Update processing status to processing
            await this.documentService.updateDocumentStatus(
                document.id,
                 'active',
                'processing'
            );

            // Chunk the document
            const chunks = await this.chunkingService.chunkDocument(document);

            // Generate embeddings for chunks using remote API
            const vectorIndexPath =await this.generateChunkEmbeddings(chunks, modelName);

            if (vectorIndexPath) {
                await this.documentService.updateDocumentMetadata(document.id, {
                    vectorIndexPath:vectorIndexPath,
                    modelName: modelName,
                    vectorDimensions: vectorDimensions
                });
            }

            // Update processing status to completed
            await this.documentService.updateDocumentStatus(
                 document.id,
                'active',
                'completed'
            );

            const processingTime = Date.now() - startTime;

            return {
                documentId: document.id,
                chunksCreated: chunks.length,
                processingTime,
                document
            };
        } catch (error) {
            console.error('Error uploading document:', error);
            
            // Update processing status to error if document was created
            if (error instanceof Error && error.message.includes('Document with this path already exists')) {
                throw error;
            }
            
            // Try to find the document and update its status
            try {
                const existingDoc = await this.documentService.findDocumentByPath(options.filePath);
                if (existingDoc) {
                    // Save error log for the document
                    try {
                        await this.documentService.saveErrorLog(
                            existingDoc.id,
                            error instanceof Error ? error : new Error(String(error)),
                            'Document upload failed'
                        );
                    } catch (logError) {
                        console.error('Failed to save error log for document:', logError);
                    }
                    
                    await this.documentService.updateDocumentStatus(
                        existingDoc.id,
                        'active',
                        'error'
                    );
                }
            } catch (updateError) {
                console.error('Failed to update document status to error:', updateError);
            }
            
            throw new Error(`Document upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generate embeddings for document chunks using remote API
     * @param chunks - Array of chunk entities
     */
    private async generateChunkEmbeddings(chunks: RAGChunkEntity[], modelName: string): Promise<string | null> {
        try {
            if (chunks.length === 0) {
                return null;
            }

            const documentId = chunks[0].documentId;
            let vectorIndexPath: string | null = null;
            
            for (const chunk of chunks) {
                // Generate embedding for chunk content using remote API
                const response = await this.ragConfigApi.generateEmbedding([chunk.content], modelName);
                
                if (!response.status || !response.data) {
                    throw new Error(`Failed to get embedding: ${response.msg || 'Unknown error'}`);
                }
                
                const embeddingResult = response.data[0];
                
                // Store embedding in document-specific vector store with model information
                await this.searchService.vectorStoreService.storeEmbedding({
                    chunkId: chunk.id,
                    documentId: chunk.documentId,
                    content: chunk.content,
                    embedding: embeddingResult.embedding,
                    model: embeddingResult.model,
                    dimensions: embeddingResult.dimensions,
                    metadata: {
                        chunkIndex: chunk.chunkIndex,
                        pageNumber: chunk.pageNumber
                    }
                });
                
                // Get the vector index path (only need to do this once)
                if (!vectorIndexPath) {
                    vectorIndexPath = this.searchService.vectorStoreService.getDocumentIndexPath(
                        documentId,
                        {
                            modelId: embeddingResult.model,
                            dimensions: embeddingResult.dimensions
                        }
                    );
                }
            }
            
            console.log(`Generated embeddings for ${chunks.length} chunks using remote API for document ${documentId}`);
            console.log('vectorIndexPath', vectorIndexPath);
            return vectorIndexPath;
        } catch (error) {
            console.error('Error generating embeddings:', error);
            
            // Try to save error log for the document
            try {
                const documentId = chunks[0]?.documentId;
                if (documentId) {
                    await this.documentService.saveErrorLog(
                        documentId,
                        error instanceof Error ? error : new Error(String(error)),
                        'Failed to generate embeddings for document chunks'
                    );
                }
            } catch (logError) {
                console.error('Failed to save error log during embedding generation:', logError);
            }
            
            throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                suggestions
            };
        } catch (error) {
            console.error('RAG search failed:', error);
            throw new Error(`RAG search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get search suggestions
     * @param query - Partial query
     * @param limit - Number of suggestions
     * @returns Array of suggestions
     */
    async getSuggestions(query: string, limit: number = 5): Promise<string[]> {
        try {
            return await this.searchService.getSearchSuggestions(query, limit);
        } catch (error) {
            console.error('Failed to get suggestions:', error);
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
            console.error('Failed to get analytics:', error);
            throw new Error('Failed to get search analytics');
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
            const testText = 'This is a test embedding';
            const modelName = 'text-embedding-3-small';
            const response = await this.ragConfigApi.generateEmbedding([testText], modelName);

            if (!response.status || !response.data) {
                return {
                    success: false,
                    message: `Remote embedding API failed: ${response.msg || 'Unknown error'}`
                };
            }

            return {
                success: true,
                message: 'Remote embedding API working correctly',
                dimensions: response.data.length
            };
        } catch (error) {
            return {
                success: false,
                message: `Embedding service test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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
                embeddingModel: 'Remote API',
                embeddingProvider: 'Remote API'
            };
        } catch (error) {
            console.error('Failed to get search stats:', error);
            throw new Error('Failed to get search statistics');
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
            console.error('Failed to get documents:', error);
            throw new Error('Failed to retrieve documents');
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
            console.error('Failed to get document:', error);
            throw new Error('Failed to retrieve document');
        }
    }

    /**
     * Update document metadata
     * @param id - Document ID
     * @param metadata - Updated metadata
     */
    async updateDocument(id: number, metadata: {
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
        log?: string;
    }): Promise<void> {
        try {
            await this.documentService.updateDocumentMetadata(id, metadata);
        } catch (error) {
            console.error('Failed to update document:', error);
            throw new Error('Failed to update document');
        }
    }

    /**
     * Save error log for a document
     * @param documentId - Document ID
     * @param error - Error object or error message
     * @param context - Additional context about the error
     * @returns Path to the created error log file
     */
    async saveDocumentErrorLog(documentId: number, error: Error | string, context?: string): Promise<string> {
        try {
            return await this.documentService.saveErrorLog(documentId, error, context);
        } catch (logError) {
            console.error('Failed to save document error log:', logError);
            throw new Error('Failed to save document error log');
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
            console.error('Failed to get document error log:', error);
            throw new Error('Failed to get document error log');
        }
    }

    /**
     * Delete a document and its associated vector index
     * @param id - Document ID
     * @param deleteFile - Whether to delete the physical file
     */
    async deleteDocument(id: number, deleteFile: boolean = false): Promise<void> {
        try {
            // Delete the document from the database
            // Note: RAGDocumentModule handles deleting the vector index file using the stored vectorIndexPath
            await this.documentService.deleteDocument(id, deleteFile);
            console.log(`Deleted document ${id} from database`);
        } catch (error) {
            console.error('Failed to delete document:', error);
            throw new Error('Failed to delete document');
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
                byType: stats.byFileType
            };
        } catch (error) {
            console.error('Failed to get document stats:', error);
            throw new Error('Failed to retrieve document statistics');
        }
    }

    /**
     * Chunk a document into smaller pieces
     * @param documentId - Document ID to chunk
     * @param options - Chunking options
     * @returns Chunking result
     */
    async chunkDocument(documentId: number, options?: {
        chunkSize?: number;
        overlapSize?: number;
        strategy?: 'sentence' | 'paragraph' | 'semantic' | 'fixed';
        preserveWhitespace?: boolean;
        minChunkSize?: number;
    }): Promise<{
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
                    message: 'Document not found'
                };
            }

            // Update processing status
            await this.documentService.updateDocumentStatus(
                documentId,
                'active',
                'processing'
            );

            // Chunk the document
            const chunks = await this.chunkingService.chunkDocument(document, options);

            // Update processing status to completed
            await this.documentService.updateDocumentStatus(
                documentId,
                'active',
                'completed'
            );

            const processingTime = Date.now() - startTime;

            return {
                documentId,
                chunksCreated: chunks.length,
                processingTime,
                success: true,
                message: `Document chunked successfully into ${chunks.length} chunks`
            };
        } catch (error) {
            console.error('Error chunking document:', error);
            
            // Update processing status to error
            try {
                await this.documentService.updateDocumentStatus(
                    documentId,
                    'active',
                    'error'
                );
            } catch (updateError) {
                console.error('Failed to update document status to error:', updateError);
            }

            return {
                documentId,
                chunksCreated: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Document chunking failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Generate embeddings for document chunks
     * @param documentId - Document ID to generate embeddings for
     * @returns Embedding generation result
     */
    async generateDocumentEmbeddings(documentId: number, modelName: string,dimension: number): Promise<{
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
                    message: 'No chunks found for document'
                };
            }

            // Check if chunks already have embeddings
            const chunksWithoutEmbeddings = chunks.filter(chunk => !chunk.embeddingId);
            if (chunksWithoutEmbeddings.length === 0) {
                return {
                    documentId,
                    chunksProcessed: 0,
                    processingTime: Date.now() - startTime,
                    success: true,
                    message: 'All chunks already have embeddings'
                };
            }

            // Generate embeddings for chunks that don't have them using remote API
            const vectorIndexPath = await this.generateChunkEmbeddings(chunksWithoutEmbeddings, modelName);

            // Save vector index path to document entity
            if (vectorIndexPath) {
                await this.documentService.updateDocumentMetadata(documentId, {
                    vectorIndexPath,
                    modelName: modelName,
                    vectorDimensions: dimension
                });
                console.log(`Saved vector index path to document ${documentId}: ${vectorIndexPath}`);
            }

            const processingTime = Date.now() - startTime;

            return {
                documentId,
                chunksProcessed: chunksWithoutEmbeddings.length,
                processingTime,
                success: true,
                message: `Generated embeddings for ${chunksWithoutEmbeddings.length} chunks`
            };
        } catch (error) {
            console.error('Error generating document embeddings:', error);
            return {
                documentId,
                chunksProcessed: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Failed to generate embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`
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
            console.log(`Updating embedding model to: ${modelName}`);
            
            // For now, we'll just log the change since the actual model switching
            // is handled by the remote API configuration
            // In a more complex implementation, this could:
            // 1. Update local configuration
            // 2. Clear existing embeddings if needed
            // 3. Reinitialize embedding services
            
            console.log(`Embedding model updated to: ${modelName}`);
        } catch (error) {
            console.error('Error updating embedding model:', error);
            throw new Error(`Failed to update embedding model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        try {
            // Cleanup logic here if needed
            console.log('RAG search module cleaned up');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

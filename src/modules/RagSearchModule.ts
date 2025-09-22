import { BaseModule } from "@/modules/baseModule";
import { VectorSearchService, SearchResult, SearchOptions } from '@/service/VectorSearchService';
import { EmbeddingFactory, EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';
import { VectorStoreService } from '@/service/VectorStoreService';
import { ConfigurationService, ConfigurationServiceImpl } from '@/modules/ConfigurationService';
import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';
import { DocumentService, DocumentUploadOptions } from '@/service/DocumentService';
import { ChunkingService } from '@/service/ChunkingService';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';

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
    private embeddingFactory: EmbeddingFactory;
    private configurationService: ConfigurationService;
    private currentEmbeddingService: EmbeddingImpl | null = null;
    private documentService: DocumentService;
    private chunkingService: ChunkingService;

    constructor() {
        super();
        
        // Initialize services with database
        const vectorStoreService = new VectorStoreService(this.sqliteDb);
        this.searchService = new VectorSearchService(vectorStoreService, this.sqliteDb);
        this.embeddingFactory = new EmbeddingFactory();
        this.configurationService = new ConfigurationServiceImpl();
        this.documentService = new DocumentService(this.sqliteDb);
        this.chunkingService = new ChunkingService(this.sqliteDb);
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

            // Generate embeddings for chunks if embedding service is available
            if (this.currentEmbeddingService) {
                await this.generateChunkEmbeddings(chunks);
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
     * Generate embeddings for document chunks
     * @param chunks - Array of chunk entities
     */
    private async generateChunkEmbeddings(chunks: any[]): Promise<void> {
        if (!this.currentEmbeddingService) {
            console.warn('No embedding service available, skipping embedding generation');
            return;
        }

        try {
            for (const chunk of chunks) {
                // Generate embedding for chunk content
                const embedding = await this.currentEmbeddingService.embedText(chunk.content);
                
                // Store embedding in vector store
                await this.searchService.vectorStoreService.storeEmbedding({
                    chunkId: chunk.id,
                    documentId: chunk.documentId,
                    content: chunk.content,
                    embedding: embedding,
                    metadata: {
                        chunkIndex: chunk.chunkIndex,
                        pageNumber: chunk.pageNumber
                    }
                });
            }
            
            console.log(`Generated embeddings for ${chunks.length} chunks`);
        } catch (error) {
            console.error('Error generating embeddings:', error);
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
     * Update embedding model
     * @param provider - Embedding provider
     * @param model - Model name
     * @param config - Additional configuration
     */
    async updateEmbeddingModel(
        provider: string,
        model: string,
        config: Partial<EmbeddingConfig> = {}
    ): Promise<void> {
        try {
            const embeddingConfig: any = {
                provider,
                model,
                ...config
            };

            // Clean up current embedding service
            if (this.currentEmbeddingService) {
                await this.currentEmbeddingService.cleanup();
            }

            // Create new embedding service
            this.currentEmbeddingService = this.embeddingFactory.createEmbedding(
                provider,
                embeddingConfig
            ) || null;

            if (!this.currentEmbeddingService) {
                throw new Error('Failed to create new embedding service');
            }

            // Initialize new embedding service
            await this.currentEmbeddingService.initialize();

            // Update search service
            this.searchService.setEmbeddingService(this.currentEmbeddingService);

            console.log(`Embedding model updated to ${provider}:${model}`);
        } catch (error) {
            console.error('Failed to update embedding model:', error);
            throw new Error('Failed to update embedding model');
        }
    }

    /**
     * Get available embedding models
     * @returns Array of available models
     */
    getAvailableModels(): {
        provider: string;
        models: string[];
    }[] {
        const providers = this.embeddingFactory.getSupportedProviders();
        const availableModels: { provider: string; models: string[] }[] = [];

        for (const provider of providers) {
            let models: string[] = [];

            switch (provider) {
                case 'openai':
                    models = ['text-embedding-ada-002', 'text-embedding-3-small', 'text-embedding-3-large'];
                    break;
                case 'huggingface':
                    models = ['sentence-transformers/all-MiniLM-L6-v2', 'sentence-transformers/all-mpnet-base-v2'];
                    break;
                case 'ollama':
                    models = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'bge-large-en-v1.5'];
                    break;
            }

            availableModels.push({ provider, models });
        }

        return availableModels;
    }

    /**
     * Test embedding service
     * @returns Test result
     */
    async testEmbeddingService(): Promise<{
        success: boolean;
        message: string;
        dimensions?: number;
    }> {
        try {
            if (!this.currentEmbeddingService) {
                return {
                    success: false,
                    message: 'No embedding service initialized'
                };
            }

            const testText = 'This is a test embedding';
            const embedding = await this.currentEmbeddingService.embedText(testText);

            return {
                success: true,
                message: 'Embedding service working correctly',
                dimensions: embedding.length
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
                embeddingModel: this.currentEmbeddingService?.getModel() || 'Unknown',
                embeddingProvider: this.currentEmbeddingService?.getProvider() || 'Unknown'
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
    }): Promise<void> {
        try {
            await this.documentService.updateDocumentMetadata(id, metadata);
        } catch (error) {
            console.error('Failed to update document:', error);
            throw new Error('Failed to update document');
        }
    }

    /**
     * Delete a document
     * @param id - Document ID
     * @param deleteFile - Whether to delete the physical file
     */
    async deleteDocument(id: number, deleteFile: boolean = false): Promise<void> {
        try {
            await this.documentService.deleteDocument(id, deleteFile);
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
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        try {
            if (this.currentEmbeddingService) {
                await this.currentEmbeddingService.cleanup();
            }
            await this.embeddingFactory.cleanupAll();
            console.log('RAG search module cleaned up');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

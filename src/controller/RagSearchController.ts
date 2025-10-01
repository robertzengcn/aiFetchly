import { RagSearchModule, SearchRequest, SearchResponse, DocumentUploadResponse } from '@/modules/RagSearchModule';
import { DocumentUploadOptions } from '@/service/DocumentService';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { RagConfigApi, ChunkingConfig } from '@/api/ragConfigApi';

export class RagSearchController {
    private ragSearchModule: RagSearchModule;
    private ragConfigApi: RagConfigApi;

    constructor() {
        this.ragSearchModule = new RagSearchModule();
        this.ragConfigApi = new RagConfigApi();
    }

    /**
     * Initialize the search controller
     * No parameters needed - configuration is retrieved automatically
     */
    async initialize(): Promise<void> {
        await this.ragSearchModule.initialize();
    }

    /**
     * Perform a search
     * @param request - Search request
     * @returns Search response
     */
    async search(request: SearchRequest): Promise<SearchResponse> {
        return await this.ragSearchModule.search(request);
    }

    /**
     * Get search suggestions
     * @param query - Partial query
     * @param limit - Number of suggestions
     * @returns Array of suggestions
     */
    async getSuggestions(query: string, limit: number = 5): Promise<string[]> {
        return await this.ragSearchModule.getSuggestions(query, limit);
    }

    /**
     * Get search analytics
     * @returns Search analytics
     */
    async getAnalytics(): Promise<any> {
        return await this.ragSearchModule.getAnalytics();
    }

    /**
     * Get performance metrics
     * @returns Performance metrics
     */
    getPerformanceMetrics(): any {
        return this.ragSearchModule.getPerformanceMetrics();
    }

    /**
     * Clear search cache
     */
    clearCache(): void {
        this.ragSearchModule.clearCache();
    }


    private determineProviderFromModel(model: string): string {
        if (model.includes('text-embedding')) {
            return 'openai';
        } else if (model.includes('sentence-transformers')) {
            return 'huggingface';
        } else if (model.includes('nomic') || model.includes('llama')) {
            return 'ollama';
        }
        return 'openai';
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
        return await this.ragSearchModule.testEmbeddingService();
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
        return await this.ragSearchModule.getSearchStats();
    }

    /**
     * Upload and process a document
     * @param options - Document upload options
     * @returns Upload response
     */
    async uploadDocument(options: DocumentUploadOptions): Promise<DocumentUploadResponse> {
        return await this.ragSearchModule.uploadDocument(options);
    }

    /**
     * Get all documents
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
        return await this.ragSearchModule.getDocuments(filters);
    }

    /**
     * Get a specific document by ID
     * @param id - Document ID
     * @returns Document entity
     */
    async getDocument(id: number): Promise<RAGDocumentEntity | null> {
        return await this.ragSearchModule.getDocument(id);
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
        return await this.ragSearchModule.updateDocument(id, metadata);
    }

    /**
     * Delete a document
     * @param id - Document ID
     * @param deleteFile - Whether to delete the physical file
     */
    async deleteDocument(id: number, deleteFile: boolean = false): Promise<void> {
        return await this.ragSearchModule.deleteDocument(id, deleteFile);
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
        return await this.ragSearchModule.getDocumentStats();
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
        return await this.ragSearchModule.chunkDocument(documentId, options);
    }

    /**
     * Generate embeddings for document chunks
     * @param documentId - Document ID to generate embeddings for
     * @returns Embedding generation result
     */
    async generateDocumentEmbeddings(documentId: number): Promise<{
        documentId: number;
        chunksProcessed: number;
        processingTime: number;
        success: boolean;
        message: string;
    }> {
        return await this.ragSearchModule.generateDocumentEmbeddings(documentId);
    }

    /**
     * Chunk and embed a document (combined operation)
     * @param documentId - Document ID to process
     * @returns Combined processing result
     */
    async chunkAndEmbedDocument(documentId: number): Promise<{
        documentId: number;
        chunksCreated: number;
        embeddingsGenerated: number;
        processingTime: number;
        success: boolean;
        message: string;
        steps: {
            chunking: boolean;
            embedding: boolean;
        };
        chunkingResult?: {
            chunksCreated: number;
            processingTime: number;
            message: string;
        };
        embeddingResult?: {
            chunksProcessed: number;
            processingTime: number;
            message: string;
        };
    }> {
        const startTime = Date.now();
        const steps = { chunking: false, embedding: false };

        try {
            // Step 1: Get chunking configuration from remote server
            let chunkingOptions: ChunkingConfig | undefined;
            try {
                const configResponse = await this.ragConfigApi.getChunkingConfig();
                if (configResponse.status && configResponse.data) {
                    chunkingOptions = configResponse.data;
                    console.log('Using remote chunking configuration:', chunkingOptions);
                } else {
                    console.warn('Failed to get remote chunking config, using defaults');
                }
            } catch (configError) {
                console.warn('Error fetching chunking config from remote server:', configError);
                console.log('Using default chunking configuration');
            }

            // Step 2: Chunk the document
            const chunkResult = await this.chunkDocument(documentId, chunkingOptions);
            if (!chunkResult.success) {
                return {
                    documentId,
                    chunksCreated: 0,
                    embeddingsGenerated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: `Document chunking failed: ${chunkResult.message}`,
                    steps
                };
            }
            steps.chunking = true;

            // Step 3: Generate embeddings for the chunks
            const embedResult = await this.generateDocumentEmbeddings(documentId);
            if (!embedResult.success) {
                return {
                    documentId,
                    chunksCreated: chunkResult.chunksCreated,
                    embeddingsGenerated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: `Embedding generation failed: ${embedResult.message}`,
                    steps,
                    chunkingResult: {
                        chunksCreated: chunkResult.chunksCreated,
                        processingTime: chunkResult.processingTime,
                        message: chunkResult.message
                    }
                };
            }
            steps.embedding = true;

            return {
                documentId,
                chunksCreated: chunkResult.chunksCreated,
                embeddingsGenerated: embedResult.chunksProcessed,
                processingTime: Date.now() - startTime,
                success: true,
                message: 'Document chunked and embedded successfully',
                steps,
                chunkingResult: {
                    chunksCreated: chunkResult.chunksCreated,
                    processingTime: chunkResult.processingTime,
                    message: chunkResult.message
                },
                embeddingResult: {
                    chunksProcessed: embedResult.chunksProcessed,
                    processingTime: embedResult.processingTime,
                    message: embedResult.message
                }
            };
        } catch (error) {
            console.error('Error in chunk and embed document:', error);
            return {
                documentId,
                chunksCreated: 0,
                embeddingsGenerated: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Chunk and embed failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                steps
            };
        }
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        await this.ragSearchModule.cleanup();
    }
}

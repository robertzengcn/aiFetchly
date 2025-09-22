import { RagSearchModule, SearchRequest, SearchResponse, DocumentUploadResponse } from '@/modules/RagSearchModule';
import { DocumentUploadOptions } from '@/service/DocumentService';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';

export class RagSearchController {
    private ragSearchModule: RagSearchModule;

    constructor() {
        this.ragSearchModule = new RagSearchModule();
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

    /**
     * Update embedding model
     * @param model - Model name
     */
    async updateEmbeddingModel(model: string): Promise<void> {
        const provider = this.determineProviderFromModel(model);
        await this.ragSearchModule.updateEmbeddingModel(provider, model);
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
     * Get available embedding models
     * @returns Array of available models
     */
    getAvailableModels(): {
        provider: string;
        models: string[];
    }[] {
        return this.ragSearchModule.getAvailableModels();
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
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        await this.ragSearchModule.cleanup();
    }
}

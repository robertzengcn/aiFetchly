import { BaseModule } from "@/modules/baseModule";
import { VectorSearchService, SearchResult, SearchOptions } from '@/service/VectorSearchService';
import { EmbeddingFactory, EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';
import { VectorStoreService } from '@/service/VectorStoreService';
import { ConfigurationService, ConfigurationServiceImpl } from '@/modules/ConfigurationService';
import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';

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

    constructor() {
        super();
        
        // Initialize services with database
        const vectorStoreService = new VectorStoreService(this.sqliteDb);
        this.searchService = new VectorSearchService(vectorStoreService, this.sqliteDb);
        this.embeddingFactory = new EmbeddingFactory();
        this.configurationService = new ConfigurationServiceImpl();
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

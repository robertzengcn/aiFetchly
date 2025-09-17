import { VectorSearchService, SearchResult, SearchOptions } from '@/service/VectorSearchService';
import { SqliteDb } from '@/config/SqliteDb';
import { EmbeddingFactory, EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';
import { EmbeddingProviderEnum, EmbeddingModelEnum } from '@/config/generate';
import { Token } from '@/modules/token';
import { USERSDBPATH } from '@/config/usersetting';
import { VectorStoreService } from '@/service/VectorStoreService';

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

export class RagSearchController {
    private searchService: VectorSearchService;
    private embeddingFactory: EmbeddingFactory;
    private currentEmbeddingService: any = null;
    private db: SqliteDb;

    constructor() {
        // Initialize database connection following the same pattern as other modules
        const tokenService = new Token();
        const dbpath = tokenService.getValue(USERSDBPATH);
        if (!dbpath) {
            throw new Error("Database path not found");
        }
        this.db = SqliteDb.getInstance(dbpath);
        
        // Initialize services with database
        const vectorStoreService = new VectorStoreService(this.db);
        this.searchService = new VectorSearchService(vectorStoreService, this.db);
        this.embeddingFactory = new EmbeddingFactory();
    }

    /**
     * Initialize the search controller
     * @param embeddingConfig - Configuration for embedding service
     */
    async initialize(embeddingConfig: EmbeddingConfig): Promise<void> {
        try {
            // Create embedding service
            this.currentEmbeddingService = this.embeddingFactory.createEmbedding(
                embeddingConfig.provider,
                embeddingConfig
            );

            if (!this.currentEmbeddingService) {
                throw new Error('Failed to create embedding service');
            }

            // Initialize embedding service
            await this.currentEmbeddingService.initialize();

            // Set embedding service in search service
            this.searchService.setEmbeddingService(this.currentEmbeddingService);

            console.log('RAG search controller initialized successfully');
        } catch (error) {
            console.error('Failed to initialize RAG search controller:', error);
            throw new Error('Failed to initialize RAG search controller');
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
            const embeddingConfig: EmbeddingConfig = {
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
            );

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
                case EmbeddingProviderEnum.OPENAI:
                    models = Object.values(EmbeddingModelEnum).filter(model => 
                        model.startsWith('text-embedding')
                    );
                    break;
                case EmbeddingProviderEnum.HUGGINGFACE:
                    models = Object.values(EmbeddingModelEnum).filter(model => 
                        model.startsWith('sentence-transformers')
                    );
                    break;
                case EmbeddingProviderEnum.OLLAMA:
                    models = Object.values(EmbeddingModelEnum).filter(model => 
                        model.startsWith('nomic-embed') || 
                        model.startsWith('mxbai-embed') ||
                        model.startsWith('all-minilm') ||
                        model.startsWith('bge-')
                    );
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
            console.log('RAG search controller cleaned up');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

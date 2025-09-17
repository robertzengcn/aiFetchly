import { ipcMain } from 'electron';
import { RagSearchController, SearchRequest, SearchResponse } from '@/controller/RagSearchController';
import { EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';
import { CommonResponse } from '@/entityTypes/commonType';

// RAG Search IPC Channel Names
export const RAG_SEARCH_CHANNELS = {
    INITIALIZE: 'rag-search:initialize',
    SEARCH: 'rag-search:search',
    GET_SUGGESTIONS: 'rag-search:get-suggestions',
    GET_ANALYTICS: 'rag-search:get-analytics',
    GET_PERFORMANCE_METRICS: 'rag-search:get-performance-metrics',
    CLEAR_CACHE: 'rag-search:clear-cache',
    UPDATE_EMBEDDING_MODEL: 'rag-search:update-embedding-model',
    GET_AVAILABLE_MODELS: 'rag-search:get-available-models',
    TEST_EMBEDDING_SERVICE: 'rag-search:test-embedding-service',
    GET_SEARCH_STATS: 'rag-search:get-search-stats',
    CLEANUP: 'rag-search:cleanup'
};

/**
 * Register RAG Search IPC handlers
 */
export function registerRagSearchIpcHandlers(): void {
    // Initialize RAG search controller
    ipcMain.handle(RAG_SEARCH_CHANNELS.INITIALIZE, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const embeddingConfig = JSON.parse(data) as EmbeddingConfig;
            const ragSearchController = new RagSearchController();
            
            await ragSearchController.initialize(embeddingConfig);
            
            return {
                status: true,
                msg: "RAG search controller initialized successfully",
                data: null
            };
        } catch (error) {
            console.error('Failed to initialize RAG search controller:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
        }
    });

    // Perform RAG search
    ipcMain.handle(RAG_SEARCH_CHANNELS.SEARCH, async (event, data): Promise<CommonResponse<SearchResponse>> => {
        try {
            const searchRequest = JSON.parse(data) as SearchRequest;
            const ragSearchController = new RagSearchController();
            
            const result = await ragSearchController.search(searchRequest);
            
            return {
                status: true,
                msg: "Search completed successfully",
                data: result
            };
        } catch (error) {
            console.error('RAG search failed:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Search failed",
                data: null
            };
        }
    });

    // Get search suggestions
    ipcMain.handle(RAG_SEARCH_CHANNELS.GET_SUGGESTIONS, async (event, data): Promise<CommonResponse<string[]>> => {
        try {
            const { query, limit } = JSON.parse(data) as { query: string; limit?: number };
            const ragSearchController = new RagSearchController();
            
            const suggestions = await ragSearchController.getSuggestions(query, limit);
            
            return {
                status: true,
                msg: "Suggestions retrieved successfully",
                data: suggestions
            };
        } catch (error) {
            console.error('Failed to get suggestions:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to get suggestions",
                data: []
            };
        }
    });

    // Get search analytics
    ipcMain.handle(RAG_SEARCH_CHANNELS.GET_ANALYTICS, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const ragSearchController = new RagSearchController();
            const analytics = await ragSearchController.getAnalytics();
            
            return {
                status: true,
                msg: "Analytics retrieved successfully",
                data: analytics
            };
        } catch (error) {
            console.error('Failed to get analytics:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to get analytics",
                data: null
            };
        }
    });

    // Get performance metrics
    ipcMain.handle(RAG_SEARCH_CHANNELS.GET_PERFORMANCE_METRICS, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const ragSearchController = new RagSearchController();
            const metrics = ragSearchController.getPerformanceMetrics();
            
            return {
                status: true,
                msg: "Performance metrics retrieved successfully",
                data: metrics
            };
        } catch (error) {
            console.error('Failed to get performance metrics:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to get performance metrics",
                data: null
            };
        }
    });

    // Clear search cache
    ipcMain.handle(RAG_SEARCH_CHANNELS.CLEAR_CACHE, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const ragSearchController = new RagSearchController();
            ragSearchController.clearCache();
            
            return {
                status: true,
                msg: "Cache cleared successfully",
                data: null
            };
        } catch (error) {
            console.error('Failed to clear cache:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to clear cache",
                data: null
            };
        }
    });

    // Update embedding model
    ipcMain.handle(RAG_SEARCH_CHANNELS.UPDATE_EMBEDDING_MODEL, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const { provider, model, config } = JSON.parse(data) as { 
                provider: string; 
                model: string; 
                config?: Partial<EmbeddingConfig> 
            };
            const ragSearchController = new RagSearchController();
            
            await ragSearchController.updateEmbeddingModel(provider, model, config);
            
            return {
                status: true,
                msg: "Embedding model updated successfully",
                data: null
            };
        } catch (error) {
            console.error('Failed to update embedding model:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to update embedding model",
                data: null
            };
        }
    });

    // Get available models
    ipcMain.handle(RAG_SEARCH_CHANNELS.GET_AVAILABLE_MODELS, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const ragSearchController = new RagSearchController();
            const models = ragSearchController.getAvailableModels();
            
            return {
                status: true,
                msg: "Available models retrieved successfully",
                data: models
            };
        } catch (error) {
            console.error('Failed to get available models:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to get available models",
                data: []
            };
        }
    });

    // Test embedding service
    ipcMain.handle(RAG_SEARCH_CHANNELS.TEST_EMBEDDING_SERVICE, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const ragSearchController = new RagSearchController();
            const testResult = await ragSearchController.testEmbeddingService();
            
            return {
                status: testResult.success,
                msg: testResult.message,
                data: testResult
            };
        } catch (error) {
            console.error('Failed to test embedding service:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to test embedding service",
                data: null
            };
        }
    });

    // Get search statistics
    ipcMain.handle(RAG_SEARCH_CHANNELS.GET_SEARCH_STATS, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const ragSearchController = new RagSearchController();
            const stats = await ragSearchController.getSearchStats();
            
            return {
                status: true,
                msg: "Search statistics retrieved successfully",
                data: stats
            };
        } catch (error) {
            console.error('Failed to get search statistics:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to get search statistics",
                data: null
            };
        }
    });

    // Cleanup RAG search controller
    ipcMain.handle(RAG_SEARCH_CHANNELS.CLEANUP, async (event, data): Promise<CommonResponse<any>> => {
        try {
            const ragSearchController = new RagSearchController();
            await ragSearchController.cleanup();
            
            return {
                status: true,
                msg: "RAG search controller cleaned up successfully",
                data: null
            };
        } catch (error) {
            console.error('Failed to cleanup RAG search controller:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to cleanup RAG search controller",
                data: null
            };
        }
    });

    console.log('RAG Search IPC handlers registered successfully');
}

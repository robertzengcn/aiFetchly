'use strict';
import { expect, test, describe, beforeEach, vi } from 'vitest';
import { RagSearchController } from '../RagSearchController';
import { RagSearchModule, SearchRequest, SearchResponse } from '@/modules/RagSearchModule';

// Mock RagSearchModule
vi.mock('@/modules/RagSearchModule');

describe('RagSearchController', () => {
    let controller: RagSearchController;
    let mockRagSearchModule: any;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();
        
        // Create mock RagSearchModule
        mockRagSearchModule = {
            initialize: vi.fn(),
            search: vi.fn(),
            getSuggestions: vi.fn(),
            getAnalytics: vi.fn(),
            getPerformanceMetrics: vi.fn(),
            clearCache: vi.fn(),
            testEmbeddingService: vi.fn(),
            getSearchStats: vi.fn(),
            cleanup: vi.fn()
        };
        
        // Mock RagSearchModule constructor
        (RagSearchModule as any).mockImplementation(() => mockRagSearchModule);
        
        controller = new RagSearchController();
    });

    describe('constructor', () => {
        test('should initialize RagSearchModule', () => {
            expect(RagSearchModule).toHaveBeenCalledTimes(1);
        });
    });

    describe('initialize', () => {
        test('should call module initialize without parameters', async () => {
            mockRagSearchModule.initialize.mockResolvedValue(undefined);

            await controller.initialize();

            expect(mockRagSearchModule.initialize).toHaveBeenCalledTimes(1);
            expect(mockRagSearchModule.initialize).toHaveBeenCalledWith();
        });

        test('should handle initialization errors', async () => {
            const error = new Error('Initialization failed');
            mockRagSearchModule.initialize.mockRejectedValue(error);

            await expect(controller.initialize()).rejects.toThrow('Initialization failed');
        });
    });

    describe('search', () => {
        test('should call module search with correct parameters', async () => {
            const searchRequest: SearchRequest = {
                query: 'test query',
                options: { limit: 10 },
                filters: { documentTypes: ['pdf'] }
            };

            const searchResponse: SearchResponse = {
                results: [],
                totalResults: 0,
                query: 'test query',
                processingTime: 100,
                suggestions: ['suggestion1', 'suggestion2']
            };

            mockRagSearchModule.search.mockResolvedValue(searchResponse);

            const result = await controller.search(searchRequest);

            expect(mockRagSearchModule.search).toHaveBeenCalledTimes(1);
            expect(mockRagSearchModule.search).toHaveBeenCalledWith(searchRequest);
            expect(result).toEqual(searchResponse);
        });

        test('should handle search errors', async () => {
            const searchRequest: SearchRequest = {
                query: 'test query'
            };

            const error = new Error('Search failed');
            mockRagSearchModule.search.mockRejectedValue(error);

            await expect(controller.search(searchRequest)).rejects.toThrow('Search failed');
        });
    });

    describe('getSuggestions', () => {
        test('should call module getSuggestions with correct parameters', async () => {
            const query = 'test query';
            const limit = 5;
            const suggestions = ['suggestion1', 'suggestion2', 'suggestion3'];

            mockRagSearchModule.getSuggestions.mockResolvedValue(suggestions);

            const result = await controller.getSuggestions(query, limit);

            expect(mockRagSearchModule.getSuggestions).toHaveBeenCalledTimes(1);
            expect(mockRagSearchModule.getSuggestions).toHaveBeenCalledWith(query, limit);
            expect(result).toEqual(suggestions);
        });

        test('should use default limit when not provided', async () => {
            const query = 'test query';
            const suggestions = ['suggestion1', 'suggestion2'];

            mockRagSearchModule.getSuggestions.mockResolvedValue(suggestions);

            await controller.getSuggestions(query);

            expect(mockRagSearchModule.getSuggestions).toHaveBeenCalledWith(query, 5);
        });

        test('should handle getSuggestions errors', async () => {
            const error = new Error('Suggestions failed');
            mockRagSearchModule.getSuggestions.mockRejectedValue(error);

            await expect(controller.getSuggestions('test')).rejects.toThrow('Suggestions failed');
        });
    });

    describe('getAnalytics', () => {
        test('should call module getAnalytics', async () => {
            const analytics = {
                totalSearches: 100,
                averageResponseTime: 150,
                topQueries: ['query1', 'query2']
            };

            mockRagSearchModule.getAnalytics.mockResolvedValue(analytics);

            const result = await controller.getAnalytics();

            expect(mockRagSearchModule.getAnalytics).toHaveBeenCalledTimes(1);
            expect(result).toEqual(analytics);
        });

        test('should handle getAnalytics errors', async () => {
            const error = new Error('Analytics failed');
            mockRagSearchModule.getAnalytics.mockRejectedValue(error);

            await expect(controller.getAnalytics()).rejects.toThrow('Analytics failed');
        });
    });

    describe('getPerformanceMetrics', () => {
        test('should call module getPerformanceMetrics', () => {
            const metrics = {
                averageLatency: 100,
                cacheHitRate: 0.85,
                memoryUsage: 512
            };

            mockRagSearchModule.getPerformanceMetrics.mockReturnValue(metrics);

            const result = controller.getPerformanceMetrics();

            expect(mockRagSearchModule.getPerformanceMetrics).toHaveBeenCalledTimes(1);
            expect(result).toEqual(metrics);
        });
    });

    describe('clearCache', () => {
        test('should call module clearCache', () => {
            mockRagSearchModule.clearCache.mockReturnValue(undefined);

            controller.clearCache();

            expect(mockRagSearchModule.clearCache).toHaveBeenCalledTimes(1);
        });
    });



    describe('testEmbeddingService', () => {
        test('should call module testEmbeddingService', async () => {
            const testResult = {
                success: true,
                message: 'Embedding service is working',
                dimensions: 1536
            };

            mockRagSearchModule.testEmbeddingService.mockResolvedValue(testResult);

            const result = await controller.testEmbeddingService();

            expect(mockRagSearchModule.testEmbeddingService).toHaveBeenCalledTimes(1);
            expect(result).toEqual(testResult);
        });

        test('should handle testEmbeddingService errors', async () => {
            const error = new Error('Test failed');
            mockRagSearchModule.testEmbeddingService.mockRejectedValue(error);

            await expect(controller.testEmbeddingService()).rejects.toThrow('Test failed');
        });
    });

    describe('getSearchStats', () => {
        test('should call module getSearchStats', async () => {
            const stats = {
                totalDocuments: 1000,
                totalChunks: 5000,
                indexSize: 1024000,
                averageChunkSize: 512,
                embeddingModel: 'text-embedding-3-small',
                embeddingProvider: 'openai'
            };

            mockRagSearchModule.getSearchStats.mockResolvedValue(stats);

            const result = await controller.getSearchStats();

            expect(mockRagSearchModule.getSearchStats).toHaveBeenCalledTimes(1);
            expect(result).toEqual(stats);
        });

        test('should handle getSearchStats errors', async () => {
            const error = new Error('Stats failed');
            mockRagSearchModule.getSearchStats.mockRejectedValue(error);

            await expect(controller.getSearchStats()).rejects.toThrow('Stats failed');
        });
    });

    describe('cleanup', () => {
        test('should call module cleanup', async () => {
            mockRagSearchModule.cleanup.mockResolvedValue(undefined);

            await controller.cleanup();

            expect(mockRagSearchModule.cleanup).toHaveBeenCalledTimes(1);
        });

        test('should handle cleanup errors', async () => {
            const error = new Error('Cleanup failed');
            mockRagSearchModule.cleanup.mockRejectedValue(error);

            await expect(controller.cleanup()).rejects.toThrow('Cleanup failed');
        });
    });

    describe('integration', () => {
        test('should handle complete workflow', async () => {
            // Mock all methods
            mockRagSearchModule.initialize.mockResolvedValue(undefined);
            mockRagSearchModule.search.mockResolvedValue({
                results: [],
                totalResults: 0,
                query: 'test',
                processingTime: 100
            });
            mockRagSearchModule.getSuggestions.mockResolvedValue(['suggestion1']);
            mockRagSearchModule.getAnalytics.mockResolvedValue({ totalSearches: 1 });
            mockRagSearchModule.getPerformanceMetrics.mockReturnValue({ latency: 100 });
            mockRagSearchModule.getSearchStats.mockResolvedValue({
                totalDocuments: 100,
                totalChunks: 500,
                indexSize: 1024,
                averageChunkSize: 256,
                embeddingModel: 'test-model',
                embeddingProvider: 'test-provider'
            });

            // Test complete workflow
            await controller.initialize();
            
            const searchResult = await controller.search({ query: 'test' });
            const suggestions = await controller.getSuggestions('test');
            const analytics = await controller.getAnalytics();
            const metrics = controller.getPerformanceMetrics();
            const stats = await controller.getSearchStats();

            expect(searchResult).toBeDefined();
            expect(suggestions).toBeDefined();
            expect(analytics).toBeDefined();
            expect(metrics).toBeDefined();
            expect(stats).toBeDefined();
        });
    });
});



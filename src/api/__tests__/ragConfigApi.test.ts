'use strict';
import { expect, test, describe, beforeEach, vi } from 'vitest';
import { RagConfigApi } from '../ragConfigApi';
import { HttpClient } from '@/modules/lib/httpclient';
import { EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';

// Mock HttpClient
vi.mock('@/modules/lib/httpclient');

describe('RagConfigApi', () => {
    let ragConfigApi: RagConfigApi;
    let mockHttpClient: any;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();
        
        // Create mock HttpClient
        mockHttpClient = {
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn()
        };
        
        // Mock HttpClient constructor
        (HttpClient as any).mockImplementation(() => mockHttpClient);
        
        ragConfigApi = new RagConfigApi();
    });

    describe('constructor', () => {
        test('should initialize HttpClient', () => {
            expect(HttpClient).toHaveBeenCalledTimes(1);
        });
    });

    describe('getDefaultConfig', () => {
        test('should call HttpClient.get with correct endpoint', async () => {
            const mockResponse = {
                success: true,
                data: {
                    model: 'text-embedding-3-small',
                    dimensions: 1536,
                    maxTokens: 8191,
                    timeout: 30000,
                    retries: 3
                }
            };
            
            mockHttpClient.get.mockResolvedValue(mockResponse);

            const result = await ragConfigApi.getDefaultConfig();

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/rag/config');
            expect(result).toEqual(mockResponse);
        });

        test('should handle HttpClient errors', async () => {
            const error = new Error('Network error');
            mockHttpClient.get.mockRejectedValue(error);

            await expect(ragConfigApi.getDefaultConfig()).rejects.toThrow('Network error');
        });
    });

    describe('refreshCache', () => {
        test('should call HttpClient.post with correct endpoint', async () => {
            const mockResponse = {
                success: true,
                data: null
            };
            
            mockHttpClient.post.mockResolvedValue(mockResponse);

            const result = await ragConfigApi.refreshCache();

            expect(mockHttpClient.post).toHaveBeenCalledWith('/api/rag/refresh');
            expect(result).toEqual(mockResponse);
        });

        test('should handle HttpClient errors', async () => {
            const error = new Error('Server error');
            mockHttpClient.post.mockRejectedValue(error);

            await expect(ragConfigApi.refreshCache()).rejects.toThrow('Server error');
        });
    });

    describe('isOnline', () => {
        test('should call HttpClient.get with correct endpoint', async () => {
            const mockResponse = {
                success: true,
                data: true
            };
            
            mockHttpClient.get.mockResolvedValue(mockResponse);

            const result = await ragConfigApi.isOnline();

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/rag/health');
            expect(result).toEqual(mockResponse);
        });

        test('should handle HttpClient errors', async () => {
            const error = new Error('Connection failed');
            mockHttpClient.get.mockRejectedValue(error);

            await expect(ragConfigApi.isOnline()).rejects.toThrow('Connection failed');
        });
    });

    describe('integration', () => {
        test('should handle complete workflow', async () => {
            const mockConfigResponse = {
                success: true,
                data: {
                    model: 'text-embedding-3-small',
                    dimensions: 1536,
                    maxTokens: 8191,
                    timeout: 30000,
                    retries: 3
                }
            };

            const mockHealthResponse = {
                success: true,
                data: true
            };

            mockHttpClient.get
                .mockResolvedValueOnce(mockConfigResponse) // getDefaultConfig
                .mockResolvedValueOnce(mockHealthResponse); // isOnline

            mockHttpClient.post.mockResolvedValue({ success: true, data: null }); // refreshCache

            // Test complete workflow
            const config = await ragConfigApi.getDefaultConfig();
            const isOnline = await ragConfigApi.isOnline();
            const refreshResult = await ragConfigApi.refreshCache();

            expect(config).toEqual(mockConfigResponse);
            expect(isOnline).toEqual(mockHealthResponse);
            expect(refreshResult.status).toBe(true);
        });
    });
});

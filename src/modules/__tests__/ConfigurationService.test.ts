'use strict';
import { expect, test, describe, beforeEach, vi } from 'vitest';
import { ConfigurationServiceImpl } from '../ConfigurationService';
import { RagConfigApi } from '@/api/ragConfigApi';
import { EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';

// Mock RagConfigApi
vi.mock('@/api/ragConfigApi');

describe('ConfigurationServiceImpl', () => {
    let configurationService: ConfigurationServiceImpl;
    let mockRagConfigApi: any;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();
        
        // Create mock RagConfigApi
        mockRagConfigApi = {
            getDefaultConfig: vi.fn(),
            refreshCache: vi.fn(),
            isOnline: vi.fn()
        };
        
        // Mock RagConfigApi constructor
        (RagConfigApi as any).mockImplementation(() => mockRagConfigApi);
        
        configurationService = new ConfigurationServiceImpl();
    });

    describe('constructor', () => {
        test('should initialize RagConfigApi', () => {
            expect(RagConfigApi).toHaveBeenCalledTimes(1);
        });
    });

    describe('getDefaultModelConfig', () => {
        test('should return cached config when available and not expired', async () => {
            const mockConfig: EmbeddingConfig = {
                model: 'text-embedding-3-small',
                dimensions: 1536,
                maxTokens: 8191,
                timeout: 30000,
                retries: 3
            };

            // Mock successful API response
            mockRagConfigApi.getDefaultConfig.mockResolvedValue({
                success: true,
                data: mockConfig
            });

            // First call should fetch from API
            const result1 = await configurationService.getDefaultModelConfig();
            expect(result1).toEqual(mockConfig);
            expect(mockRagConfigApi.getDefaultConfig).toHaveBeenCalledTimes(1);

            // Second call should use cache (we need to implement cache checking)
            const result2 = await configurationService.getDefaultModelConfig();
            expect(result2).toEqual(mockConfig);
        });

        test('should fetch from API when cache is empty', async () => {
            const mockConfig: EmbeddingConfig = {
                model: 'text-embedding-3-small',
                dimensions: 1536,
                maxTokens: 8191,
                timeout: 30000,
                retries: 3
            };

            mockRagConfigApi.getDefaultConfig.mockResolvedValue({
                success: true,
                data: mockConfig
            });

            const result = await configurationService.getDefaultModelConfig();

            expect(mockRagConfigApi.getDefaultConfig).toHaveBeenCalledTimes(1);
            expect(result).toEqual(mockConfig);
        });

        test('should return fallback config when API fails', async () => {
            mockRagConfigApi.getDefaultConfig.mockRejectedValue(new Error('API Error'));

            const result = await configurationService.getDefaultModelConfig();

            expect(result).toEqual({
                model: 'text-embedding-3-small',
                dimensions: 1536,
                maxTokens: 8191,
                timeout: 30000,
                retries: 3
            });
        });

        test('should return fallback config when API returns unsuccessful response', async () => {
            mockRagConfigApi.getDefaultConfig.mockResolvedValue({
                success: false,
                data: null
            });

            const result = await configurationService.getDefaultModelConfig();

            expect(result).toEqual({
                model: 'text-embedding-3-small',
                dimensions: 1536,
                maxTokens: 8191,
                timeout: 30000,
                retries: 3
            });
        });
    });

    describe('refreshCache', () => {
        test('should call API refresh and clear local cache', async () => {
            mockRagConfigApi.refreshCache.mockResolvedValue({
                success: true,
                data: null
            });

            await configurationService.refreshCache();

            expect(mockRagConfigApi.refreshCache).toHaveBeenCalledTimes(1);
        });

        test('should handle API refresh errors', async () => {
            const error = new Error('Refresh failed');
            mockRagConfigApi.refreshCache.mockRejectedValue(error);

            await expect(configurationService.refreshCache()).rejects.toThrow('Refresh failed');
        });
    });

    describe('isOnline', () => {
        test('should return true when API is online', async () => {
            mockRagConfigApi.isOnline.mockResolvedValue({
                success: true,
                data: true
            });

            const result = await configurationService.isOnline();

            expect(mockRagConfigApi.isOnline).toHaveBeenCalledTimes(1);
            expect(result).toBe(true);
        });

        test('should return false when API is offline', async () => {
            mockRagConfigApi.isOnline.mockResolvedValue({
                success: true,
                data: false
            });

            const result = await configurationService.isOnline();

            expect(result).toBe(false);
        });

        test('should return false when API call fails', async () => {
            mockRagConfigApi.isOnline.mockRejectedValue(new Error('Network error'));

            const result = await configurationService.isOnline();

            expect(result).toBe(false);
        });

        test('should return false when API returns unsuccessful response', async () => {
            mockRagConfigApi.isOnline.mockResolvedValue({
                success: false,
                data: false
            });

            const result = await configurationService.isOnline();

            expect(result).toBe(false);
        });
    });

    describe('caching behavior', () => {
        test('should cache configuration after successful API call', async () => {
            const mockConfig: EmbeddingConfig = {
                model: 'text-embedding-3-small',
                dimensions: 1536,
                maxTokens: 8191,
                timeout: 30000,
                retries: 3
            };

            mockRagConfigApi.getDefaultConfig.mockResolvedValue({
                success: true,
                data: mockConfig
            });

            // First call
            await configurationService.getDefaultModelConfig();
            
            // Second call should use cache (implementation dependent)
            await configurationService.getDefaultModelConfig();

            // Should only call API once if caching works correctly
            expect(mockRagConfigApi.getDefaultConfig).toHaveBeenCalledTimes(1);
        });
    });

    describe('error handling', () => {
        test('should handle network timeouts gracefully', async () => {
            const timeoutError = new Error('Request timeout');
            mockRagConfigApi.getDefaultConfig.mockRejectedValue(timeoutError);

            const result = await configurationService.getDefaultModelConfig();

            // Should return fallback config
            expect(result.model).toBe('text-embedding-3-small');
        });

        test('should handle malformed API responses', async () => {
            mockRagConfigApi.getDefaultConfig.mockResolvedValue({
                success: true,
                data: null // Malformed response
            });

            const result = await configurationService.getDefaultModelConfig();

            // Should return fallback config
            expect(result.model).toBe('text-embedding-3-small');
        });
    });
});



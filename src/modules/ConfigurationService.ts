"use strict";
import { RagConfigApi } from "@/api/ragConfigApi";
import { EmbeddingConfig } from "@/entityTypes/commonType";

/**
 * Configuration service interface for embedding model management
 * 
 * Provides methods to retrieve model configurations with caching,
 * refresh cache, and check service availability.
 */
export interface ConfigurationService {
    /**
     * Gets the default model configuration with caching and fallback support
     * @returns Promise resolving to embedding configuration
     */
    getDefaultModelConfig(): Promise<EmbeddingConfig>;
    
    /**
     * Refreshes the local configuration cache
     * @returns Promise that resolves when cache is refreshed
     */
    refreshCache(): Promise<void>;
    
    /**
     * Checks if the remote configuration service is online
     * @returns Promise resolving to boolean indicating service availability
     */
    isOnline(): Promise<boolean>;
}

/**
 * Implementation of ConfigurationService with caching and fallback support
 * 
 * Manages embedding model configurations with intelligent caching,
 * automatic fallback to default configuration when remote service is unavailable,
 * and TTL-based cache management.
 * 
 * @example
 * ```typescript
 * const configService = new ConfigurationServiceImpl();
 * const config = await configService.getDefaultModelConfig();
 * console.log('Using model:', config.model);
 * ```
 */
export class ConfigurationServiceImpl implements ConfigurationService {
    private ragConfigApi: RagConfigApi;
    private cache: Map<string, { data: EmbeddingConfig; timestamp: number; ttl: number }> = new Map();
    private readonly DEFAULT_TTL = 3600000; // 1 hour in milliseconds
    private readonly MAX_CACHE_SIZE = 100; // Maximum number of cache entries
    private cacheHits: number = 0;
    private cacheMisses: number = 0;

    /**
     * Creates a new ConfigurationServiceImpl instance
     * Initializes the API client and cache
     */
    constructor() {
        this.ragConfigApi = new RagConfigApi();
    }

    /**
     * Gets the default model configuration with caching and fallback support
     * 
     * This method implements a three-tier approach:
     * 1. Check local cache first (fastest)
     * 2. Fetch from remote API if cache miss (fast)
     * 3. Return fallback configuration if API fails (reliable)
     * 
     * @returns Promise resolving to embedding configuration
     * @throws Never throws - always returns a valid configuration
     * 
     * @example
     * ```typescript
     * const config = await configService.getDefaultModelConfig();
     * console.log('Model:', config.model);
     * console.log('Dimensions:', config.dimensions);
     * ```
     */
    async getDefaultModelConfig(): Promise<EmbeddingConfig> {
        const cacheKey = 'default_config';

        // Clean up expired cache entries periodically
        this.cleanupExpiredCache();

        // Check cache first
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            this.cacheHits++;
            console.log('Configuration retrieved from cache');
            return cached;
        }

        try {
            // Fetch from remote API
            this.cacheMisses++;
            const response = await this.ragConfigApi.getDefaultConfig();
            if (response.status && response.data) {
                this.setCache(cacheKey, response.data, this.DEFAULT_TTL);
                console.log('Configuration retrieved from remote API');
                return response.data;
            }
            throw new Error('Failed to retrieve configuration from API');
        } catch (error) {
            console.error('Failed to retrieve configuration:', error);
            // Return fallback configuration
            return this.getFallbackConfig();
        }
    }

    async refreshCache(): Promise<void> {
        try {
            await this.ragConfigApi.refreshCache();
            this.cache.clear();
            console.log('Configuration cache refreshed');
        } catch (error) {
            console.error('Failed to refresh cache:', error);
            throw error;
        }
    }

    async isOnline(): Promise<boolean> {
        try {
            const response = await this.ragConfigApi.isOnline();
            return response.status && response.data === true;
        } catch (error) {
            console.error('Failed to check online status:', error);
            return false;
        }
    }

    private getFromCache(key: string): EmbeddingConfig | null {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }

        const now = Date.now();
        if (now - cached.timestamp > cached.ttl) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    /**
     * Cleans up expired cache entries to prevent memory leaks
     */
    private cleanupExpiredCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Gets cache statistics for monitoring
     */
    getCacheStats(): { size: number; keys: string[] } {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }

    /**
     * Clears the local cache
     */
    clearCache(): void {
        this.cache.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    /**
     * Gets cache performance statistics
     */
    getCachePerformance(): { hits: number; misses: number; hitRate: number } {
        const total = this.cacheHits + this.cacheMisses;
        return {
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: total > 0 ? this.cacheHits / total : 0
        };
    }

    /**
     * Gets cache configuration
     */
    getCacheConfig(): { maxSize: number; defaultTtl: number } {
        return {
            maxSize: this.MAX_CACHE_SIZE,
            defaultTtl: this.DEFAULT_TTL
        };
    }

    /**
     * Gets cache health status
     */
    getCacheHealth(): { isHealthy: boolean; issues: string[] } {
        const issues: string[] = [];
        const stats = this.getCacheStats();
        const performance = this.getCachePerformance();

        if (stats.size >= this.MAX_CACHE_SIZE) {
            issues.push('Cache is at maximum capacity');
        }

        if (performance.hitRate < 0.5 && performance.hits + performance.misses > 10) {
            issues.push('Cache hit rate is below 50%');
        }

        return {
            isHealthy: issues.length === 0,
            issues
        };
    }

    /**
     * Gets comprehensive cache information
     */
    getCacheInfo(): {
        stats: { size: number; keys: string[] };
        performance: { hits: number; misses: number; hitRate: number };
        config: { maxSize: number; defaultTtl: number };
        health: { isHealthy: boolean; issues: string[] };
    } {
        return {
            stats: this.getCacheStats(),
            performance: this.getCachePerformance(),
            config: this.getCacheConfig(),
            health: this.getCacheHealth()
        };
    }

    /**
     * Gets cache memory usage estimate
     */
    getCacheMemoryUsage(): { estimatedBytes: number; entryCount: number } {
        let estimatedBytes = 0;
        for (const [key, entry] of this.cache.entries()) {
            estimatedBytes += key.length * 2; // UTF-16 string
            estimatedBytes += JSON.stringify(entry.data).length * 2; // JSON string
            estimatedBytes += 16; // timestamp and ttl numbers
        }
        return {
            estimatedBytes,
            entryCount: this.cache.size
        };
    }

    /**
     * Gets cache efficiency metrics
     */
    getCacheEfficiency(): { efficiency: number; recommendations: string[] } {
        const performance = this.getCachePerformance();
        const memory = this.getCacheMemoryUsage();
        
        let efficiency = 0;
        const recommendations: string[] = [];

        // Calculate efficiency based on hit rate and memory usage
        efficiency += performance.hitRate * 0.7; // 70% weight on hit rate
        
        // Memory efficiency (lower is better)
        const memoryEfficiency = Math.max(0, 1 - (memory.estimatedBytes / (1024 * 1024))); // 1MB baseline
        efficiency += memoryEfficiency * 0.3; // 30% weight on memory efficiency

        if (performance.hitRate < 0.6) {
            recommendations.push('Consider increasing cache TTL or improving cache key strategy');
        }
        
        if (memory.estimatedBytes > 512 * 1024) { // 512KB
            recommendations.push('Consider reducing cache size or implementing cache eviction');
        }
        
        if (performance.misses > performance.hits * 2) {
            recommendations.push('Consider preloading frequently accessed configurations');
        }

        return {
            efficiency: Math.min(1, efficiency),
            recommendations
        };
    }

    /**
     * Gets cache performance summary
     */
    getCacheSummary(): string {
        const stats = this.getCacheStats();
        const performance = this.getCachePerformance();
        const memory = this.getCacheMemoryUsage();
        const health = this.getCacheHealth();
        
        return `Cache Summary:
- Entries: ${stats.size}
- Hit Rate: ${(performance.hitRate * 100).toFixed(1)}%
- Memory Usage: ${(memory.estimatedBytes / 1024).toFixed(1)}KB
- Health: ${health.isHealthy ? 'Healthy' : 'Issues detected'}
- Issues: ${health.issues.length > 0 ? health.issues.join(', ') : 'None'}`;
    }

    private setCache(key: string, data: EmbeddingConfig, ttl: number): void {
        // Check if we need to clean up before adding
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            this.cleanupExpiredCache();
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    private getFallbackConfig(): EmbeddingConfig {
        // Fallback configuration when remote API is unavailable
        return {
            model: 'text-embedding-3-small',
            dimensions: 1536,
            maxTokens: 8191,
            timeout: 30000,
            retries: 3
        };
    }
}

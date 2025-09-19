"use strict";

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

export class ConfigurationCache<T = any> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private readonly maxSize: number;
    private readonly defaultTTL: number;

    constructor(maxSize: number = 100, defaultTTL: number = 3600000) { // 1 hour default TTL
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
    }

    /**
     * Get data from cache
     * @param key Cache key
     * @returns Cached data or null if not found/expired
     */
    get(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }

        if (this.isExpired(key)) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Set data in cache
     * @param key Cache key
     * @param value Data to cache
     * @param ttl Time to live in milliseconds (optional, uses default if not provided)
     */
    set(key: string, value: T, ttl?: number): void {
        // Check if we need to clean up before adding
        if (this.cache.size >= this.maxSize) {
            this.cleanup();
        }

        const entry: CacheEntry<T> = {
            data: value,
            timestamp: Date.now(),
            ttl: ttl || this.defaultTTL
        };

        this.cache.set(key, entry);
    }

    /**
     * Check if a cache entry is expired
     * @param key Cache key
     * @returns True if expired or not found
     */
    isExpired(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return true;
        }

        const now = Date.now();
        return (now - entry.timestamp) > entry.ttl;
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Remove a specific cache entry
     * @param key Cache key to remove
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Get cache size
     * @returns Number of entries in cache
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Check if cache has a key
     * @param key Cache key
     * @returns True if key exists and is not expired
     */
    has(key: string): boolean {
        return this.get(key) !== null;
    }

    /**
     * Get all cache keys
     * @returns Array of cache keys
     */
    keys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Clean up expired entries and enforce size limits
     */
    private cleanup(): void {
        const now = Date.now();
        const entriesToDelete: string[] = [];

        // Find expired entries
        for (const [key, entry] of this.cache.entries()) {
            if ((now - entry.timestamp) > entry.ttl) {
                entriesToDelete.push(key);
            }
        }

        // Remove expired entries
        entriesToDelete.forEach(key => this.cache.delete(key));

        // If still over size limit, remove oldest entries
        if (this.cache.size >= this.maxSize) {
            const sortedEntries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            const entriesToRemove = sortedEntries.slice(0, this.cache.size - this.maxSize + 1);
            entriesToRemove.forEach(([key]) => this.cache.delete(key));
        }
    }

    /**
     * Get cache statistics
     * @returns Cache statistics object
     */
    getStats(): {
        size: number;
        maxSize: number;
        defaultTTL: number;
        expiredEntries: number;
    } {
        const now = Date.now();
        let expiredEntries = 0;

        for (const entry of this.cache.values()) {
            if ((now - entry.timestamp) > entry.ttl) {
                expiredEntries++;
            }
        }

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            defaultTTL: this.defaultTTL,
            expiredEntries
        };
    }
}


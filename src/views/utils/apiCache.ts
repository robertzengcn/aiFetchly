/**
 * API Cache System for Email Extraction
 * Provides request caching, response compression, and lazy loading capabilities
 */

export interface CacheEntry<T = any> {
  data: T
  timestamp: number
  ttl: number
  compressed?: boolean
}

export interface CacheConfig {
  maxSize: number
  defaultTTL: number
  compressionEnabled: boolean
  lazyLoadingEnabled: boolean
}

export class ApiCache {
  private cache = new Map<string, CacheEntry>()
  private config: CacheConfig

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 100,
      defaultTTL: 5 * 60 * 1000, // 5 minutes
      compressionEnabled: true,
      lazyLoadingEnabled: true,
      ...config
    }
  }

  /**
   * Get cached data by key
   * @param key - Cache key
   * @returns Cached data or null if not found/expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return null
    }

    // Check if entry has expired
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  /**
   * Set cached data
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttl - Time to live in milliseconds
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.config.maxSize) {
      this.evictOldest()
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL,
      compressed: this.config.compressionEnabled
    }

    this.cache.set(key, entry)
  }

  /**
   * Remove entry from cache
   * @param key - Cache key to remove
   */
  delete(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now()
    let expiredCount = 0
    let totalSize = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        expiredCount++
      }
      totalSize += this.estimateSize(entry.data)
    }

    return {
      totalEntries: this.cache.size,
      expiredEntries: expiredCount,
      estimatedSize: totalSize,
      maxSize: this.config.maxSize
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Evict oldest entries when cache is full
   */
  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Date.now()

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Estimate size of cached data
   */
  private estimateSize(data: any): number {
    return JSON.stringify(data).length
  }
}

/**
 * Request caching wrapper for API calls
 */
export class RequestCache {
  private cache = new ApiCache()

  /**
   * Execute API request with caching
   * @param key - Cache key
   * @param requestFn - API request function
   * @param ttl - Cache TTL
   * @returns Cached or fresh data
   */
  async execute<T>(
    key: string,
    requestFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Try to get from cache first
    const cached = this.cache.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // Execute request and cache result
    const data = await requestFn()
    this.cache.set(key, data, ttl)
    
    return data
  }

  /**
   * Invalidate cache for specific key
   * @param key - Cache key to invalidate
   */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Invalidate cache for pattern
   * @param pattern - Regex pattern to match keys
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache['cache'].keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
      }
    }
  }
}

/**
 * Response compression utilities
 */
export class ResponseCompression {
  /**
   * Compress response data
   * @param data - Data to compress
   * @returns Compressed data
   */
  static compress(data: any): string {
    // Simple compression - in production, use proper compression
    const json = JSON.stringify(data)
    return btoa(json) // Base64 encoding as simple compression
  }

  /**
   * Decompress response data
   * @param compressed - Compressed data
   * @returns Decompressed data
   */
  static decompress(compressed: string): any {
    try {
      const json = atob(compressed) // Base64 decoding
      return JSON.parse(json)
    } catch {
      return null
    }
  }
}

/**
 * Lazy loading utilities for related data
 */
export class LazyLoader {
  private cache = new ApiCache()
  private loadingPromises = new Map<string, Promise<any>>()

  /**
   * Load data lazily with caching
   * @param key - Cache key
   * @param loaderFn - Function to load data
   * @param ttl - Cache TTL
   * @returns Promise that resolves to data
   */
  async load<T>(
    key: string,
    loaderFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Check cache first
    const cached = this.cache.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // Check if already loading
    const existingPromise = this.loadingPromises.get(key)
    if (existingPromise) {
      return existingPromise as Promise<T>
    }

    // Start loading
    const loadingPromise = loaderFn().then(data => {
      this.cache.set(key, data, ttl)
      this.loadingPromises.delete(key)
      return data
    }).catch(error => {
      this.loadingPromises.delete(key)
      throw error
    })

    this.loadingPromises.set(key, loadingPromise)
    return loadingPromise
  }

  /**
   * Preload data for better performance
   * @param keys - Array of keys to preload
   * @param loaderFn - Function to load data for each key
   */
  async preload<T>(
    keys: string[],
    loaderFn: (key: string) => Promise<T>
  ): Promise<void> {
    const promises = keys.map(key => 
      this.load(key, () => loaderFn(key))
    )
    await Promise.all(promises)
  }
}

/**
 * Pagination utilities for large datasets
 */
export class PaginationHelper {
  private cache = new RequestCache()

  /**
   * Get paginated data with caching
   * @param key - Cache key
   * @param page - Page number
   * @param size - Page size
   * @param fetcherFn - Function to fetch data
   * @returns Paginated data
   */
  async getPaginatedData<T>(
    key: string,
    page: number,
    size: number,
    fetcherFn: (page: number, size: number) => Promise<{
      data: T[]
      total: number
    }>
  ) {
    const cacheKey = `${key}_page_${page}_size_${size}`
    
    return this.cache.execute(cacheKey, () => fetcherFn(page, size))
  }

  /**
   * Preload adjacent pages for better UX
   * @param key - Cache key
   * @param currentPage - Current page
   * @param size - Page size
   * @param fetcherFn - Function to fetch data
   */
  async preloadAdjacentPages<T>(
    key: string,
    currentPage: number,
    size: number,
    fetcherFn: (page: number, size: number) => Promise<{
      data: T[]
      total: number
    }>
  ) {
    const pagesToPreload = [
      currentPage - 1,
      currentPage + 1
    ].filter(page => page > 0)

    const promises = pagesToPreload.map(page =>
      this.getPaginatedData(key, page, size, fetcherFn)
    )

    // Preload in background
    Promise.all(promises).catch(() => {
      // Ignore preload errors
    })
  }
}

// Global cache instances
export const requestCache = new RequestCache()
export const lazyLoader = new LazyLoader()
export const paginationHelper = new PaginationHelper()

// Cache keys for email extraction
export const cacheKeys = {
  taskList: 'email_extraction_task_list',
  taskDetail: (id: number) => `email_extraction_task_${id}`,
  taskResults: (id: number) => `email_extraction_results_${id}`,
  errorLog: (id: number) => `email_extraction_error_log_${id}`,
  taskUrls: (id: number) => `email_extraction_urls_${id}`,
  taskProxies: (id: number) => `email_extraction_proxies_${id}`
}

// Cache invalidation patterns
export const invalidationPatterns = {
  taskList: /email_extraction_task_list/,
  taskDetail: /email_extraction_task_\d+/,
  taskResults: /email_extraction_results_\d+/,
  allTasks: /email_extraction_task/,
  allResults: /email_extraction_results/
} 
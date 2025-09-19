"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
import { EmbeddingConfig } from "@/modules/llm/EmbeddingFactory";
import { CommonApiresp } from "@/entityTypes/commonType";

/**
 * Model information interface for remote configuration
 */
export interface ModelInfo {
    /** Model identifier (e.g., 'text-embedding-3-small') */
    model: string;
    /** Model category for performance classification */
    category: 'fast' | 'accurate' | 'balanced' | 'default';
    /** Priority score for model selection (higher = better) */
    priority: number;
    /** Current status of the model */
    status: 'active' | 'inactive' | 'deprecated';
}

/**
 * API client for RAG configuration management
 * 
 * Handles communication with remote configuration service to retrieve
 * embedding model configurations, refresh cache, and check service health.
 * 
 * @example
 * ```typescript
 * const api = new RagConfigApi();
 * const config = await api.getDefaultConfig();
 * if (config.success) {
 *   console.log('Using model:', config.data.model);
 * }
 * ```
 */
export class RagConfigApi {
    private _httpClient: HttpClient;

    /**
     * Creates a new RagConfigApi instance
     * Initializes the HTTP client for remote communication
     */
    constructor() {
        this._httpClient = new HttpClient();
    }

    /**
     * Retrieves the default embedding model configuration from remote server
     * 
     * @returns Promise resolving to configuration response
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const config = await api.getDefaultConfig();
     * if (config.success) {
     *   const model = config.data.model;
     *   const dimensions = config.data.dimensions;
     * }
     * ```
     */
    async getDefaultConfig(): Promise<CommonApiresp<EmbeddingConfig>> {
        return this._httpClient.get('/api/rag/config');
    }

    /**
     * Refreshes the configuration cache on the remote server
     * 
     * This forces the remote service to update its cached configurations
     * and should be called when configuration changes are expected.
     * 
     * @returns Promise resolving to refresh response
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * await api.refreshCache();
     * console.log('Configuration cache refreshed');
     * ```
     */
    async refreshCache(): Promise<CommonApiresp<void>> {
        const data = new FormData();
        return this._httpClient.post('/api/rag/refresh', data);
    }

    /**
     * Checks if the remote configuration service is online and available
     * 
     * @returns Promise resolving to boolean indicating service availability
     * @throws {Error} When network request fails (returns false)
     * 
     * @example
     * ```typescript
     * const isOnline = await api.isOnline();
     * if (isOnline) {
     *   console.log('Configuration service is available');
     * } else {
     *   console.log('Using offline fallback');
     * }
     * ```
     */
    async isOnline(): Promise<CommonApiresp<boolean>> {
        return this._httpClient.get('/api/rag/health');
    }

    /**
     * Send content to remote host and get embedding result
     * 
     * @param content - Text content to embed
     * @returns Promise resolving to embedding vector
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const embedding = await api.getEmbedding('Hello world');
     * console.log('Embedding dimensions:', embedding.data.length);
     * ```
     */
    async getEmbedding(content: string): Promise<CommonApiresp<number[]>> {
        const data = new FormData();
        data.append('content', content);
        return this._httpClient.post('/api/rag/embed', data);
    }
}

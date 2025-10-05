"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
import { EmbeddingConfig } from "@/modules/llm/EmbeddingFactory";
import { CommonApiresp } from "@/entityTypes/commonType";

/**
 * Embedding result interface for individual embedding
 */
export interface EmbeddingResult {
    /** Original text that was embedded */
    text: string;
    /** Embedding vector as array of numbers */
    embedding: number[];
    /** Dimensions of the embedding vector */
    dimensions: number;
    /** Model used for embedding */
    model: string;
}

/**
 * Embedding response data interface
 */
export interface EmbeddingResponseData {
    /** Array of embedding results */
    embeddings: EmbeddingResult[];
    /** Total number of embeddings processed */
    total_embeddings: number;
    /** Processing time in milliseconds */
    processing_time: number;
}

/**
 * Model information interface for remote configuration
 */
export interface ModelInfo {
    /** Model identifier (e.g., 'Qwen/Qwen3-Embedding-4B') */
    name: string;
    /** Model description */
    description: string;
    /** Maximum dimensions supported by the model */
    max_dimensions: number;
    /** Recommended dimensions for the model */
    recommended_dimensions: number;
}

/**
 * Available models response interface
 */
export interface AvailableModelsResponse {
    /** Array of available models */
    models: Record<string, ModelInfo>;
    /** Default model name */
    default_model: string;
    /** Total number of models */
    total_models: number;
    /** Number of configured models */
    configured_models: number;
}

/**
 * Chunking configuration interface for remote configuration
 */
export interface ChunkingConfig {
    /** Size of each chunk in characters */
    chunkSize: number;
    /** Overlap size between chunks in characters */
    overlapSize: number;
    /** Chunking strategy to use */
    strategy: 'sentence' | 'paragraph' | 'semantic' | 'fixed';
    /** Whether to preserve whitespace in chunks */
    preserveWhitespace: boolean;
    /** Minimum chunk size to avoid very small chunks */
    minChunkSize: number;
    /** Maximum chunk size to avoid very large chunks */
    maxChunkSize?: number;
    /** Whether to split on sentences when possible */
    splitOnSentences?: boolean;
    /** Whether to split on paragraphs when possible */
    splitOnParagraphs?: boolean;
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
        return this._httpClient.get('/api/healthcheck');
    }

    /**
     * Send content to remote host and get embedding result
     * 
     * @param texts - Array of text content to embed
     * @param modelName - Optional model name to use for embedding generation
     * @returns Promise resolving to embedding result objects
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const embedding = await api.generateEmbedding(['Hello world']);
     * console.log('Embedding dimensions:', embedding.data[0].dimensions);
     * console.log('Model used:', embedding.data[0].model);
     * console.log('Vector length:', embedding.data[0].embedding.length);
     * 
     * // Multiple texts with specific model
     * const embeddings = await api.generateEmbedding(['Hello world', 'Test code is necessary'], 'text-embedding-3-small');
     * console.log('Number of embeddings:', embeddings.data.length);
     * ```
     */
    async generateEmbedding(texts: string[], modelName: string): Promise<CommonApiresp<EmbeddingResult[]>> {
        const data = {
            texts: texts,
            model_name: modelName
        };
        
        const response = await this._httpClient.postJson('/api/ai/embedding/generate', data);
        
        // Extract the embedding results from the nested response structure
        if (response.status && response.data && response.data.data && response.data.data.embeddings) {
            return {
                status: response.status,
                code: response.code,
                msg: response.msg,
                data: response.data.data.embeddings
            };
        }
        
        // Return error response if structure is unexpected
        return {
            status: false,
            code: response.code || 50000,
            msg: response.msg || 'Failed to extract embedding from response',
            data: undefined
        };
    }

    /**
     * Retrieves the chunking configuration from remote server
     * 
     * @returns Promise resolving to chunking configuration response
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const config = await api.getChunkingConfig();
     * if (config.success) {
     *   const chunkSize = config.data.chunkSize;
     *   const strategy = config.data.strategy;
     * }
     * ```
     */
    async getChunkingConfig(): Promise<CommonApiresp<ChunkingConfig>> {
        return this._httpClient.get('/api/ai/chunking/info');
    }

    /**
     * Retrieves available embedding models from remote server
     * 
     * @returns Promise resolving to available models response
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const models = await api.getAvailableEmbeddingModels();
     * if (models.success) {
     *   console.log('Available models:', models.data);
     *   console.log('Default model:', models.data.default_model);
     * }
     * ```
     */
    async getAvailableEmbeddingModels(): Promise<CommonApiresp<AvailableModelsResponse>> {
        return this._httpClient.get('/api/ai/embedding/models');
    }
}

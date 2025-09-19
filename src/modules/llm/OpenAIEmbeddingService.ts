import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';
import { EmbeddingConfig } from './EmbeddingFactory';
import OpenAI from 'openai';

/**
 * OpenAI embedding service implementation
 * Extends existing OpenaiLlm.ts patterns for consistency
 */
export class OpenAIEmbeddingService implements EmbeddingImpl {
    private client: OpenAI;
    private model: string;
    private provider: string;
    private dimensions: number;
    private maxRetries: number;
    private isInitialized: boolean = false;

    constructor(config: EmbeddingConfig) {
        this.model = config.model;
        this.provider = 'openai';
        this.dimensions = config.dimensions || 1536; // Default for text-embedding-ada-002
        // this.maxRetries = config.maxRetries || 3;

        // if (!config.apiKey) {
        //     throw new Error('OpenAI API key is required');
        // }

        this.client = new OpenAI({
            // apiKey: config.apiKey,
            maxRetries: this.maxRetries
        });
    }

    /**
     * Initialize the embedding service
     */
    async initialize(): Promise<void> {
        try {
            // Test the connection with a simple request
            await this.client.models.list();
            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to initialize OpenAI embedding service:', error);
            throw new Error('Failed to initialize OpenAI embedding service');
        }
    }

    /**
     * Generate embedding for a single text
     */
    async embedText(text: string): Promise<number[]> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const response = await this.client.embeddings.create({
                model: this.model,
                input: text,
            });

            return response.data[0].embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generate embeddings for multiple texts in batch
     */
    async embedBatch(texts: string[]): Promise<number[][]> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // OpenAI supports batch processing up to 2048 inputs
            const batchSize = 100; // Process in smaller batches to avoid rate limits
            const results: number[][] = [];

            for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                
                const response = await this.client.embeddings.create({
                    model: this.model,
                    input: batch,
                });

                const batchEmbeddings = response.data.map(item => item.embedding);
                results.push(...batchEmbeddings);

                // Add small delay between batches to respect rate limits
                if (i + batchSize < texts.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            return results;
        } catch (error) {
            console.error('Error generating batch embeddings:', error);
            throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get the dimensions of the embedding vectors
     */
    getDimensions(): number {
        return this.dimensions;
    }

    /**
     * Set the model for this embedding implementation
     */
    setModel(model: string): void {
        this.model = model;
        // Update dimensions based on model
        this.updateDimensionsForModel(model);
    }

    /**
     * Validate if the current model is supported
     */
    async validateModel(): Promise<boolean> {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            // Test with a simple embedding request
            await this.embedText('test');
            return true;
        } catch (error) {
            console.error('Model validation failed:', error);
            return false;
        }
    }

    /**
     * Get the current model identifier
     */
    getModel(): string {
        return this.model;
    }

    /**
     * Get provider information
     */
    getProvider(): string {
        return this.provider;
    }

    /**
     * Check if the implementation is ready to use
     */
    isReady(): boolean {
        return this.isInitialized;
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        // OpenAI client doesn't need explicit cleanup
        this.isInitialized = false;
    }

    /**
     * Update dimensions based on model
     */
    private updateDimensionsForModel(model: string): void {
        // Common OpenAI embedding model dimensions
        const modelDimensions: Record<string, number> = {
            'text-embedding-ada-002': 1536,
            'text-embedding-3-small': 1536,
            'text-embedding-3-large': 3072,
            'text-embedding-3-large-256': 256,
            'text-embedding-3-large-1024': 1024,
        };

        this.dimensions = modelDimensions[model] || 1536;
    }

    /**
     * Get cost estimation for embedding generation
     * @param textLength - Length of text to embed
     * @returns Estimated cost in USD
     */
    getCostEstimate(textLength: number): number {
        // Rough cost estimation based on OpenAI pricing
        const tokensPerChar = 0.25; // Rough estimate
        const tokens = Math.ceil(textLength * tokensPerChar);
        
        // Pricing per 1K tokens (as of 2024)
        const pricePer1K = 0.0001; // $0.0001 per 1K tokens for text-embedding-ada-002
        
        return (tokens / 1000) * pricePer1K;
    }

    /**
     * Get rate limit information
     * @returns Rate limit details
     */
    getRateLimitInfo(): {
        requestsPerMinute: number;
        tokensPerMinute: number;
        currentUsage?: number;
    } {
        return {
            requestsPerMinute: 3000, // Default OpenAI rate limit
            tokensPerMinute: 150000, // Default OpenAI rate limit
        };
    }
}

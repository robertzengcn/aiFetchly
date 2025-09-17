import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';
import { AbstractTranslateFactory } from '@/modules/AbstractTranslateFactory';
import { LlmCongfig } from '@/entityTypes/commonType';
import { OpenAIEmbeddingService } from './OpenAIEmbeddingService';
import { HuggingFaceEmbeddingService } from './HuggingFaceEmbeddingService';
import { OllamaEmbeddingService } from './OllamaEmbeddingService';
import { EmbeddingProviderEnum } from '@/config/generate';

/**
 * Configuration for embedding models
 */
export interface EmbeddingConfig {
    model: string;
    provider: string;
    apiKey?: string;
    url?: string;
    dimensions?: number;
    maxTokens?: number;
    temperature?: number;
    maxRetries?: number;
}

/**
 * Embedding factory that creates embedding implementations
 * Follows the same pattern as LlmFactory for consistency
 */
export class EmbeddingFactory extends AbstractTranslateFactory {
    private embeddingRegistry: Map<string, new (config: EmbeddingConfig) => EmbeddingImpl> = new Map();
    private activeEmbeddings: Map<string, EmbeddingImpl> = new Map();

    constructor() {
        super();
        this.initializeDefaultEmbeddings();
    }

    /**
     * Get LLM tool (required by AbstractTranslateFactory)
     * Not used for embeddings, returns undefined
     */
    public getLlmTool(toolname: string, llmconfig: LlmCongfig): any | undefined {
        return undefined;
    }

    /**
     * Get traditional tool (required by AbstractTranslateFactory)
     * Not used for embeddings, returns undefined
     */
    public getTraditionalTool(name: string, config: any): any | undefined {
        return undefined;
    }

    /**
     * Create an embedding implementation
     * @param provider - Provider name (e.g., 'openai', 'huggingface', 'ollama')
     * @param config - Configuration for the embedding model
     * @returns Embedding implementation instance
     */
    public createEmbedding(provider: string, config: EmbeddingConfig): EmbeddingImpl | undefined {
        const EmbeddingClass = this.embeddingRegistry.get(provider);
        if (!EmbeddingClass) {
            throw new Error(`Unsupported embedding provider: ${provider}`);
        }

        try {
            const embedding = new EmbeddingClass(config);
            const key = `${provider}:${config.model}`;
            this.activeEmbeddings.set(key, embedding);
            return embedding;
        } catch (error) {
            console.error(`Failed to create embedding for provider ${provider}:`, error);
            return undefined;
        }
    }

    /**
     * Get an existing embedding implementation
     * @param provider - Provider name
     * @param model - Model name
     * @returns Existing embedding instance or undefined
     */
    public getEmbedding(provider: string, model: string): EmbeddingImpl | undefined {
        const key = `${provider}:${model}`;
        return this.activeEmbeddings.get(key);
    }

    /**
     * Register a new embedding implementation
     * @param provider - Provider name
     * @param EmbeddingClass - Embedding implementation class
     */
    public registerEmbedding(provider: string, EmbeddingClass: new (config: EmbeddingConfig) => EmbeddingImpl): void {
        this.embeddingRegistry.set(provider, EmbeddingClass);
    }

    /**
     * Unregister an embedding implementation
     * @param provider - Provider name to unregister
     */
    public unregisterEmbedding(provider: string): void {
        this.embeddingRegistry.delete(provider);
    }

    /**
     * Get list of supported providers
     * @returns Array of supported provider names
     */
    public getSupportedProviders(): string[] {
        return Array.from(this.embeddingRegistry.keys());
    }

    /**
     * Get all active embeddings
     * @returns Map of active embeddings
     */
    public getActiveEmbeddings(): Map<string, EmbeddingImpl> {
        return new Map(this.activeEmbeddings);
    }

    /**
     * Remove an active embedding
     * @param provider - Provider name
     * @param model - Model name
     */
    public removeEmbedding(provider: string, model: string): void {
        const key = `${provider}:${model}`;
        const embedding = this.activeEmbeddings.get(key);
        if (embedding) {
            embedding.cleanup().catch(console.error);
            this.activeEmbeddings.delete(key);
        }
    }

    /**
     * Clean up all active embeddings
     */
    public async cleanupAll(): Promise<void> {
        const cleanupPromises = Array.from(this.activeEmbeddings.values()).map(embedding => 
            embedding.cleanup().catch(console.error)
        );
        await Promise.all(cleanupPromises);
        this.activeEmbeddings.clear();
    }

    /**
     * Initialize default embedding implementations
     * This will be populated when we create the actual implementations
     */
    private initializeDefaultEmbeddings(): void {
        // Register OpenAI embedding service
        this.embeddingRegistry.set(EmbeddingProviderEnum.OPENAI, OpenAIEmbeddingService);
        
        // Register HuggingFace embedding service
        this.embeddingRegistry.set(EmbeddingProviderEnum.HUGGINGFACE, HuggingFaceEmbeddingService);
        
        // Register Ollama embedding service
        this.embeddingRegistry.set(EmbeddingProviderEnum.OLLAMA, OllamaEmbeddingService);
    }

    /**
     * Validate embedding configuration
     * @param config - Configuration to validate
     * @returns True if configuration is valid
     */
    public validateConfig(config: EmbeddingConfig): boolean {
        if (!config.model || !config.provider) {
            return false;
        }

        if (!this.embeddingRegistry.has(config.provider)) {
            return false;
        }

        // Provider-specific validation can be added here
        return true;
    }

    /**
     * Get embedding statistics
     * @returns Statistics about active embeddings
     */
    public getStats(): {
        totalProviders: number;
        activeEmbeddings: number;
        supportedProviders: string[];
    } {
        return {
            totalProviders: this.embeddingRegistry.size,
            activeEmbeddings: this.activeEmbeddings.size,
            supportedProviders: this.getSupportedProviders()
        };
    }
}

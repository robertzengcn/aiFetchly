import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';
import { EmbeddingConfig } from './EmbeddingFactory';

/**
 * Ollama embedding service implementation
 * Extends existing OllamaLlm.ts patterns for consistency
 */
export class OllamaEmbeddingService implements EmbeddingImpl {
    private model: string;
    private provider: string;
    private dimensions: number;
    private url: string;
    private isInitialized: boolean = false;

    constructor(config: EmbeddingConfig) {
        this.model = config.model;
        this.provider = 'ollama';
        this.url = config.url || 'http://localhost:11434';
        this.dimensions = config.dimensions || 4096; // Default for most Ollama embedding models
    }

    /**
     * Initialize the embedding service
     */
    async initialize(): Promise<void> {
        try {
            // Test the connection with a simple request
            const response = await fetch(`${this.url}/api/tags`);
            if (!response.ok) {
                throw new Error(`Ollama server not available at ${this.url}`);
            }

            const data = await response.json();
            const modelExists = data.models?.some((m: any) => m.name.includes(this.model));
            
            if (!modelExists) {
                throw new Error(`Model ${this.model} not found in Ollama. Please pull it first.`);
            }

            this.isInitialized = true;
            console.log(`Ollama embedding model ${this.model} initialized successfully`);
        } catch (error) {
            console.error('Failed to initialize Ollama embedding service:', error);
            throw new Error('Failed to initialize Ollama embedding service');
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
            const response = await fetch(`${this.url}/api/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    prompt: text,
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const embedding = data.embedding;
            
            // Update dimensions if not set
            if (this.dimensions === 4096 && embedding.length !== 4096) {
                this.dimensions = embedding.length;
            }

            return embedding;
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
            const results: number[][] = [];
            const batchSize = 4; // Process in smaller batches to avoid overwhelming Ollama

            for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                
                const batchPromises = batch.map(text => this.embedText(text));
                const batchResults = await Promise.all(batchPromises);
                
                results.push(...batchResults);

                // Add small delay between batches
                if (i + batchSize < texts.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
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
        this.isInitialized = false; // Need to reinitialize with new model
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
        // Ollama doesn't need explicit cleanup
        this.isInitialized = false;
    }

    /**
     * Update dimensions based on model
     */
    private updateDimensionsForModel(model: string): void {
        // Common Ollama embedding model dimensions
        const modelDimensions: Record<string, number> = {
            'nomic-embed-text': 768,
            'mxbai-embed-large': 1024,
            'all-minilm': 384,
            'bge-large-en': 1024,
            'bge-base-en': 768,
            'bge-small-en': 384,
        };

        this.dimensions = modelDimensions[model] || 4096;
    }

    /**
     * Get available models from Ollama
     * @returns Array of available model names
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.url}/api/tags`);
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            return data.models?.map((m: any) => m.name) || [];
        } catch (error) {
            console.error('Error fetching available models:', error);
            return [];
        }
    }

    /**
     * Pull a model from Ollama registry
     * @param model - Model name to pull
     * @returns Promise resolving when pull is complete
     */
    async pullModel(model: string): Promise<void> {
        try {
            const response = await fetch(`${this.url}/api/pull`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: model,
                    stream: false,
                }),
            });

            if (!response.ok) {
                throw new Error(`Failed to pull model: ${response.status}`);
            }

            console.log(`Model ${model} pulled successfully`);
        } catch (error) {
            console.error('Error pulling model:', error);
            throw new Error(`Failed to pull model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get model information
     * @returns Model details
     */
    async getModelInfo(): Promise<{
        name: string;
        size: number;
        digest: string;
        modified_at: string;
    } | null> {
        try {
            const models = await this.getAvailableModels();
            const modelInfo = models.find(name => name.includes(this.model));
            
            if (!modelInfo) {
                return null;
            }

            // This is a simplified version - in practice you'd need to parse the model details
            return {
                name: modelInfo,
                size: 0, // Would need to parse from Ollama response
                digest: '', // Would need to parse from Ollama response
                modified_at: '', // Would need to parse from Ollama response
            };
        } catch (error) {
            console.error('Error getting model info:', error);
            return null;
        }
    }

    /**
     * Check if Ollama server is running
     * @returns True if server is accessible
     */
    async isServerRunning(): Promise<boolean> {
        try {
            const response = await fetch(`${this.url}/api/tags`);
            return response.ok;
        } catch {
            return false;
        }
    }
}

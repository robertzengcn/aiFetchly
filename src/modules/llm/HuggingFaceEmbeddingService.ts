import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';
import { EmbeddingConfig } from './EmbeddingFactory';

/**
 * HuggingFace embedding service implementation
 * Uses transformers.js for local embeddings
 */
export class HuggingFaceEmbeddingService implements EmbeddingImpl {
    private model: string;
    private provider: string;
    private dimensions: number;
    private isInitialized: boolean = false;
    private pipeline: any = null;

    constructor(config: EmbeddingConfig) {
        this.model = config.model;
        this.provider = 'huggingface';
        this.dimensions = config.dimensions || 384; // Default for all-MiniLM-L6-v2
    }

    /**
     * Initialize the embedding service
     */
    async initialize(): Promise<void> {
        try {
            // Dynamic import to avoid bundling issues
            const { pipeline } = await import('@xenova/transformers');
            
            this.pipeline = await pipeline(
                'feature-extraction',
                this.model,
                {
                    quantized: true, // Use quantized model for better performance
                    progress_callback: (progress: any) => {
                        console.log(`Loading model: ${Math.round(progress.loaded / progress.total * 100)}%`);
                    }
                }
            );

            this.isInitialized = true;
            console.log(`HuggingFace embedding model ${this.model} loaded successfully`);
        } catch (error) {
            console.error('Failed to initialize HuggingFace embedding service:', error);
            throw new Error('Failed to initialize HuggingFace embedding service');
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
            const result = await this.pipeline(text, {
                pooling: 'mean', // Use mean pooling for sentence embeddings
                normalize: true, // Normalize embeddings
            });

            // Convert tensor to array
            const embedding = Array.from(result.data) as number[];
            this.dimensions = embedding.length;
            
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
            const batchSize = 8; // Process in smaller batches to avoid memory issues

            for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                
                const batchResults = await Promise.all(
                    batch.map(text => this.embedText(text))
                );
                
                results.push(...batchResults);
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
        if (this.pipeline) {
            // Clean up the pipeline
            this.pipeline = null;
        }
        this.isInitialized = false;
    }

    /**
     * Update dimensions based on model
     */
    private updateDimensionsForModel(model: string): void {
        // Common HuggingFace embedding model dimensions
        const modelDimensions: Record<string, number> = {
            'sentence-transformers/all-MiniLM-L6-v2': 384,
            'sentence-transformers/all-mpnet-base-v2': 768,
            'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2': 384,
            'sentence-transformers/paraphrase-multilingual-mpnet-base-v2': 768,
            'sentence-transformers/all-MiniLM-L12-v2': 384,
            'sentence-transformers/multi-qa-MiniLM-L6-cos-v1': 384,
            'sentence-transformers/multi-qa-mpnet-base-cos-v1': 768,
        };

        this.dimensions = modelDimensions[model] || 384;
    }

    /**
     * Get model information
     * @returns Model details
     */
    getModelInfo(): {
        name: string;
        dimensions: number;
        maxSequenceLength: number;
        language: string[];
    } {
        return {
            name: this.model,
            dimensions: this.dimensions,
            maxSequenceLength: 512, // Default for most sentence transformers
            language: ['en', 'multilingual'] // Most models support multiple languages
        };
    }

    /**
     * Check if model supports GPU acceleration
     * @returns True if GPU is available and supported
     */
    async supportsGPU(): Promise<boolean> {
        try {
            // Check if WebGL is available for GPU acceleration
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            return gl !== null;
        } catch {
            return false;
        }
    }

    /**
     * Get memory usage information
     * @returns Memory usage details
     */
    getMemoryInfo(): {
        modelSize: string;
        estimatedMemoryUsage: string;
    } {
        // Rough estimates for common models
        const modelSizes: Record<string, string> = {
            'sentence-transformers/all-MiniLM-L6-v2': '~80MB',
            'sentence-transformers/all-mpnet-base-v2': '~420MB',
            'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2': '~470MB',
        };

        return {
            modelSize: modelSizes[this.model] || 'Unknown',
            estimatedMemoryUsage: '~2x model size for inference'
        };
    }
}

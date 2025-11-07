/**
 * Interface for embedding implementations
 * Provides a consistent contract for different embedding providers
 */
export interface EmbeddingImpl {
    /**
     * Generate embedding for a single text
     * @param text - Text to embed
     * @returns Promise resolving to embedding vector
     */
    embedText(text: string): Promise<number[]>;

    /**
     * Generate embeddings for multiple texts in batch
     * @param texts - Array of texts to embed
     * @returns Promise resolving to array of embedding vectors
     */
    embedBatch(texts: string[]): Promise<number[][]>;

    /**
     * Get the dimensions of the embedding vectors
     * @returns Number of dimensions in the embedding vector
     */
    getDimensions(): number;

    /**
     * Set the model for this embedding implementation
     * @param model - Model identifier
     */
    setModel(model: string): void;

    /**
     * Validate if the current model is supported
     * @returns True if model is valid and ready to use
     */
    validateModel(): Promise<boolean>;

    /**
     * Get the current model identifier
     * @returns Current model name/ID
     */
    getModel(): string;

    /**
     * Get provider information
     * @returns Provider name (e.g., 'openai', 'huggingface', 'ollama')
     */
    getProvider(): string;

    /**
     * Check if the implementation is ready to use
     * @returns True if ready, false otherwise
     */
    isReady(): boolean;

    /**
     * Initialize the embedding implementation
     * @returns Promise resolving when initialization is complete
     */
    initialize(): Promise<void>;

    /**
     * Clean up resources
     * @returns Promise resolving when cleanup is complete
     */
    cleanup(): Promise<void>;
}

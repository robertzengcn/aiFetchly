/**
 * Vector database configuration interface
 */
export interface VectorDatabaseConfig {
    indexPath: string;
    modelId: string;
    dimensions: number;
    indexType?: string;
    [key: string]: unknown; // Allow for database-specific configuration
}

/**
 * Search result interface
 */
export interface VectorSearchResult {
    indices: number[];
    distances: number[];
}

/**
 * Index statistics interface
 */
export interface IndexStats {
    totalVectors: number;
    dimension: number;
    indexType: string;
    isInitialized: boolean;
    modelId: string;
    dimensions: number;
}

/**
 * Vector database interface for different implementations
 */
export interface IVectorDatabase {
    /**
     * Initialize the vector database
     */
    initialize(): Promise<void>;

    /**
     * Create a new index with the given configuration
     */
    createIndex(config: VectorDatabaseConfig): Promise<void>;

    /**
     * Load an existing index from disk
     */
    loadIndex(config: VectorDatabaseConfig): Promise<void>;

    /**
     * Save the index to disk
     */
    saveIndex(): Promise<void>;

    /**
     * Add vectors to the index
     */
    addVectors(vectors: number[][]): Promise<void>;

    /**
     * Search for similar vectors
     */
    search(queryVector: number[], k: number): Promise<VectorSearchResult>;

    /**
     * Get index statistics
     */
    getIndexStats(): IndexStats;

    /**
     * Reset the index
     */
    resetIndex(): Promise<void>;

    /**
     * Optimize the index
     */
    optimizeIndex(): Promise<void>;

    /**
     * Backup the index
     */
    backupIndex(backupPath: string): Promise<void>;

    /**
     * Restore index from backup
     */
    restoreIndex(backupPath: string): Promise<void>;

    /**
     * Check if index exists
     */
    indexExists(): boolean;

    /**
     * Get index file size
     */
    getIndexFileSize(): number;

    /**
     * Clean up resources
     */
    cleanup(): Promise<void>;

    /**
     * Check if the database is initialized
     */
    isInitialized(): boolean;
}

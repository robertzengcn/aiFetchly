/**
 * Vector database configuration interface
 */
export interface VectorDatabaseConfig {
    indexPath: string;
    modelName: string;
    dimensions: number;
    indexType?: string;
    documentId?: number; // Document-specific index support
    documentIndexPath?: string;
    [key: string]: unknown; // Allow for database-specific configuration
}

/**
 * Search result interface
 */
export interface VectorSearchResult {
    indices: number[];
    distances: number[];
    chunkIds: number[];
}

/**
 * Index statistics interface
 */
export interface IndexStats {
    totalVectors: number;
    dimension: number;
    indexType: string;
    isInitialized: boolean;
    modelName: string;
    // dimensions: number;
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
    createIndex(config: VectorDatabaseConfig): Promise<string>;

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
     * @param vectors - Array of vectors to add
     * @param chunkIds - Array of chunk IDs corresponding to vectors
     */
    addVectors(vectors: number[], chunkIds: number): Promise<void>;

    /**
     * Search for similar vectors
     */
    search(queryVector: number[], k: number, distance?: number): Promise<VectorSearchResult>;

    /**
     * Get index statistics
     */
    getIndexStats(): IndexStats;

    /**
     * Get total number of vectors in the index
     */
    getTotalVectors(): number;

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

    /**
     * Delete a document-specific index
     * @param documentId - Document ID to delete index for
     */
    deleteDocumentIndex(documentId: number): Promise<void>;

    /**
     * Check if a document-specific index exists
     * @param documentId - Document ID to check
     */
    documentIndexExists(documentId: number): boolean;
}

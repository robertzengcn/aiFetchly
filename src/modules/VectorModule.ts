import { EntityManager } from 'typeorm';
import { VectorModel } from '@/model/Vector.model';
import { VectorEntity, VectorMetadataEntity } from '@/entity/Vector.entity';
import { BaseModule } from '@/modules/baseModule';
import { VectorSearchResult } from '@/modules/interface/IVectorDatabase';

/**
 * Vector module for managing vector operations
 * Uses sqlite-vec extension loaded in the main database connection
 */
export class VectorModule extends BaseModule {
    private vectorModel: VectorModel;

    constructor() {
        super();
        this.vectorModel = new VectorModel(this.dbpath);
    }

    /**
     * Save a single vector entity
     */
    async saveVector(vector: VectorEntity): Promise<VectorEntity> {
        return await this.vectorModel.saveVector(vector);
    }

    /**
     * Save multiple vector entities
     */
    async saveVectors(vectors: VectorEntity[]): Promise<VectorEntity[]> {
        return await this.vectorModel.saveVectors(vectors);
    }

    /**
     * Save vectors within a transaction (uses EntityManager)
     */
    async saveVectorsInTransaction(manager: EntityManager, vectors: VectorEntity[]): Promise<VectorEntity[]> {
        return await manager.save(VectorEntity, vectors);
    }

    /**
     * Find vectors by chunk ID
     */
    async findByChunkId(chunkId: number): Promise<VectorEntity[]> {
        return await this.vectorModel.findByChunkId(chunkId);
    }

    /**
     * Find vector by ID
     */
    async findById(id: number): Promise<VectorEntity | null> {
        return await this.vectorModel.findById(id);
    }

    /**
     * Delete vector by ID
     */
    async deleteById(id: number): Promise<boolean> {
        return await this.vectorModel.deleteById(id);
    }

    /**
     * Delete vectors by chunk ID
     */
    async deleteByChunkId(chunkId: number): Promise<number> {
        return await this.vectorModel.deleteByChunkId(chunkId);
    }

    /**
     * Delete vectors by multiple chunk IDs (batch delete)
     */
    async deleteByChunkIds(chunkIds: number[]): Promise<number> {
        return await this.vectorModel.deleteByChunkIds(chunkIds);
    }

    /**
     * Get total vector count
     */
    async getTotalCount(): Promise<number> {
        return await this.vectorModel.getTotalCount();
    }

    /**
     * Delete all vectors
     */
    async deleteAll(): Promise<number> {
        return await this.vectorModel.deleteAll();
    }

    /**
     * Get vectors by chunk IDs
     */
    async findByChunkIds(chunkIds: number[]): Promise<VectorEntity[]> {
        return await this.vectorModel.findByChunkIds(chunkIds);
    }

    /**
     * Check if vectors exist for chunk IDs (synchronous)
     * Uses underlying better-sqlite3 database for synchronous queries
     */
    hasVectorsForChunkIds(chunkIds: number[]): boolean {
        return this.vectorModel.hasVectorsForChunkIds(chunkIds);
    }

    /**
     * Add a vector to a vec0 virtual table
     * Delegates to VectorModel's addVectorToVirtualTable method
     * 
     * @param vectors - Vector as number array
     * @param chunkId - Chunk ID to associate with the vector
     * @param virtualTableName - Name of the vec0 virtual table
     * @param dimension - Expected dimension of the vector (for validation)
     */
    async addVectorToVirtualTable(
        vectors: number[], 
        chunkId: number, 
        virtualTableName: string,
        dimension: number
    ): Promise<void> {
        return await this.vectorModel.addVectorToVirtualTable(vectors, chunkId, virtualTableName, dimension);
    }

    /**
     * Delete vectors from a vec0 virtual table by chunk IDs
     * Delegates to VectorModel's deleteVectorsFromVirtualTable method
     * 
     * @param chunkIds - Array of chunk IDs to delete
     * @param virtualTableName - Name of the vec0 virtual table
     */
    async deleteVectorsFromVirtualTable(chunkIds: number[], virtualTableName: string): Promise<void> {
        return await this.vectorModel.deleteVectorsFromVirtualTable(chunkIds, virtualTableName);
    }

    /**
     * Search for similar vectors using vec_distance_l2 function
     * Delegates to VectorModel's searchSimilarVectors method
     * 
     * @param queryVector - Query vector as number array
     * @param k - Number of similar vectors to return (default: 10)
     * @param dimension - Dimension of the vectors (optional, for validation)
     * @param distance - Maximum distance threshold to filter results (optional)
     * @returns VectorSearchResult with chunkIds, distances, and indices
     */
    async searchSimilarVectors(queryVector: number[], k: number = 10, dimension?: number, distance?: number): Promise<VectorSearchResult> {
        return await this.vectorModel.searchSimilarVectors(queryVector, k, dimension, distance);
    }

    /**
     * Search for similar vectors with optional vec0 virtual table optimization
     * Delegates to VectorModel's searchSimilarVectorsWithVec0 method
     * 
     * @param queryVector - Query vector as number array
     * @param k - Number of similar vectors to return (default: 10)
     * @param dimension - Dimension of the vectors (optional, for validation)
     * @param vecIndexName - Name of vec0 virtual table (default: 'vec_index')
     * @returns VectorSearchResult with chunkIds, distances, and indices
     */
    async searchSimilarVectorsWithVec0(
        queryVector: number[], 
        k: number = 10, 
        dimension?: number,
        vecIndexName: string = 'vec_index'
    ): Promise<VectorSearchResult> {
        return await this.vectorModel.searchSimilarVectorsWithVec0(queryVector, k, dimension, vecIndexName);
    }

    /**
     * Get vectors by similarity to a query vector
     * Returns the actual VectorEntity objects along with their distances
     * 
     * @param queryVector - Query vector as number array
     * @param k - Number of similar vectors to return (default: 10)
     * @param dimension - Dimension of the vectors
     * @returns Array of objects containing VectorEntity and distance
     */
    async findSimilarVectors(
        queryVector: number[], 
        k: number = 10, 
        dimension?: number
    ): Promise<Array<{ vector: VectorEntity; distance: number }>> {
        const searchResult = await this.vectorModel.searchSimilarVectors(queryVector, k, dimension);
        
        if (searchResult.chunkIds.length === 0) {
            return [];
        }

        // Get the actual vector entities by chunk IDs
        const vectors = await this.vectorModel.findByChunkIds(searchResult.chunkIds);

        // Create a map of chunk_id to vector for quick lookup
        const vectorMap = new Map<number, VectorEntity>();
        for (const vector of vectors) {
            vectorMap.set(vector.chunk_id, vector);
        }

        // Combine results with distances, maintaining order
        const results: Array<{ vector: VectorEntity; distance: number }> = [];
        for (let i = 0; i < searchResult.chunkIds.length; i++) {
            const chunkId = searchResult.chunkIds[i];
            const vector = vectorMap.get(chunkId);
            if (vector) {
                results.push({
                    vector,
                    distance: searchResult.distances[i]
                });
            }
        }

        return results;
    }

    /**
     * Create or ensure vec0 virtual table exists for a model and dimension combination
     * This method will:
     * 1. Get or create metadata entry for the model/dimension
     * 2. Create the virtual table if it doesn't exist
     * Delegates to VectorModel's ensureVirtualTable method
     * 
     * @param modelName - Name of the embedding model
     * @param dimension - Dimension of the embedding vectors
     * @param options - Optional configuration (indexType, virtualTableName)
     * @returns Promise that resolves to the metadata entity
     */
    async ensureVirtualTable(
        modelName: string,
        dimension: number,
        options: {
            indexType?: string;
            virtualTableName?: string;
        } = {}
    ): Promise<VectorMetadataEntity> {
        return await this.vectorModel.ensureVirtualTable(modelName, dimension, options);
    }

    /**
     * Create vec0 virtual table using metadata entity
     * This method creates the virtual table based on the provided metadata
     * 
     * @param metadata - VectorMetadataEntity containing model, dimension, and virtual table name
     * @returns Promise that resolves when the virtual table is created
     */
    async createVirtualTableFromMetadata(metadata: VectorMetadataEntity): Promise<void> {
        const exists = await this.vectorModel.virtualTableExists(metadata.virtual_table_name);
        
        if (!exists) {
            await this.vectorModel.ensureVirtualTable(
                metadata.model_name,
                metadata.dimension,
                {
                    indexType: metadata.index_type,
                    virtualTableName: metadata.virtual_table_name
                }
            );
        }
    }

    /**
     * Check if a virtual table exists
     * Delegates to VectorModel's virtualTableExists method
     * 
     * @param virtualTableName - Name of the virtual table to check
     * @returns Promise that resolves to true if the virtual table exists
     */
    async virtualTableExists(virtualTableName: string): Promise<boolean> {
        return await this.vectorModel.virtualTableExists(virtualTableName);
    }

    /**
     * Get access to the underlying SQLite database connection
     * Used for raw queries on virtual tables
     * 
     * @returns The SqliteDb instance
     */
    getDbConnection() {
        return this.sqliteDb;
    }
}


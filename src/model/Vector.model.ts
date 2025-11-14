import { Repository } from 'typeorm';
import { VectorEntity } from '@/entity/Vector.entity';
import { BaseDb } from '@/model/Basedb';
import { VectorSearchResult } from '@/modules/interface/IVectorDatabase';
import { VectorMetadataModel } from '@/model/VectorMetadata.model';
import { VectorMetadataEntity } from '@/entity/Vector.entity';

/**
 * Vector model for managing vector entities in a vector database
 * Works with a DataSource (for separate vector database files)
 * Manages vec0 virtual tables per model/dimension combination
 */
export class VectorModel extends BaseDb {
    private repository: Repository<VectorEntity>;
    private metadataModel: VectorMetadataModel;

    constructor(filepath: string) {
        super(filepath); 
        this.repository = this.sqliteDb.connection.getRepository(VectorEntity);
        this.metadataModel = new VectorMetadataModel(filepath);
    }

    /**
     * Save a single vector entity
     */
    async saveVector(vector: VectorEntity): Promise<VectorEntity> {
        return await this.repository.save(vector);
    }

    /**
     * Save multiple vector entities
     */
    async saveVectors(vectors: VectorEntity[]): Promise<VectorEntity[]> {
        return await this.repository.save(vectors);
    }

    /**
     * Find vectors by chunk ID
     */
    async findByChunkId(chunkId: number): Promise<VectorEntity[]> {
        return await this.repository.find({
            where: { chunk_id: chunkId }
        });
    }

    /**
     * Find vector by ID
     */
    async findById(id: number): Promise<VectorEntity | null> {
        return await this.repository.findOne({
            where: { id }
        });
    }

    /**
     * Delete vector by ID
     */
    async deleteById(id: number): Promise<boolean> {
        const result = await this.repository.delete({ id });
        return (result.affected || 0) > 0;
    }

    /**
     * Delete vectors by chunk ID
     */
    async deleteByChunkId(chunkId: number): Promise<number> {
        const result = await this.repository.delete({ chunk_id: chunkId });
        return result.affected || 0;
    }

    /**
     * Delete vectors by multiple chunk IDs (batch delete)
     */
    async deleteByChunkIds(chunkIds: number[]): Promise<number> {
        if (chunkIds.length === 0) {
            return 0;
        }
        const result = await this.repository
            .createQueryBuilder()
            .delete()
            .where('chunk_id IN (:...chunkIds)', { chunkIds })
            .execute();
        return result.affected || 0;
    }

    /**
     * Get total vector count
     */
    async getTotalCount(): Promise<number> {
        return await this.repository.count();
    }

    /**
     * Delete all vectors
     */
    async deleteAll(): Promise<number> {
        const result = await this.repository.delete({});
        return result.affected || 0;
    }

    /**
     * Get vectors by chunk IDs
     */
    async findByChunkIds(chunkIds: number[]): Promise<VectorEntity[]> {
        return await this.repository
            .createQueryBuilder('vector')
            .where('vector.chunk_id IN (:...chunkIds)', { chunkIds })
            .getMany();
    }

    /**
     * Check if vectors exist for chunk IDs (synchronous)
     * Uses underlying better-sqlite3 database for synchronous queries
     */
    hasVectorsForChunkIds(chunkIds: number[]): boolean {
        if (chunkIds.length === 0) {
            return false;
        }

        try {
            // Access underlying better-sqlite3 database through TypeORM driver
            const driver = this.sqliteDb.connection.driver as any;
            const database = driver.database;
            
            if (!database) {
                console.warn('Unable to access underlying database for synchronous query');
                return false;
            }

            // Build query with placeholders
            const placeholders = chunkIds.map(() => '?').join(',');
            const query = `SELECT COUNT(*) as count FROM vectors WHERE chunk_id IN (${placeholders})`;
            
            // Execute synchronous query
            const result = database.prepare(query).get(...chunkIds) as { count: number };
            
            return (result?.count || 0) > 0;
        } catch (error) {
            console.error('Failed to check if vectors exist for chunk IDs:', error);
            return false;
        }
    }

    /**
     * Search for similar vectors using vec_distance_l2 function
     * Uses raw SQL queries to access sqlite-vec functions (as shown in merge guide)
     * 
     * @param queryVector - Query vector as number array
     * @param k - Number of similar vectors to return (default: 10)
     * @param dimension - Dimension of the vectors (optional, for validation)
     * @param distance - Maximum distance threshold to filter results (optional). If provided, only vectors with distance <= threshold are returned
     * @returns VectorSearchResult with chunkIds, distances, and indices
     */
    async searchSimilarVectors(queryVector: number[], k: number = 10, dimension?: number, distance?: number): Promise<VectorSearchResult> {
        if (queryVector.length === 0) {
            return {
                indices: [],
                distances: [],
                chunkIds: []
            };
        }

        try {
            // Get total number of vectors
            const totalVectors = await this.getTotalCount();

            if (totalVectors === 0) {
                return {
                    indices: [],
                    distances: [],
                    chunkIds: []
                };
            }

            // Adjust k if necessary
            const adjustedK = Math.min(k, totalVectors);
            if (adjustedK !== k) {
                console.log(`Adjusted k from ${k} to ${adjustedK} (total vectors: ${totalVectors})`);
            }

            // Validate dimension if provided
            if (dimension && queryVector.length !== dimension) {
                throw new Error(`Query vector dimension ${queryVector.length} does not match expected dimension ${dimension}`);
            }

            // Convert query vector to Float32Array and Buffer (as shown in merge guide)
            const queryVectorArray = new Float32Array(queryVector);
            // Convert to Buffer for SQL parameter (as shown in merge guide)
            const queryVectorBuffer = Buffer.from(queryVectorArray.buffer);

            // Build SQL query with optional distance filter
            // If distance is provided, filter results where distance <= distance threshold
            // Use subquery to compute distance first, then filter
            const queryParams: unknown[] = distance !== undefined && distance !== null
                ? [queryVectorBuffer, distance, adjustedK]
                : [queryVectorBuffer, adjustedK];

            // Use raw SQL query to access vec_distance_l2 function
            // sqlite-vec extension is already loaded in SqliteDb.ts via prepareDatabase
            // If distance filter is provided, use subquery to filter by distance threshold
            const sqlQuery = distance !== undefined && distance !== null
                ? `
                SELECT 
                    chunk_id, 
                    distance 
                FROM (
                    SELECT 
                        chunk_id, 
                        vec_distance_l2(embedding, ?) AS distance 
                    FROM 
                        vectors 
                ) AS distances
                WHERE 
                    distance <= ?
                ORDER BY 
                    distance ASC 
                LIMIT ?
                `
                : `
                SELECT 
                    chunk_id, 
                    vec_distance_l2(embedding, ?) AS distance 
                FROM 
                    vectors 
                ORDER BY 
                    distance ASC 
                LIMIT ?
                `;

            const results = await this.sqliteDb.connection.query(
                sqlQuery,
                queryParams
            ) as Array<{ chunk_id: number; distance: number }>;

            return {
                indices: results.map((_, i) => i),
                distances: results.map(r => r.distance),
                chunkIds: results.map(r => r.chunk_id)
            };
        } catch (error) {
            console.error('Failed to search vectors:', error);
            throw new Error(`Failed to perform vector search. Please ensure sqlite-vec extension is properly installed and configured. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search for similar vectors with optional vec0 virtual table optimization
     * Tries vec0 virtual table MATCH syntax first, falls back to vec_distance_l2
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
        if (queryVector.length === 0) {
            return {
                indices: [],
                distances: [],
                chunkIds: []
            };
        }

        try {
            // Get total number of vectors
            const totalVectors = await this.getTotalCount();

            if (totalVectors === 0) {
                return {
                    indices: [],
                    distances: [],
                    chunkIds: []
                };
            }

            // Adjust k if necessary
            const adjustedK = Math.min(k, totalVectors);
            if (adjustedK !== k) {
                console.log(`Adjusted k from ${k} to ${adjustedK} (total vectors: ${totalVectors})`);
            }

            // Validate dimension if provided
            if (dimension && queryVector.length !== dimension) {
                throw new Error(`Query vector dimension ${queryVector.length} does not match expected dimension ${dimension}`);
            }

            // Convert query vector to Float32Array and Buffer
            const queryVectorArray = new Float32Array(queryVector);
            // Convert to Buffer for SQL parameter (as shown in merge guide)
            const queryVectorBuffer = Buffer.from(queryVectorArray.buffer);

            // Check if vec_index virtual table exists
            let vecTableExists = false;
            try {
                const tableCheck = await this.sqliteDb.connection.query(
                    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
                    [vecIndexName]
                ) as Array<{ name: string }>;
                vecTableExists = tableCheck && tableCheck.length > 0;
            } catch (error) {
                // If check fails, assume table doesn't exist
                vecTableExists = false;
            }

            // Try vec0 virtual table MATCH syntax first (if available)
            if (vecTableExists) {
                try {
                    const results = await this.sqliteDb.connection.query(
                        `
                        SELECT 
                            chunk_id, 
                            distance 
                        FROM 
                            ${vecIndexName} 
                        WHERE 
                            embedding MATCH ? 
                        ORDER BY 
                            distance ASC 
                        LIMIT ?
                        `,
                        [queryVectorBuffer, adjustedK]
                    ) as Array<{ chunk_id: number; distance: number }>;

                    return {
                        indices: results.map((_, i) => i),
                        distances: results.map(r => r.distance),
                        chunkIds: results.map(r => r.chunk_id)
                    };
                } catch (error) {
                    console.warn('vec0 virtual table MATCH search failed, trying vec_distance_l2...', error);
                }
            }

            // Fallback: Use vec_distance_l2 function on regular vectors table
            // This is the standard approach shown in the merge guide
            return await this.searchSimilarVectors(queryVector, adjustedK, dimension);
        } catch (error) {
            console.error('Failed to search vectors with vec0:', error);
            throw new Error(`Failed to perform vector search. Please ensure sqlite-vec extension is properly installed and configured. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get the SQL statement to create the vec0 virtual table
     * @param dimensions - The dimension of the embedding vectors
     * @param virtualTableName - Name for the virtual table
     * @returns SQL CREATE VIRTUAL TABLE statement
     */
    private getVirtualTableSQL(dimensions: number, virtualTableName: string): string {
        return `
            CREATE VIRTUAL TABLE IF NOT EXISTS ${virtualTableName} USING vec0(
                chunk_id INTEGER,
                embedding FLOAT[${dimensions}]
            )
        `.trim();
    }

    /**
     * Create or ensure vec0 virtual table exists for a model and dimension combination
     * This method will:
     * 1. Get or create metadata entry for the model/dimension
     * 2. Create the virtual table if it doesn't exist
     * @param modelName - Name of the embedding model
     * @param dimension - Dimension of the embedding vectors
     * @param options - Optional configuration
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
        if (!this.sqliteDb.connection.isInitialized) {
            throw new Error('DataSource must be initialized before creating virtual table');
        }

        // Get or create metadata entry
        const metadata = await this.metadataModel.getOrCreateMetadata(
            modelName,
            dimension,
            options
        );

        const virtualTableName = metadata.virtual_table_name;

        // Check if virtual table already exists
        const exists = await this.virtualTableExists(virtualTableName);
        
        if (!exists) {
            try {
                const queryRunner = this.sqliteDb.connection.createQueryRunner();
                const sql = this.getVirtualTableSQL(dimension, virtualTableName);
                
                await queryRunner.query(sql);
                await queryRunner.release();
                
                console.log(`vec0 virtual table '${virtualTableName}' created successfully for model '${modelName}' with dimension ${dimension}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.warn(`Failed to create vec0 virtual table '${virtualTableName}':`, errorMessage);
                console.warn('Vector search will fall back to vec_distance_l2 function on regular table');
                // Don't throw - allow application to continue with fallback method
            }
        }

        return metadata;
    }

    /**
     * Check if the vec0 virtual table exists
     * @param virtualTableName - Name of the virtual table
     * @returns Promise that resolves to true if the virtual table exists
     */
    async virtualTableExists(virtualTableName: string): Promise<boolean> {
        if (!this.sqliteDb.connection.isInitialized) {
            return false;
        }

        try {
            const queryRunner = this.sqliteDb.connection.createQueryRunner();
            const result = await queryRunner.query(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name=?
            `, [virtualTableName]) as Array<{ name: string }>;
            
            await queryRunner.release();
            return result.length > 0;
        } catch (error) {
            console.warn(`Failed to check if virtual table '${virtualTableName}' exists:`, error);
            return false;
        }
    }

    /**
     * Get virtual table name for a model and dimension combination
     * Returns the virtual table name from metadata if it exists
     * @param modelName - Name of the embedding model
     * @param dimension - Dimension of the embedding vectors
     * @returns Promise that resolves to the virtual table name or null if not found
     */
    async getVirtualTableName(modelName: string, dimension: number): Promise<string | null> {
        const metadata = await this.metadataModel.findByModelAndDimension(modelName, dimension);
        return metadata?.virtual_table_name || null;
    }

    /**
     * Search for similar vectors using the appropriate virtual table for the model
     * Automatically determines the virtual table name from metadata
     * @param queryVector - Query vector as number array
     * @param k - Number of similar vectors to return (default: 10)
     * @param modelName - Name of the embedding model (required to find virtual table)
     * @param dimension - Dimension of the vectors (optional, for validation)
     * @returns VectorSearchResult with chunkIds, distances, and indices
     */
    async searchSimilarVectorsForModel(
        queryVector: number[],
        modelName: string,
        k: number = 10,
        dimension?: number
    ): Promise<VectorSearchResult> {
        // Get virtual table name from metadata
        const virtualTableName = await this.getVirtualTableName(modelName, dimension || queryVector.length);
        
        if (virtualTableName) {
            // Use virtual table search
            return await this.searchSimilarVectorsWithVec0(queryVector, k, dimension, virtualTableName);
        } else {
            // Fallback to regular search
            return await this.searchSimilarVectors(queryVector, k, dimension);
        }
    }
}


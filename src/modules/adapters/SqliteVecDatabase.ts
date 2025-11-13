import { DataSource } from 'typeorm';
// import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
// import * as sqliteVec from 'sqlite-vec';
import { AbstractVectorDatabase } from '@/modules/interface/AbstractVectorDatabase';
import { VectorDatabaseConfig, VectorSearchResult, IndexStats } from '@/modules/interface/IVectorDatabase';
import { VectorEntity } from '@/entity/Vector.entity';
//import { VectorMetadataEntity } from '@/entity/Vector.entity';
import { VectorModule } from '@/modules/VectorModule';
// import { VectorMetadataModule } from '@/modules/VectorMetadataModule';
import { RAGChunkModule } from '@/modules/RAGChunkModule';

/**
 * SQLite-vec vector database implementation using TypeORM
 * Uses sqlite-vec extension loaded via TypeORM's prepareDatabase hook
 * Leverages VectorModule and VectorMetadataModule for database operations
 */
export class SqliteVecDatabase extends AbstractVectorDatabase {
    // private dataSource: DataSource | null = null;
    private vectorModule: VectorModule | null = null;
    // private vectorMetadataModule: VectorMetadataModule | null = null;
    // private vecIndexName: string = 'vec_index';

    constructor() { 
            super();
            this.vectorModule = new VectorModule();
            // this.vectorMetadataModule = new VectorMetadataModule();
            // this.initialized = true;
        }
    /**
     * Initialize sqlite-vec via TypeORM
     * TypeORM will load sqlite-vec extension via prepareDatabase hook
     */
    async initialize(): Promise<void> {
        try {
            this.initialized = true;
            console.log('SQLite-vec initialized successfully (extension will be loaded when DataSource is created)');
        } catch (error) {
            console.error('Failed to initialize sqlite-vec:', error);
            throw new Error('Failed to initialize sqlite-vec. Please ensure sqlite-vec extension is available.');
        }
    }

    /**
     * Create TypeORM DataSource for the vector database
     * Each vector database file gets its own DataSource with sqlite-vec loaded
     */
    // private async createDataSource(databasePath: string): Promise<DataSource> {
    //     // Ensure directory exists
    //     const dbDir = path.dirname(databasePath);
    //     if (!fs.existsSync(dbDir)) {
    //         fs.mkdirSync(dbDir, { recursive: true });
    //     }

    //     // Create TypeORM DataSource with sqlite-vec extension
    //     // sqlite-vec will be loaded via prepareDatabase hook (as shown in SqliteDb.ts)
    //     const dataSource = new DataSource({
    //         type: 'better-sqlite3',
    //         database: databasePath,
    //         entities: [VectorEntity, VectorMetadataEntity],
    //         synchronize: true, // Auto-create tables
    //         logging: false,
    //         prepareDatabase: (db: Database.Database) => {
    //             // Load sqlite-vec extension into the connection (same as SqliteDb.ts)
    //             try {
    //                 sqliteVec.load(db);
    //                 console.log('sqlite-vec extension loaded successfully via TypeORM prepareDatabase');
    //             } catch (err) {
    //                 const errorMessage = err instanceof Error ? err.message : String(err);
    //                 console.error(`Failed to load sqlite-vec extension: ${errorMessage}`);
    //                 console.error('Please ensure the platform-specific sqlite-vec package is installed (e.g., sqlite-vec-linux-x64, sqlite-vec-darwin-x64, etc.)');
    //                 // Don't throw - allow database creation, but operations will fail later
    //             }
                
    //             // Enable WAL mode for better concurrency
    //             db.pragma('journal_mode = WAL');
    //         }
    //     });

    //     // Initialize DataSource
    //     if (!dataSource.isInitialized) {
    //         await dataSource.initialize();
    //         console.log(`TypeORM DataSource initialized for vector database: ${databasePath}`);
    //     }

    //     return dataSource;
    // }

    /**
     * Create a new SQLite database using TypeORM with sqlite-vec
     * Tables are created automatically via TypeORM synchronize
     */
    async createIndex(config: VectorDatabaseConfig): Promise<string> {
        if (!this.initialized) {
            await this.initialize();
        }
        
        // this.validateConfig(config);

        // try {
           this.config = config;
           this.dimension = config.dimensions;

        //     // Update index path based on whether it's document-specific or model-specific
        //     if (config.documentIndexPath) {
        //         this.indexPath = config.documentIndexPath;
        //         console.log(`Creating document-specific index at specified path: ${config.documentIndexPath}`);
        //     } else if (config.documentId) {
        //         this.indexPath = this.getDocumentSpecificIndexPath(config, config.documentId);
        //         console.log(`Creating document-specific index for document ${config.documentId}`);
        //     } else {
        //         this.indexPath = this.getModelSpecificIndexPath(config);
        //         console.log(`Creating model-specific index for model ${config.modelName}`);
        //     }

        //     // Change file extension from .index to .db
        //     if (this.indexPath.endsWith('.index')) {
        //         this.indexPath = this.indexPath.replace(/\.index$/, '.db');
        //     } else if (!this.indexPath.endsWith('.db')) {
        //         this.indexPath = this.indexPath + '.db';
        //     }

        //     // Create TypeORM DataSource (will auto-create tables via synchronize)
        //     this.dataSource = await this.createDataSource(this.indexPath);

        //     // Create module instances
        //     this.vectorModule = new VectorModule(this.dataSource);
        //     this.vectorMetadataModule = new VectorMetadataModule(this.dataSource);

        //     const indexType = config.indexType || 'flat';

        //     // Try to create vec0 virtual table for optimization (optional)
        //     // This is done via raw query since TypeORM doesn't support virtual tables directly
        //     try {
        //         const queryRunner = this.dataSource.createQueryRunner();
        //         const createVecTableSQL = `
        //             CREATE VIRTUAL TABLE IF NOT EXISTS ${this.vecIndexName} USING vec0(
        //                 chunk_id INTEGER,
        //                 embedding FLOAT[${config.dimensions}]
        //             )
        //         `;
        //         await queryRunner.query(createVecTableSQL);
        //         await queryRunner.release();
        //         console.log('vec0 virtual table created successfully (optional optimization)');
        //     } catch (error) {
        //         // If vec0 syntax fails, that's okay - we'll use vec_distance_l2 on regular table
        //         // This is the standard approach shown in the merge guide
        //         console.log('vec0 virtual table not available, using vec_distance_l2 function on regular table (standard approach)');
        //     }

        //     // Create index for faster chunk lookups (if not already created by TypeORM)
        //     try {
        //         const queryRunner = this.dataSource.createQueryRunner();
        //         await queryRunner.query(`
        //             CREATE INDEX IF NOT EXISTS idx_vectors_chunk_id ON vectors(chunk_id)
        //         `);
        //         await queryRunner.release();
        //     } catch (error) {
        //         // Index might already exist, which is fine
        //         console.warn('Failed to create index (might already exist):', error);
        //     }

        //     // Insert or update initial metadata using VectorMetadataModule
        //     await this.vectorMetadataModule.getOrCreateMetadata(1, {
        //         dimension: config.dimensions,
        //         model_name: config.modelName,
        //         index_type: indexType
        //     });

        //     console.log(`Created ${indexType} SQLite-vec index with dimension ${config.dimensions} using TypeORM`);
        //     console.log(`Index path: ${this.indexPath}`);
        //     return this.indexPath;
        // } catch (error) {
        //     console.error('Failed to create SQLite-vec index:', error);
        //     if (this.dataSource && this.dataSource.isInitialized) {
        //         await this.dataSource.destroy();
        //         this.dataSource = null;
        //     }
        //     this.vectorModule = null;
        //     this.vectorMetadataModule = null;
        //     throw new Error(`Failed to create SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // }
        return 'salite_db'
    }

    /**
     * Load existing SQLite database using TypeORM
     */
    async loadIndex(config: VectorDatabaseConfig): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        this.validateConfig(config);

        // try {
        //     this.config = config;

        //     if (config.documentIndexPath) {
        //         this.indexPath = config.documentIndexPath;
        //         console.log(`Loading document-specific index at path ${this.indexPath}`);
        //     } else {
        //         // Update index path based on whether it's document-specific or model-specific
        //         if (config.documentId) {
        //             this.indexPath = this.getDocumentSpecificIndexPath(config, config.documentId);
        //             console.log(`Loading document-specific index for document ${config.documentId}`);
        //         } else {
        //             this.indexPath = this.getModelSpecificIndexPath(config);
        //             console.log(`Loading model-specific index for model ${config.modelName}`);
        //         }
        //     }

        //     // Change file extension from .index to .db if needed
        //     if (this.indexPath.endsWith('.index')) {
        //         this.indexPath = this.indexPath.replace(/\.index$/, '.db');
        //     } else if (!this.indexPath.endsWith('.db')) {
        //         // Try with .db extension
        //         const dbPath = this.indexPath + '.db';
        //         if (fs.existsSync(dbPath)) {
        //             this.indexPath = dbPath;
        //         }
        //     }

        //     if (!fs.existsSync(this.indexPath)) {
        //         console.log(`No existing SQLite-vec index found at ${this.indexPath}, creating new one`);
        //         await this.createIndex(config);
        //         return;
        //     }

        //     // Create TypeORM DataSource
        //     this.dataSource = await this.createDataSource(this.indexPath);

        //     // Create module instances
        //     this.vectorModule = new VectorModule(this.dataSource);
        //     this.vectorMetadataModule = new VectorMetadataModule(this.dataSource);

        //     // Read metadata using VectorMetadataModule
        //     const metadata = await this.vectorMetadataModule.findById(1);

        //     if (metadata) {
        //         this.dimension = metadata.dimension;
        //         console.log(`Loaded existing SQLite-vec index for model ${metadata.model_name} with ${metadata.total_vectors} vectors`);
        //     } else {
        //         // If metadata doesn't exist, try to get dimension from config
        //         this.dimension = config.dimensions;
        //         console.warn('No metadata found in index, using config dimensions');
        //     }
        // } catch (error) {
        //     console.error('Failed to load SQLite-vec index:', error);
        //     if (this.dataSource && this.dataSource.isInitialized) {
        //         await this.dataSource.destroy();
        //         this.dataSource = null;
        //     }
        //     this.vectorModule = null;
        //     this.vectorMetadataModule = null;
        //     throw new Error(`Failed to load SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // }
    }

    /**
     * Save index to disk (SQLite auto-saves, but we can checkpoint)
     */
    async saveIndex(): Promise<void> {
        
        // try {
        //     // SQLite auto-saves, but we can checkpoint WAL using raw query
        //     await this.vectorModule.sqliteDb.connection.query('PRAGMA wal_checkpoint(TRUNCATE)');
        //     console.log(`SQLite-vec index checkpointed at ${this.indexPath}`);
        // } catch (error) {
        //     console.error('Failed to checkpoint SQLite-vec index:', error);
        // }
    }

    /**
     * Add vectors to the index using VectorModule
     */
    async addVectors(vectors: number[], chunkIds: number): Promise<void> {
        if (!this.vectorModule) {
            throw new Error('Index not initialized');
        }

        if (vectors.length === 0) {
            return;
        }

        // Validate vector has the correct dimension
        if (vectors.length % this.dimension !== 0) {
            throw new Error(`Vector array length ${vectors.length} is not a multiple of dimension ${this.dimension}`);
        }

        // const numVectors = vectors.length / this.dimension;
        // if (numVectors !== chunkIds.length) {
        //     throw new Error(`Number of vectors (${numVectors}) does not match number of chunk IDs (${chunkIds.length})`);
        // }

        try {
            // Convert to Float32Array (VectorTransformer will handle Buffer conversion)
            const vectorArray = new Float32Array(vectors);
            
            const vectorEntity = new VectorEntity();
            vectorEntity.chunk_id = chunkIds;
            vectorEntity.embedding = vectorArray; // VectorTransformer converts to Buffer automatically

            // Step 1: Save vector to vectorModule first
            // Only proceed to metadata update if this succeeds
            const result = await this.vectorModule.saveVector(vectorEntity);
            console.log(`Saved vector to SQLite-vec index using VectorModule: ${result.id}`);

            // Step 2: Update metadata only after successful vector save
            // If saveVector throws an error, this line will not execute
            //  const metadata = await this.vectorMetadataModule.getOrCreateMetadata(1, {
            //     dimension: this.dimension,
            //     model_name: this.config?.modelName,
            //     index_type: this.config?.indexType
            // });
            // await this.vectorMetadataModule.incrementTotalVectors(result.id, 1);

            // Optionally try to insert into vec_index virtual table if it exists
            // This requires raw queries since TypeORM doesn't support virtual tables directly
            // try {
            //     const dataSource = this.vectorModule.getDataSource();
            //     const queryRunner = dataSource.createQueryRunner();
            //     // Check if vec_index table exists
            //     const tableCheck = await queryRunner.query(`
            //         SELECT name FROM sqlite_master WHERE type='table' AND name=?
            //     `, [this.vecIndexName]);
                
            //     if (tableCheck && tableCheck.length > 0) {
            //         // Insert into vec_index virtual table using raw query
            //         for (let i = 0; i < numVectors; i++) {
            //             const startIdx = i * this.dimension;
            //             const endIdx = startIdx + this.dimension;
            //             const vector = vectors.slice(startIdx, endIdx);
            //             const vectorArray = new Float32Array(vector);
                        
            //             try {
            //                 await queryRunner.query(`
            //                     INSERT INTO ${this.vecIndexName} (chunk_id, embedding) VALUES (?, ?)
            //                 `, [chunkIds[i], vectorArray]);
            //             } catch (error) {
            //                 // If insertion fails, continue with regular table only
            //                 console.warn('Failed to insert into vec_index virtual table, continuing with regular table only:', error);
            //             }
            //         }
            //     }
            //     await queryRunner.release();
            //  } catch (error) {
            //     // vec_index table doesn't exist or can't be accessed, use regular table only
            //     // This is fine - we can use vec_distance_l2 on the regular table
            //     console.warn('vec_index virtual table not available, using regular table only:', error);
        //    }

            console.log(`Added 1 vectors to SQLite-vec index using VectorModule`);
        } catch (error) {
            console.error('Failed to add vectors to SQLite-vec index:', error);
            throw new Error(`Failed to add vectors to SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search for similar vectors using VectorModule
     * Delegates to VectorModule's searchSimilarVectors method
     * VectorModule handles validation and calls VectorModel for the actual search
     * 
     * @param queryVector - Query vector as number array
     * @param k - Number of similar vectors to return (default: 10)
     * @param distance - Maximum distance threshold to filter results (optional)
     * @returns VectorSearchResult with chunkIds, distances, and indices
     */
    async search(queryVector: number[], k: number = 10, distance?: number): Promise<VectorSearchResult> {
        if (!this.vectorModule) {
            throw new Error('Index not initialized');
        }

        try {
            // Use VectorModule's searchSimilarVectors method
            // VectorModule delegates to VectorModel which uses vec_distance_l2 function via raw SQL queries
            // Dimension validation is handled in VectorModel
            // If distance is provided, results will be filtered to only include vectors with distance <= threshold
            return await this.vectorModule.searchSimilarVectors(queryVector, k, this.dimension, distance);
        } catch (error) {
            console.error('Failed to search vectors in SqliteVecDatabase:', error);
            throw new Error(`Failed to perform vector search: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get index statistics
     * Note: This is a synchronous method, so we use cached config values
     * For accurate stats, the metadata should be loaded when loadIndex is called
     */
    getIndexStats(): IndexStats {
        if (!this.vectorModule) {
            return {
                totalVectors: 0,
                dimension: this.dimension || 0,
                indexType: this.config?.indexType || 'unknown',
                isInitialized: this.initialized,
                modelName: this.config?.modelName || ''
            };
        }

        // Since this is a synchronous method, return cached values
        // The dimension is set when loadIndex/createIndex is called
        // For totalVectors, we'll return 0 and let async methods provide accurate counts
        try {
            return {
                totalVectors: 0, // Would need async call to get accurate count
                dimension: this.dimension || 0,
                indexType: this.config?.indexType || 'flat',
                isInitialized: this.initialized,
                modelName: this.config?.modelName || ''
            };
        } catch (error) {
            console.error('Failed to get index stats:', error);
            return {
                totalVectors: 0,
                dimension: this.dimension || 0,
                indexType: 'unknown',
                isInitialized: this.initialized,
                modelName: this.config?.modelName || ''
            };
        }
    }

    /**
     * Get total number of vectors in the index
     * Note: This is a synchronous method, so we can't use async operations
     * We'll return 0 and log a warning
     */
    getTotalVectors(): number {
        if (!this.vectorModule) {
            throw new Error('Index not initialized');
        }

        // Since this is a synchronous method but VectorModule.getTotalCount is async,
        // we'll return 0 and log a warning
        // For accurate count, use getIndexStats or create an async version
        console.warn('getTotalVectors called synchronously - returning 0. Use getIndexStats or async method for accurate count.');
        return 0;
    }

    /**
     * Reset the index
     */
    async resetIndex(): Promise<void> {
    //     if (!this.vectorModule) {
    //         throw new Error('Index not initialized');
    //     }

    //     try {
    //         const dataSource = this.vectorModule.getDataSource();
    //         const queryRunner = dataSource.createQueryRunner();
            
    //         // Drop tables using raw queries
    //         await queryRunner.query(`DROP TABLE IF EXISTS ${this.vecIndexName}`);
    //         await queryRunner.query('DROP TABLE IF EXISTS vectors');
    //         await queryRunner.query('DROP TABLE IF EXISTS vector_metadata');
            
    //         await queryRunner.release();

    //         // Recreate tables
    //         if (this.config) {
    //             // Close current DataSource
    //             await this.dataSource?.destroy();
    //             this.dataSource = null;
    //             this.vectorModule = null;
    //             this.vectorMetadataModule = null;
                
    //             // Recreate index (will create new DataSource and modules)
    //             await this.createIndex(this.config);
    //         } else {
    //             throw new Error('No configuration available to recreate index');
    //         }

    //         console.log('SQLite-vec index reset successfully');
    //     } catch (error) {
    //         console.error('Failed to reset SQLite-vec index:', error);
    //         throw new Error('Failed to reset SQLite-vec index');
    //     }
     }

    /**
     * Optimize the index
     */
     async optimizeIndex(): Promise<void> {
    //     if (!this.vectorModule) {
    //         throw new Error('Index not initialized');
    //     }

    //     try {
    //         const dataSource = this.vectorModule.getDataSource();
    //         const queryRunner = dataSource.createQueryRunner();
            
    //         // Run VACUUM to optimize database
    //         await queryRunner.query('VACUUM');
    //         // Run ANALYZE to update statistics
    //         await queryRunner.query('ANALYZE');
            
    //         await queryRunner.release();
            
    //         console.log('SQLite-vec index optimization completed');
    //     } catch (error) {
    //         console.error('Failed to optimize SQLite-vec index:', error);
    //         throw new Error('Failed to optimize SQLite-vec index');
    //     }
     }

    /**
     * Backup the index
     */
    async backupIndex(backupPath: string): Promise<void> {
        if (!this.vectorModule) {
            throw new Error('No database to backup');
        }

        try {
            // Save current state first
            await this.saveIndex();

            // Ensure backup directory exists
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            // Use file copy for backup (simpler and reliable)
            if (fs.existsSync(this.indexPath)) {
                fs.copyFileSync(this.indexPath, backupPath);
                console.log(`SQLite-vec index backed up to ${backupPath}`);
            } else {
                throw new Error(`Database file not found: ${this.indexPath}`);
            }
        } catch (error) {
            console.error('Failed to backup SQLite-vec index:', error);
            throw new Error(`Failed to backup SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Restore index from backup
     */
    async restoreIndex(backupPath: string): Promise<void> {
        // if (!this.initialized) {
        //     await this.initialize();
        // }

        // try {
        //     if (!fs.existsSync(backupPath)) {
        //         throw new Error(`Backup file not found: ${backupPath}`);
        //     }

        //     // Close current DataSource if open
        //     if (this.dataSource && this.dataSource.isInitialized) {
        //         await this.dataSource.destroy();
        //         this.dataSource = null;
        //     }

        //     // Copy backup file to current location
        //     if (this.config) {
        //         // Determine target path
        //         if (this.config.documentIndexPath) {
        //             this.indexPath = this.config.documentIndexPath;
        //         } else if (this.config.documentId) {
        //             this.indexPath = this.getDocumentSpecificIndexPath(this.config, this.config.documentId);
        //         } else {
        //             this.indexPath = this.getModelSpecificIndexPath(this.config);
        //         }

        //         // Ensure .db extension
        //         if (this.indexPath.endsWith('.index')) {
        //             this.indexPath = this.indexPath.replace(/\.index$/, '.db');
        //         } else if (!this.indexPath.endsWith('.db')) {
        //             this.indexPath = this.indexPath + '.db';
        //         }

        //         // Ensure directory exists
        //         this.ensureIndexDirectory();

        //         // Copy backup file
        //         fs.copyFileSync(backupPath, this.indexPath);

        //         // Create TypeORM DataSource (will load sqlite-vec via prepareDatabase)
        //         this.dataSource = await this.createDataSource(this.indexPath);

        //         // Create module instances
        //         this.vectorModule = new VectorModule(this.dataSource);
        //         this.vectorMetadataModule = new VectorMetadataModule(this.dataSource);

        //         // Read dimension from metadata using VectorMetadataModule
        //         const metadata = await this.vectorMetadataModule.findById(1);
        //         if (metadata) {
        //             this.dimension = metadata.dimension;
        //         }

        //         console.log(`SQLite-vec index restored from ${backupPath}`);
        //     } else {
        //         throw new Error('No configuration available to restore index');
        //     }
        // } catch (error) {
        //     console.error('Failed to restore SQLite-vec index:', error);
        //     throw new Error('Failed to restore SQLite-vec index');
        // }
    }

    /**
     * Delete a document-specific index
     * First gets all chunks for the document using RAGChunkModule,
     * then deletes vectors by chunk ID using VectorModule
     */
    async deleteDocumentIndex(documentId: number): Promise<void> {
        if (!this.vectorModule) {
            throw new Error('VectorModule not initialized');
        }

        try {
            // Get all chunks for the document using RAGChunkModule
            const ragChunkModule = new RAGChunkModule();
            const chunks = await ragChunkModule.getDocumentChunks(documentId);

            if (chunks.length === 0) {
                console.log(`No chunks found for document ${documentId}, nothing to delete`);
                return;
            }

            // Extract chunk IDs from the chunks
            const chunkIds = chunks.map(chunk => chunk.id);

            console.log(`Found ${chunkIds.length} chunks for document ${documentId}, deleting associated vectors...`);

            // Delete vectors by chunk IDs using VectorModule (batch delete for efficiency)
            const deletedCount = await this.vectorModule.deleteByChunkIds(chunkIds);

            console.log(`Deleted ${deletedCount} vectors for document ${documentId} (${chunkIds.length} chunks)`);
        } catch (error) {
            console.error(`Failed to delete document index for document ${documentId}:`, error);
            throw new Error(`Failed to delete document index for document ${documentId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check if a document-specific index exists
     * Gets all chunks for the document using RAGChunkModule,
     * then checks if vectors exist for those chunk IDs using VectorModule
     */
    documentIndexExists(documentId: number): boolean {
        if (!this.vectorModule) {
            return false;
        }

        try {
            // Get chunk IDs for the document using RAGChunkModule (synchronous)
            const ragChunkModule = new RAGChunkModule();
            const chunkIds = ragChunkModule.getDocumentChunkIds(documentId);

            if (chunkIds.length === 0) {
                // No chunks found for the document, so no index exists
                return false;
            }

            // Check if vectors exist for those chunk IDs using VectorModule (synchronous)
            return this.vectorModule.hasVectorsForChunkIds(chunkIds);
        } catch (error) {
            console.error(`Failed to check if document index exists for document ${documentId}:`, error);
            return false;
        }
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        // if (this.dataSource && this.dataSource.isInitialized) {
        //     try {
        //         await this.saveIndex();
        //         await this.dataSource.destroy();
        //         console.log('SQLite-vec TypeORM DataSource closed');
        //     } catch (error) {
        //         console.error('Error closing database connection:', error);
        //     }
        // }
        // this.dataSource = null;
        // this.vectorModule = null;
        // this.vectorMetadataModule = null;
        // this.initialized = false;
        // this.config = null;
    }

    /**
     * Get SQLite-vec specific file extension
     */
    protected getFileExtension(): string {
        return 'db';
    }

    /**
     * Override indexExists to check for .db file
     */
    indexExists(): boolean {
        return true;
        // // Check for .db file
        // if (fs.existsSync(this.indexPath)) {
        //     return true;
        // }
        // // Also check if .index file exists (for migration compatibility)
        // const indexPath = this.indexPath.replace(/\.db$/, '.index');
        // return fs.existsSync(indexPath);
    }
}


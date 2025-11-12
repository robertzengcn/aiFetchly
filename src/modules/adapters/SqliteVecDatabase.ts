import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { AbstractVectorDatabase } from '@/modules/interface/AbstractVectorDatabase';
import { VectorDatabaseConfig, VectorSearchResult, IndexStats } from '@/modules/interface/IVectorDatabase';

// Try to import sqlite-vec if available
let sqliteVec: { load: (db: Database.Database) => void; getLoadablePath?: () => string } | null = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sqliteVec = require('sqlite-vec');
} catch (error) {
    // sqlite-vec might not be installed or available
    console.warn('sqlite-vec package not found. Please ensure sqlite-vec is installed:', error);
}

/**
 * SQLite-vec vector database implementation
 * Uses sqlite-vec extension for vector similarity search
 */
export class SqliteVecDatabase extends AbstractVectorDatabase {
    private db: Database.Database | null = null;
    private vecIndexName: string = 'vec_index';

    /**
     * Initialize sqlite-vec extension
     */
    async initialize(): Promise<void> {
        try {
            // Try to load sqlite-vec extension if available
            // sqlite-vec may need to be loaded from a file path or npm package
            this.initialized = true;
            console.log('SQLite-vec initialized successfully');
        } catch (error) {
            console.error('Failed to initialize sqlite-vec:', error);
            throw new Error('Failed to initialize sqlite-vec. Please ensure sqlite-vec extension is available.');
        }
    }

    /**
     * Load sqlite-vec extension into database connection
     */
    private loadExtension(db: Database.Database): void {
        try {
            // Try to load sqlite-vec extension using the npm package's load method
            // sqlite-vec package exports a load() function that finds and loads the platform-specific extension
            if (sqliteVec && typeof sqliteVec.load === 'function') {
                try {
                    sqliteVec.load(db);
                    console.log('sqlite-vec extension loaded successfully');
                    return;
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    // Check if it's a platform support error or missing package error
                    if (errorMessage.includes('Unsupported platform') || errorMessage.includes('not found')) {
                        console.error(`sqlite-vec extension could not be loaded: ${errorMessage}`);
                        console.error('Please ensure the platform-specific sqlite-vec package is installed (e.g., sqlite-vec-linux-x64, sqlite-vec-darwin-x64, etc.)');
                        // Don't throw - allow database creation, but operations will fail later
                    } else {
                        console.warn('Failed to load sqlite-vec extension:', errorMessage);
                    }
                    // Continue to try manual loading as fallback
                }
            } else {
                console.warn('sqlite-vec package not available. Vector operations may fail.');
            }

            // Fallback: Try to load extension manually if npm package method failed
            // This is a last resort - the npm package's load() method should work in most cases
            if (sqliteVec && typeof sqliteVec.getLoadablePath === 'function') {
                try {
                    const extensionPath = sqliteVec.getLoadablePath();
                    db.loadExtension(extensionPath);
                    console.log(`sqlite-vec extension loaded from: ${extensionPath}`);
                    return;
                } catch (err) {
                    console.warn('Failed to load sqlite-vec extension using getLoadablePath:', err);
                }
            }

            // If all methods fail, log error but don't throw
            // The extension is required for vector operations, but we allow database creation
            // Vector operations will fail with a clear error message if extension isn't loaded
            console.error('Could not load sqlite-vec extension. Vector operations will fail until the extension is properly installed.');
        } catch (error) {
            console.error('Error loading sqlite-vec extension:', error);
            // Don't throw - allow the database to be created
            // Vector operations will fail later with a clear error message
        }
    }

    /**
     * Create a new SQLite database with vec0 virtual table
     */
    async createIndex(config: VectorDatabaseConfig): Promise<string> {
        if (!this.initialized) {
            await this.initialize();
        }

        this.validateConfig(config);

        try {
            this.config = config;
            this.dimension = config.dimensions;

            // Update index path based on whether it's document-specific or model-specific
            if (config.documentIndexPath) {
                this.indexPath = config.documentIndexPath;
                console.log(`Creating document-specific index at specified path: ${config.documentIndexPath}`);
            } else if (config.documentId) {
                this.indexPath = this.getDocumentSpecificIndexPath(config, config.documentId);
                console.log(`Creating document-specific index for document ${config.documentId}`);
            } else {
                this.indexPath = this.getModelSpecificIndexPath(config);
                console.log(`Creating model-specific index for model ${config.modelName}`);
            }

            // Change file extension from .index to .db
            if (this.indexPath.endsWith('.index')) {
                this.indexPath = this.indexPath.replace(/\.index$/, '.db');
            } else if (!this.indexPath.endsWith('.db')) {
                this.indexPath = this.indexPath + '.db';
            }

            this.ensureIndexDirectory();

            // Create or open database
            this.db = new Database(this.indexPath);
            this.loadExtension(this.db);

            // Enable WAL mode for better concurrency
            this.db.pragma('journal_mode = WAL');

            const indexType = config.indexType || 'flat';

            // Create vectors table for storing vectors
            // sqlite-vec works with regular tables and BLOB columns (as shown in merge guide)
            // We use vec_distance_l2 function for search instead of virtual tables
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS vectors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chunk_id INTEGER NOT NULL,
                    embedding BLOB NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Note: vec0 virtual table support may vary by sqlite-vec version
            // We primarily use vec_distance_l2 function on the regular table (as shown in merge guide)
            // Optionally try to create vec0 virtual table for optimization, but it's not required
            try {
                const createVecTableSQL = `
                    CREATE VIRTUAL TABLE IF NOT EXISTS ${this.vecIndexName} USING vec0(
                        chunk_id INTEGER,
                        embedding FLOAT[${config.dimensions}]
                    )
                `;
                this.db.exec(createVecTableSQL);
                console.log('vec0 virtual table created successfully (optional optimization)');
            } catch (error) {
                // If vec0 syntax fails, that's okay - we'll use vec_distance_l2 on regular table
                // This is the standard approach shown in the merge guide
                console.log('vec0 virtual table not available, using vec_distance_l2 function on regular table (standard approach)');
            }

            // Create metadata table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS vector_metadata (
                    id INTEGER PRIMARY KEY,
                    dimension INTEGER NOT NULL,
                    total_vectors INTEGER NOT NULL,
                    model_name TEXT NOT NULL,
                    index_type TEXT DEFAULT 'flat',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create index for faster chunk lookups
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_vectors_chunk_id ON vectors(chunk_id)
            `);

            // Insert initial metadata (use prepared statement to avoid SQL injection)
            const insertMetadataStmt = this.db.prepare(`
                INSERT OR REPLACE INTO vector_metadata (id, dimension, total_vectors, model_name, index_type, created_at, updated_at)
                VALUES (1, ?, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `);
            insertMetadataStmt.run(config.dimensions, config.modelName, indexType);

            console.log(`Created ${indexType} SQLite-vec index with dimension ${config.dimensions}`);
            console.log(`Index path: ${this.indexPath}`);
            return this.indexPath;
        } catch (error) {
            console.error('Failed to create SQLite-vec index:', error);
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            throw new Error(`Failed to create SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Load existing SQLite database
     */
    async loadIndex(config: VectorDatabaseConfig): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        this.validateConfig(config);

        try {
            this.config = config;

            if (config.documentIndexPath) {
                this.indexPath = config.documentIndexPath;
                console.log(`Loading document-specific index at path ${this.indexPath}`);
            } else {
                // Update index path based on whether it's document-specific or model-specific
                if (config.documentId) {
                    this.indexPath = this.getDocumentSpecificIndexPath(config, config.documentId);
                    console.log(`Loading document-specific index for document ${config.documentId}`);
                } else {
                    this.indexPath = this.getModelSpecificIndexPath(config);
                    console.log(`Loading model-specific index for model ${config.modelName}`);
                }
            }

            // Change file extension from .index to .db if needed
            if (this.indexPath.endsWith('.index')) {
                this.indexPath = this.indexPath.replace(/\.index$/, '.db');
            } else if (!this.indexPath.endsWith('.db')) {
                // Try with .db extension
                const dbPath = this.indexPath + '.db';
                if (fs.existsSync(dbPath)) {
                    this.indexPath = dbPath;
                }
            }

            if (!fs.existsSync(this.indexPath)) {
                console.log(`No existing SQLite-vec index found at ${this.indexPath}, creating new one`);
                await this.createIndex(config);
                return;
            }

            // Open database
            this.db = new Database(this.indexPath);
            this.loadExtension(this.db);

            // Enable WAL mode
            this.db.pragma('journal_mode = WAL');

            // Read metadata
            const metadataStmt = this.db.prepare('SELECT dimension, total_vectors, model_name, index_type FROM vector_metadata WHERE id = 1');
            const metadata = metadataStmt.get() as { dimension: number; total_vectors: number; model_name: string; index_type: string } | undefined;

            if (metadata) {
                this.dimension = metadata.dimension;
                console.log(`Loaded existing SQLite-vec index for model ${metadata.model_name} with ${metadata.total_vectors} vectors`);
            } else {
                // If metadata doesn't exist, try to get dimension from config
                this.dimension = config.dimensions;
                console.warn('No metadata found in index, using config dimensions');
            }
        } catch (error) {
            console.error('Failed to load SQLite-vec index:', error);
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            throw new Error(`Failed to load SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Save index to disk (SQLite auto-saves, but we can checkpoint)
     */
    async saveIndex(): Promise<void> {
        if (!this.db) {
            throw new Error('No database connection to save');
        }

        try {
            // SQLite auto-saves, but we can checkpoint WAL
            this.db.pragma('wal_checkpoint(TRUNCATE)');
            console.log(`SQLite-vec index checkpointed at ${this.indexPath}`);
        } catch (error) {
            console.error('Failed to checkpoint SQLite-vec index:', error);
            // Don't throw - SQLite will persist changes anyway
        }
    }

    /**
     * Convert number array to Float32Array
     */
    private numberArrayToFloat32Array(arr: number[]): Float32Array {
        return new Float32Array(arr);
    }

    /**
     * Convert Float32Array to Buffer for storage
     */
    private float32ArrayToBuffer(arr: Float32Array): Buffer {
        return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    }

    /**
     * Convert Buffer to Float32Array
     */
    private bufferToFloat32Array(buf: Buffer): Float32Array {
        return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
    }

    /**
     * Add vectors to the index
     */
    async addVectors(vectors: number[], chunkIds: number[]): Promise<void> {
        if (!this.db) {
            throw new Error('Index not initialized');
        }

        if (vectors.length === 0) {
            return;
        }

        // Validate vector has the correct dimension
        // For sqlite-vec, we handle a single vector at a time
        if (vectors.length % this.dimension !== 0) {
            throw new Error(`Vector array length ${vectors.length} is not a multiple of dimension ${this.dimension}`);
        }

        const numVectors = vectors.length / this.dimension;
        if (numVectors !== chunkIds.length) {
            throw new Error(`Number of vectors (${numVectors}) does not match number of chunk IDs (${chunkIds.length})`);
        }

        try {
            // Prepare statements
            // Insert into vectors table (primary storage)
            const insertVectorsStmt = this.db.prepare(`
                INSERT INTO vectors (chunk_id, embedding) VALUES (?, ?)
            `);
            
            // Try to prepare vec_index insert if virtual table exists
            let insertVecStmt: Database.Statement | null = null;
            try {
                // Check if vec_index table exists
                const checkTable = this.db.prepare(`
                    SELECT name FROM sqlite_master WHERE type='table' AND name=?
                `);
                const result = checkTable.get(this.vecIndexName);
                if (result !== undefined) {
                    insertVecStmt = this.db.prepare(`
                        INSERT INTO ${this.vecIndexName} (chunk_id, embedding) VALUES (?, ?)
                    `);
                }
            } catch (error) {
                // vec_index table doesn't exist or can't be accessed, use regular table only
                // This is fine - we can use vec_distance_l2 on the regular table
                console.warn('vec_index virtual table not available, using regular table only:', error);
            }

            const updateMetadataStmt = this.db.prepare(`
                UPDATE vector_metadata 
                SET total_vectors = total_vectors + ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = 1
            `);

            // Use transaction for batch insert
            const insertMany = this.db.transaction((items: Array<{ chunkId: number; vector: number[] }>) => {
                for (const item of items) {
                    const vectorArray = this.numberArrayToFloat32Array(item.vector);
                    const vectorBuffer = this.float32ArrayToBuffer(vectorArray);
                    
                    // Insert into vectors table (always)
                    insertVectorsStmt.run(item.chunkId, vectorBuffer);
                    
                    // Insert into vec_index virtual table if it exists
                    if (insertVecStmt) {
                        try {
                            // Try with Float32Array first
                            insertVecStmt.run(item.chunkId, vectorArray);
                        } catch (error) {
                            // If Float32Array doesn't work, try with Buffer
                            try {
                                insertVecStmt.run(item.chunkId, vectorBuffer);
                            } catch (bufferError) {
                                // If both fail, log warning but continue
                                console.warn('Failed to insert into vec_index, continuing with regular table only:', bufferError);
                            }
                        }
                    }
                }
            });

            // Split vectors into individual vectors
            const vectorItems: Array<{ chunkId: number; vector: number[] }> = [];
            for (let i = 0; i < numVectors; i++) {
                const startIdx = i * this.dimension;
                const endIdx = startIdx + this.dimension;
                const vector = vectors.slice(startIdx, endIdx);
                vectorItems.push({
                    chunkId: chunkIds[i],
                    vector: vector
                });
            }

            // Execute transaction
            insertMany(vectorItems);

            // Update metadata
            updateMetadataStmt.run(numVectors);

            console.log(`Added ${numVectors} vectors to SQLite-vec index`);
        } catch (error) {
            console.error('Failed to add vectors to SQLite-vec index:', error);
            throw new Error(`Failed to add vectors to SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search for similar vectors
     */
    async search(queryVector: number[], k: number = 10): Promise<VectorSearchResult> {
        if (!this.db) {
            throw new Error('Index not initialized');
        }

        this.validateDimensions(queryVector, this.dimension);

        try {
            // Get total number of vectors
            const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM vectors');
            const countResult = countStmt.get() as { count: number };
            const totalVectors = countResult.count;

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

            // Convert query vector to Float32Array and Buffer
            const queryVectorArray = this.numberArrayToFloat32Array(queryVector);
            const queryVectorBuffer = this.float32ArrayToBuffer(queryVectorArray);

            // Check if vec_index virtual table exists
            let vecTableExists = false;
            try {
                const checkTable = this.db.prepare(`
                    SELECT name FROM sqlite_master WHERE type='table' AND name=?
                `);
                const result = checkTable.get(this.vecIndexName);
                vecTableExists = result !== undefined;
            } catch (error) {
                // If check fails, assume table doesn't exist
                vecTableExists = false;
            }

            // Try vec0 virtual table MATCH syntax first (if available)
            if (vecTableExists) {
                try {
                    const searchStmt = this.db.prepare(`
                        SELECT chunk_id, distance 
                        FROM ${this.vecIndexName} 
                        WHERE embedding MATCH ? 
                        ORDER BY distance 
                        LIMIT ?
                    `);
                    const results = searchStmt.all(queryVectorBuffer, adjustedK) as Array<{ chunk_id: number; distance: number }>;

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
            try {
                const searchStmt = this.db.prepare(`
                    SELECT chunk_id, vec_distance_l2(embedding, ?) as distance 
                    FROM vectors 
                    ORDER BY distance 
                    LIMIT ?
                `);
                
                // Use Buffer as shown in merge guide
                const results = searchStmt.all(queryVectorBuffer, adjustedK) as Array<{ chunk_id: number; distance: number }>;

                return {
                    indices: results.map((_, i) => i),
                    distances: results.map(r => r.distance),
                    chunkIds: results.map(r => r.chunk_id)
                };
            } catch (error) {
                console.error('vec_distance_l2 search failed:', error);
                throw new Error(`Failed to perform vector search. Please ensure sqlite-vec extension is properly installed and configured. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to search vectors in SQLite-vec index:', error);
            throw new Error(`Failed to search vectors in SQLite-vec index: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get index statistics
     */
    getIndexStats(): IndexStats {
        if (!this.db) {
            return {
                totalVectors: 0,
                dimension: this.dimension || 0,
                indexType: 'unknown',
                isInitialized: this.initialized,
                modelName: this.config?.modelName || ''
            };
        }

        try {
            const metadataStmt = this.db.prepare('SELECT dimension, total_vectors, model_name, index_type FROM vector_metadata WHERE id = 1');
            const metadata = metadataStmt.get() as { dimension: number; total_vectors: number; model_name: string; index_type: string } | undefined;

            if (metadata) {
                return {
                    totalVectors: metadata.total_vectors,
                    dimension: metadata.dimension,
                    indexType: metadata.index_type,
                    isInitialized: this.initialized,
                    modelName: metadata.model_name
                };
            } else {
                // Fallback to counting from vectors table
                const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM vectors');
                const countResult = countStmt.get() as { count: number };
                return {
                    totalVectors: countResult.count,
                    dimension: this.dimension,
                    indexType: this.config?.indexType || 'flat',
                    isInitialized: this.initialized,
                    modelName: this.config?.modelName || ''
                };
            }
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
     */
    getTotalVectors(): number {
        if (!this.db) {
            throw new Error('Index not initialized');
        }

        try {
            const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM vectors');
            const countResult = countStmt.get() as { count: number };
            return countResult.count;
        } catch (error) {
            console.error('Failed to get total vectors:', error);
            throw new Error('Failed to get total vectors');
        }
    }

    /**
     * Reset the index
     */
    async resetIndex(): Promise<void> {
        if (!this.db) {
            throw new Error('Index not initialized');
        }

        try {
            // Drop tables
            this.db.exec(`DROP TABLE IF EXISTS ${this.vecIndexName}`);
            this.db.exec('DROP TABLE IF EXISTS vectors');
            this.db.exec('DROP TABLE IF EXISTS vector_metadata');

            // Recreate tables
            if (this.config) {
                await this.createIndex(this.config);
            } else {
                throw new Error('No configuration available to recreate index');
            }

            console.log('SQLite-vec index reset successfully');
        } catch (error) {
            console.error('Failed to reset SQLite-vec index:', error);
            throw new Error('Failed to reset SQLite-vec index');
        }
    }

    /**
     * Optimize the index
     */
    async optimizeIndex(): Promise<void> {
        if (!this.db) {
            throw new Error('Index not initialized');
        }

        try {
            // Run VACUUM to optimize database
            this.db.exec('VACUUM');
            // Run ANALYZE to update statistics
            this.db.exec('ANALYZE');
            console.log('SQLite-vec index optimization completed');
        } catch (error) {
            console.error('Failed to optimize SQLite-vec index:', error);
            throw new Error('Failed to optimize SQLite-vec index');
        }
    }

    /**
     * Backup the index
     */
    async backupIndex(backupPath: string): Promise<void> {
        if (!this.db) {
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
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            if (!fs.existsSync(backupPath)) {
                throw new Error(`Backup file not found: ${backupPath}`);
            }

            // Close current database if open
            if (this.db) {
                this.db.close();
                this.db = null;
            }

            // Copy backup file to current location
            if (this.config) {
                // Determine target path
                if (this.config.documentIndexPath) {
                    this.indexPath = this.config.documentIndexPath;
                } else if (this.config.documentId) {
                    this.indexPath = this.getDocumentSpecificIndexPath(this.config, this.config.documentId);
                } else {
                    this.indexPath = this.getModelSpecificIndexPath(this.config);
                }

                // Ensure .db extension
                if (this.indexPath.endsWith('.index')) {
                    this.indexPath = this.indexPath.replace(/\.index$/, '.db');
                } else if (!this.indexPath.endsWith('.db')) {
                    this.indexPath = this.indexPath + '.db';
                }

                // Ensure directory exists
                this.ensureIndexDirectory();

                // Copy backup file
                fs.copyFileSync(backupPath, this.indexPath);

                // Open restored database
                this.db = new Database(this.indexPath);
                this.loadExtension(this.db);
                this.db.pragma('journal_mode = WAL');

                // Read dimension from metadata
                const metadataStmt = this.db.prepare('SELECT dimension FROM vector_metadata WHERE id = 1');
                const metadata = metadataStmt.get() as { dimension: number } | undefined;
                if (metadata) {
                    this.dimension = metadata.dimension;
                }

                console.log(`SQLite-vec index restored from ${backupPath}`);
            } else {
                throw new Error('No configuration available to restore index');
            }
        } catch (error) {
            console.error('Failed to restore SQLite-vec index:', error);
            throw new Error('Failed to restore SQLite-vec index');
        }
    }

    /**
     * Delete a document-specific index
     */
    async deleteDocumentIndex(documentId: number): Promise<void> {
        if (!this.config) {
            throw new Error('No configuration available to determine index path');
        }

        try {
            const documentIndexPath = this.getDocumentSpecificIndexPath(this.config, documentId);
            
            // Change extension to .db
            const dbPath = documentIndexPath.endsWith('.index') 
                ? documentIndexPath.replace(/\.index$/, '.db')
                : documentIndexPath + '.db';

            // Close database if it's the current one
            if (this.db && this.indexPath === dbPath) {
                this.db.close();
                this.db = null;
            }

            if (fs.existsSync(dbPath)) {
                fs.unlinkSync(dbPath);
                console.log(`Deleted document-specific index for document ${documentId}: ${dbPath}`);
            } else {
                console.log(`No index found for document ${documentId} at path: ${dbPath}`);
            }
        } catch (error) {
            console.error(`Failed to delete document index for document ${documentId}:`, error);
            throw new Error(`Failed to delete document index for document ${documentId}`);
        }
    }

    /**
     * Check if a document-specific index exists
     */
    documentIndexExists(documentId: number): boolean {
        if (!this.config) {
            return false;
        }

        const documentIndexPath = this.getDocumentSpecificIndexPath(this.config, documentId);
        const dbPath = documentIndexPath.endsWith('.index') 
            ? documentIndexPath.replace(/\.index$/, '.db')
            : documentIndexPath + '.db';
        return fs.existsSync(dbPath);
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        if (this.db) {
            try {
                await this.saveIndex();
                this.db.close();
                console.log('SQLite-vec database connection closed');
            } catch (error) {
                console.error('Error closing database connection:', error);
            }
        }
        this.db = null;
        this.initialized = false;
        this.config = null;
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
        // Check for .db file
        if (fs.existsSync(this.indexPath)) {
            return true;
        }
        // Also check if .index file exists (for migration compatibility)
        const indexPath = this.indexPath.replace(/\.db$/, '.index');
        return fs.existsSync(indexPath);
    }
}


import * as faiss from 'faiss-node';
import * as fs from 'fs';
import { AbstractVectorDatabase } from '@/modules/interface/AbstractVectorDatabase';
import { VectorDatabaseConfig, VectorSearchResult, IndexStats } from '@/modules/interface/IVectorDatabase';

/**
 * FAISS index interface for type safety
 */
interface FAISSIndex {
    add(vectors: number[]): void;
    search(queryVector: number[], k: number): { indices: number[], distances: number[] };
    save(path: string): void;
    d(): number;  // dimension method in FAISS
    ntotal(): number;  // total vectors method in FAISS
    reset(): void;
}

/**
 * FAISS vector database implementation
 */
export class FaissVectorDatabase extends AbstractVectorDatabase {
    private index: FAISSIndex | null = null;
    private chunkIdMapping: Map<number, number> = new Map(); // Maps vector index to chunk ID

    /**
     * Initialize FAISS
     */
    async initialize(): Promise<void> {
        try {
            // FAISS is statically imported at the top
            this.initialized = true;
            console.log('FAISS initialized successfully');
        } catch (error) {
            console.error('Failed to initialize FAISS:', error);
            throw new Error('Failed to initialize FAISS. Please ensure faiss-node is installed.');
        }
    }

    /**
     * Create a new FAISS index
     */
    async createIndex(config: VectorDatabaseConfig): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        this.validateConfig(config);

        try {
            this.config = config;
            this.dimension = config.dimensions;
            
            // Update index path based on whether it's document-specific or model-specific
            if (config.documentId) {
                this.indexPath = this.getDocumentSpecificIndexPath(config, config.documentId);
                console.log(`Creating document-specific index for document ${config.documentId}`);
            } else {
                this.indexPath = this.getModelSpecificIndexPath(config);
                console.log(`Creating model-specific index for model ${config.modelId}`);
            }
            
            this.ensureIndexDirectory();
            
            const indexType = config.indexType || 'Flat';
            this.index = this.createFaissIndex(indexType, config.dimensions);

            console.log(`Created ${indexType} FAISS index for model ${config.modelId} with dimension ${config.dimensions}`);
        } catch (error) {
            console.error('Failed to create FAISS index:', error);
            throw new Error('Failed to create FAISS index');
        }
    }

    /**
     * Load existing FAISS index from disk
     */
    async loadIndex(config: VectorDatabaseConfig): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        this.validateConfig(config);

        try {
            this.config = config;
            
            // Update index path based on whether it's document-specific or model-specific
            if (config.documentId) {
                this.indexPath = this.getDocumentSpecificIndexPath(config, config.documentId);
                console.log(`Loading document-specific index for document ${config.documentId}`);
            } else {
                this.indexPath = this.getModelSpecificIndexPath(config);
                console.log(`Loading model-specific index for model ${config.modelId}`);
            }
            
            if (fs.existsSync(this.indexPath)) {
                this.index = (faiss as any).IndexFlatL2.load(this.indexPath);
                this.dimension = config.dimensions;
                
                // Note: Chunk ID mapping will need to be rebuilt from database
                // This is a limitation of FAISS - it doesn't store metadata
                console.log(`Loaded existing FAISS index for model ${config.modelId} with ${this.index?.ntotal() || 0} vectors`);
                console.warn('Chunk ID mapping will need to be rebuilt from database');
            } else {
                console.log(`No existing FAISS index found for model ${config.modelId}, creating new one`);
                await this.createIndex(config);
            }
        } catch (error) {
            console.error('Failed to load FAISS index:', error);
            throw new Error('Failed to load FAISS index');
        }
    }

    /**
     * Save FAISS index to disk
     */
    async saveIndex(): Promise<void> {
        if (!this.index) {
            throw new Error('No index to save');
        }

        try {
            this.index.save(this.indexPath);
            console.log(`FAISS index saved to ${this.indexPath}`);
        } catch (error) {
            console.error('Failed to save FAISS index:', error);
            throw new Error('Failed to save FAISS index');
        }
    }

    /**
     * Add vectors to the FAISS index
     * @param vectors - Array of vectors to add
     * @param chunkIds - Array of chunk IDs corresponding to vectors
     */
    async addVectors(vectors: number[], chunkIds: number[]): Promise<void> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        if (vectors.length === 0) {
            return;
        }

        // Validate vector has the correct dimension
        this.validateDimensions(vectors, this.dimension);

        try {
            const currentVectorCount = this.index.ntotal();
            
            // Debug logging
            console.log(`Adding vector to FAISS index. Vector has ${vectors.length} dimensions. Index dimension: ${this.dimension}`);
            console.log(`Current vector count before adding: ${currentVectorCount}`);
            console.log(vectors)
            this.index.add(vectors);
            
            // Store chunk ID mapping for each added vector
            for (let i = 0; i < chunkIds.length; i++) {
                this.chunkIdMapping.set(currentVectorCount + i, chunkIds[i]);
            }
            
            console.log(`Added vector to FAISS index`);
        } catch (error) {
            console.error('Failed to add vectors to FAISS index:', error);
            throw new Error('Failed to add vectors to FAISS index');
        }
    }

    /**
     * Search for similar vectors in FAISS index
     */
    async search(queryVector: number[], k: number = 10): Promise<VectorSearchResult> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        this.validateDimensions(queryVector, this.dimension);

        try {
            const results = this.index.search(queryVector, k);
            
            // Map indices to chunk IDs
            const chunkIds = results.indices.map(index => {
                const chunkId = this.chunkIdMapping.get(index);
                if (chunkId === undefined) {
                    console.warn(`No chunk ID found for vector index ${index}`);
                    return -1; // Use -1 to indicate missing chunk ID
                }
                return chunkId;
            });
            
            return {
                indices: results.indices,
                distances: results.distances,
                chunkIds: chunkIds
            };
        } catch (error) {
            console.error('Failed to search vectors in FAISS index:', error);
            throw new Error('Failed to search vectors in FAISS index');
        }
    }

    /**
     * Get FAISS index statistics
     */
    getIndexStats(): IndexStats {
        return {
            totalVectors: this.index?.ntotal() || 0,
            dimension: this.dimension,
            indexType: this.index?.constructor.name || 'Unknown',
            isInitialized: this.initialized,
            modelId: this.config?.modelId || '',
            dimensions: this.dimension
        };
    }

    /**
     * Reset the FAISS index
     */
    async resetIndex(): Promise<void> {
        if (this.index) {
            this.index.reset();
            this.chunkIdMapping.clear();
            console.log('FAISS index reset successfully');
        }
    }

    /**
     * Optimize the FAISS index
     */
    async optimizeIndex(): Promise<void> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        try {
            // For Flat index, no optimization needed
            // For other index types, optimization would be done here
            console.log('FAISS index optimization completed');
        } catch (error) {
            console.error('Failed to optimize FAISS index:', error);
            throw new Error('Failed to optimize FAISS index');
        }
    }

    /**
     * Backup the FAISS index
     */
    async backupIndex(backupPath: string): Promise<void> {
        if (!this.index) {
            throw new Error('No index to backup');
        }

        try {
            this.index.save(backupPath);
            console.log(`FAISS index backed up to ${backupPath}`);
        } catch (error) {
            console.error('Failed to backup FAISS index:', error);
            throw new Error('Failed to backup FAISS index');
        }
    }

    /**
     * Restore FAISS index from backup
     */
    async restoreIndex(backupPath: string): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            if (!fs.existsSync(backupPath)) {
                throw new Error(`Backup file not found: ${backupPath}`);
            }

            this.index = (faiss as any).IndexFlatL2.load(backupPath);
            this.dimension = this.index?.d() || 0;
            console.log(`FAISS index restored from ${backupPath}`);
        } catch (error) {
            console.error('Failed to restore FAISS index:', error);
            throw new Error('Failed to restore FAISS index');
        }
    }

    /**
     * Clean up FAISS resources
     */
    async cleanup(): Promise<void> {
        if (this.index) {
            await this.saveIndex();
        }
        this.index = null;
        this.chunkIdMapping.clear();
        this.initialized = false;
        this.config = null;
    }

    /**
     * Create FAISS index based on type
     */
    private createFaissIndex(indexType: string, dimensions: number): FAISSIndex {
        switch (indexType.toLowerCase()) {
            case 'flat':
                return new faiss.IndexFlatL2(dimensions) as any;
            case 'ivf':
                // IVF index requires training data, using Flat for now
                console.warn('IVF index requires training data, falling back to Flat index');
                return new faiss.IndexFlatL2(dimensions) as any;
            case 'hnsw':
                // HNSW index for better performance - using Flat for now as HNSW may not be available
                console.warn('HNSW index may not be available, falling back to Flat index');
                return new faiss.IndexFlatL2(dimensions) as any;
            default:
                return new faiss.IndexFlatL2(dimensions) as any;
        }
    }

    /**
     * Get FAISS-specific file extension
     */
    protected getFileExtension(): string {
        return 'faiss';
    }

    /**
     * Delete a document-specific index
     * @param documentId - Document ID to delete index for
     */
    async deleteDocumentIndex(documentId: number): Promise<void> {
        if (!this.config) {
            throw new Error('No configuration available to determine index path');
        }

        try {
            const documentIndexPath = this.getDocumentSpecificIndexPath(this.config, documentId);
            
            if (fs.existsSync(documentIndexPath)) {
                fs.unlinkSync(documentIndexPath);
                console.log(`Deleted document-specific index for document ${documentId}: ${documentIndexPath}`);
            } else {
                console.log(`No index found for document ${documentId} at path: ${documentIndexPath}`);
            }
        } catch (error) {
            console.error(`Failed to delete document index for document ${documentId}:`, error);
            throw new Error(`Failed to delete document index for document ${documentId}`);
        }
    }

    /**
     * Check if a document-specific index exists
     * @param documentId - Document ID to check
     */
    documentIndexExists(documentId: number): boolean {
        if (!this.config) {
            return false;
        }

        const documentIndexPath = this.getDocumentSpecificIndexPath(this.config, documentId);
        return fs.existsSync(documentIndexPath);
    }

    /**
     * Rebuild chunk ID mapping from database
     * This method should be called after loading an existing index
     * @param ragChunkModule - RAGChunkModule instance to query chunk data
     */
    async rebuildChunkIdMapping(ragChunkModule: any): Promise<void> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        try {
            this.chunkIdMapping.clear();
            
            // Get all chunks with embedding IDs for the current model
            const chunks = await ragChunkModule.getAllChunksWithEmbeddings(this.config?.modelId);
            
            for (const chunk of chunks) {
                if (chunk.embedding_id && chunk.embedding_id !== '') {
                    const vectorIndex = parseInt(chunk.embedding_id);
                    if (!isNaN(vectorIndex)) {
                        this.chunkIdMapping.set(vectorIndex, chunk.id);
                    }
                }
            }
            
            console.log(`Rebuilt chunk ID mapping with ${this.chunkIdMapping.size} entries`);
        } catch (error) {
            console.error('Failed to rebuild chunk ID mapping:', error);
            throw new Error('Failed to rebuild chunk ID mapping');
        }
    }
}

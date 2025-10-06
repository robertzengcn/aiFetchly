import * as faiss from 'faiss-node';
import * as fs from 'fs';
import { AbstractVectorDatabase } from '@/modules/interface/AbstractVectorDatabase';
import { VectorDatabaseConfig, VectorSearchResult, IndexStats } from '@/modules/interface/IVectorDatabase';

/**
 * FAISS index interface for type safety
 */
interface FAISSIndex {
    add(vectors: number[][]): void;
    search(queryVector: number[], k: number): { indices: number[], distances: number[] };
    save(path: string): void;
    getDimension(): number;
    getTotalVectors(): number;
    reset(): void;
}

/**
 * FAISS vector database implementation
 */
export class FaissVectorDatabase extends AbstractVectorDatabase {
    private index: FAISSIndex | null = null;

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
            
            // Update index path to include model information
            this.indexPath = this.getModelSpecificIndexPath(config);
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
            this.indexPath = this.getModelSpecificIndexPath(config);
            
            if (fs.existsSync(this.indexPath)) {
                this.index = (faiss as any).IndexFlatL2.load(this.indexPath);
                this.dimension = config.dimensions;
                console.log(`Loaded existing FAISS index for model ${config.modelId} with ${this.index?.getTotalVectors() || 0} vectors`);
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
     */
    async addVectors(vectors: number[][]): Promise<void> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        if (vectors.length === 0) {
            return;
        }

        // Validate all vectors have the correct dimension
        vectors.forEach(vector => {
            this.validateDimensions(vector, this.dimension);
        });

        try {
            this.index.add(vectors);
            console.log(`Added ${vectors.length} vectors to FAISS index`);
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
            return {
                indices: results.indices,
                distances: results.distances
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
            totalVectors: this.index?.getTotalVectors() || 0,
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
            this.dimension = this.index?.getDimension() || 0;
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
}

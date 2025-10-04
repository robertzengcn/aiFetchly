import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { RAGModelEntity } from '@/entity/RAGModel.entity';
import { RAGChunkModule } from '@/modules/RAGChunkModule';
import { SqliteDb } from '@/config/SqliteDb';
import * as fs from 'fs';
import * as path from 'path';
import * as faiss from 'faiss-node';

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
 * Embedding model configuration interface
 */
export interface EmbeddingModelConfig {
    modelId: string;
    dimensions: number;
    name?: string;
    description?: string;
}

/**
 * Vector store service for managing FAISS indices
 */
export class VectorStoreService {
    private db: SqliteDb;
    private index: FAISSIndex | null = null;
    private indexPath: string;
    private dimension: number = 0;
    private isInitialized: boolean = false;
    private currentModel: EmbeddingModelConfig | null = null;
    private ragChunkModule: RAGChunkModule;

    constructor(db: SqliteDb, indexPath?: string) {
        this.db = db;
        this.indexPath = indexPath || path.join(process.cwd(), 'data', 'vector_index');
        this.ragChunkModule = new RAGChunkModule();
        this.ensureIndexDirectory();
    }

    /**
     * Initialize the vector store service
     */
    async initialize(): Promise<void> {
        try {
            // FAISS is now statically imported at the top of the file
            this.isInitialized = true;
            console.log('FAISS initialized successfully');
        } catch (error) {
            console.error('Failed to initialize FAISS:', error);
            throw new Error('Failed to initialize FAISS. Please ensure faiss-node is installed.');
        }
    }

    /**
     * Create a new FAISS index with specific embedding model configuration
     * @param modelConfig - Embedding model configuration
     * @param indexType - Type of index (default: 'Flat')
     */
    async createIndex(modelConfig: EmbeddingModelConfig, indexType: string = 'Flat'): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            this.dimension = modelConfig.dimensions;
            this.currentModel = modelConfig;
            
            // Update index path to include model information for model-specific indices
            const modelSpecificPath = this.getModelSpecificIndexPath(modelConfig);
            this.indexPath = modelSpecificPath;
            this.ensureIndexDirectory();
            
            switch (indexType.toLowerCase()) {
                case 'flat':
                    this.index = new faiss.IndexFlatL2(modelConfig.dimensions) as any;
                    break;
                case 'ivf':
                    // IVF index requires training data, using Flat for now
                    this.index = new faiss.IndexFlatL2(modelConfig.dimensions) as any;
                    break;
                case 'hnsw':
                    // HNSW index for better performance - using Flat for now as HNSW may not be available
                    this.index = new faiss.IndexFlatL2(modelConfig.dimensions) as any;
                    break;
                default:
                    this.index = new faiss.IndexFlatL2(modelConfig.dimensions) as any;
            }

            console.log(`Created ${indexType} index for model ${modelConfig.modelId} with dimension ${modelConfig.dimensions}`);
        } catch (error) {
            console.error('Failed to create FAISS index:', error);
            throw new Error('Failed to create FAISS index');
        }
    }

    /**
     * Create a new FAISS index (legacy method for backward compatibility)
     * @param dimension - Vector dimension
     * @param indexType - Type of index (default: 'Flat')
     * @deprecated Use createIndex(modelConfig, indexType) instead
     */
    async createIndexLegacy(dimension: number, indexType: string = 'Flat'): Promise<void> {
        const defaultModel: EmbeddingModelConfig = {
            modelId: 'default',
            dimensions: dimension,
            name: 'Default Model',
            description: 'Legacy default model'
        };
        
        await this.createIndex(defaultModel, indexType);
    }

    /**
     * Load existing index from disk with model configuration
     * @param modelConfig - Embedding model configuration
     */
    async loadIndex(modelConfig: EmbeddingModelConfig): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const modelSpecificPath = this.getModelSpecificIndexPath(modelConfig);
            this.indexPath = modelSpecificPath;
            
            if (fs.existsSync(this.indexPath)) {
                this.index = (faiss as any).IndexFlatL2.load(this.indexPath);
                this.dimension = modelConfig.dimensions;
                this.currentModel = modelConfig;
                console.log(`Loaded existing index for model ${modelConfig.modelId} with ${this.index?.getTotalVectors() || 0} vectors`);
            } else {
                console.log(`No existing index found for model ${modelConfig.modelId}, creating new one`);
                await this.createIndex(modelConfig);
            }
        } catch (error) {
            console.error('Failed to load FAISS index:', error);
            throw new Error('Failed to load FAISS index');
        }
    }

    /**
     * Load existing index from disk (legacy method for backward compatibility)
     * @param dimension - Expected vector dimension
     * @deprecated Use loadIndex(modelConfig) instead
     */
    async loadIndexLegacy(dimension: number): Promise<void> {
        const defaultModel: EmbeddingModelConfig = {
            modelId: 'default',
            dimensions: dimension,
            name: 'Default Model',
            description: 'Legacy default model'
        };
        
        await this.loadIndex(defaultModel);
    }

    /**
     * Save index to disk
     */
    async saveIndex(): Promise<void> {
        if (!this.index) {
            throw new Error('No index to save');
        }

        try {
            this.index.save(this.indexPath);
            console.log(`Index saved to ${this.indexPath}`);
        } catch (error) {
            console.error('Failed to save FAISS index:', error);
            throw new Error('Failed to save FAISS index');
        }
    }

    /**
     * Store a single embedding with model information
     * @param embeddingData - Embedding data to store
     */
    async storeEmbedding(embeddingData: {
        chunkId: number;
        documentId: number;
        content: string;
        embedding: number[];
        metadata?: any;
        model?: string;
        dimensions?: number;
    }): Promise<void> {
        // Check if we need to create or load index for this model
        if (embeddingData.model && embeddingData.dimensions) {
            const modelConfig: EmbeddingModelConfig = {
                modelId: embeddingData.model,
                dimensions: embeddingData.dimensions
            };

            // Check if index exists for this model, if not create it
            if (!this.indexExistsForModel(modelConfig)) {
                console.log(`Creating new index for model ${embeddingData.model} with dimensions ${embeddingData.dimensions}`);
                await this.createIndex(modelConfig);
            } else if (!this.currentModel || 
                       this.currentModel.modelId !== embeddingData.model || 
                       this.currentModel.dimensions !== embeddingData.dimensions) {
                console.log(`Loading existing index for model ${embeddingData.model} with dimensions ${embeddingData.dimensions}`);
                await this.loadIndex(modelConfig);
            }
        }

        await this.addVectors([embeddingData.embedding], [embeddingData.chunkId]);
    }

    /**
     * Add vectors to the index
     * @param vectors - Array of vectors to add
     * @param chunkIds - Array of chunk IDs corresponding to vectors
     */
    async addVectors(vectors: number[][], chunkIds: number[]): Promise<void> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        if (vectors.length !== chunkIds.length) {
            throw new Error('Vectors and chunk IDs length mismatch');
        }

        try {
            // Add vectors to FAISS index
            this.index.add(vectors);
            

            // Update chunk entities with embedding IDs using RAGChunkModule
            const startIndex = this.index.getTotalVectors() - vectors.length;

            for (let i = 0; i < chunkIds.length; i++) {
                const embeddingId = (startIndex + i).toString();
                await this.ragChunkModule.updateChunkEmbedding(
                    chunkIds[i], 
                    embeddingId, 
                    this.dimension
                );
            }

            console.log(`Added ${vectors.length} vectors to index`);
        } catch (error) {
            console.error('Failed to add vectors to index:', error);
            throw new Error('Failed to add vectors to index');
        }
    }

    /**
     * Search for similar vectors
     * @param queryVector - Query vector
     * @param k - Number of results to return
     * @returns Search results with indices and distances
     */
    async search(queryVector: number[], k: number = 10): Promise<{
        indices: number[];
        distances: number[];
        chunkIds: number[];
    }> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        if (queryVector.length !== this.dimension) {
            throw new Error(`Query vector dimension ${queryVector.length} does not match index dimension ${this.dimension}`);
        }

        try {
            const results = this.index.search(queryVector, k);
            
            // Get chunk IDs for the results using RAGChunkModule
            const chunkIds: number[] = [];

            for (const index of results.indices) {
                const chunks = await this.ragChunkModule.getChunksByEmbeddingId(index.toString());
                if (chunks.length > 0) {
                    // Take the first chunk if multiple chunks have the same embedding ID
                    chunkIds.push(chunks[0].id);
                }
            }

            return {
                indices: results.indices,
                distances: results.distances,
                chunkIds
            };
        } catch (error) {
            console.error('Failed to search vectors:', error);
            throw new Error('Failed to search vectors');
        }
    }

    /**
     * Get index statistics
     * @returns Index statistics
     */
    getIndexStats(): {
        totalVectors: number;
        dimension: number;
        indexType: string;
        isInitialized: boolean;
        currentModel: EmbeddingModelConfig | null;
    } {
        return {
            totalVectors: this.index?.getTotalVectors() || 0,
            dimension: this.dimension,
            indexType: this.index?.constructor.name || 'Unknown',
            isInitialized: this.isInitialized,
            currentModel: this.currentModel
        };
    }

    /**
     * Reset the index
     */
    async resetIndex(): Promise<void> {
        if (this.index) {
            this.index.reset();
            console.log('Index reset successfully');
        }
    }

    /**
     * Optimize the index
     */
    async optimizeIndex(): Promise<void> {
        if (!this.index) {
            throw new Error('Index not initialized');
        }

        try {
            // For Flat index, no optimization needed
            // For other index types, optimization would be done here
            console.log('Index optimization completed');
        } catch (error) {
            console.error('Failed to optimize index:', error);
            throw new Error('Failed to optimize index');
        }
    }

    /**
     * Backup the index
     * @param backupPath - Path to save backup
     */
    async backupIndex(backupPath: string): Promise<void> {
        if (!this.index) {
            throw new Error('No index to backup');
        }

        try {
            this.index.save(backupPath);
            console.log(`Index backed up to ${backupPath}`);
        } catch (error) {
            console.error('Failed to backup index:', error);
            throw new Error('Failed to backup index');
        }
    }

    /**
     * Restore index from backup
     * @param backupPath - Path to backup file
     */
    async restoreIndex(backupPath: string): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            if (!fs.existsSync(backupPath)) {
                throw new Error(`Backup file not found: ${backupPath}`);
            }

            this.index = (faiss as any).IndexFlatL2.load(backupPath);
            this.dimension = this.index?.getDimension() || 0;
            console.log(`Index restored from ${backupPath}`);
        } catch (error) {
            console.error('Failed to restore index:', error);
            throw new Error('Failed to restore index');
        }
    }

    /**
     * Generate model-specific index path
     * @param modelConfig - Embedding model configuration
     * @returns Model-specific index path
     */
    private getModelSpecificIndexPath(modelConfig: EmbeddingModelConfig): string {
        const baseDir = path.dirname(this.indexPath);
        const fileName = `index_${modelConfig.modelId}_${modelConfig.dimensions}.faiss`;
        return path.join(baseDir, 'models', fileName);
    }

    /**
     * Ensure index directory exists
     */
    private ensureIndexDirectory(): void {
        const dir = path.dirname(this.indexPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        if (this.index) {
            await this.saveIndex();
        }
        this.index = null;
        this.isInitialized = false;
    }

    /**
     * Get index file size
     * @returns Index file size in bytes
     */
    getIndexFileSize(): number {
        try {
            if (fs.existsSync(this.indexPath)) {
                return fs.statSync(this.indexPath).size;
            }
            return 0;
        } catch {
            return 0;
        }
    }

    /**
     * Check if index exists
     * @returns True if index file exists
     */
    indexExists(): boolean {
        return fs.existsSync(this.indexPath);
    }

    /**
     * Check if index exists for a specific model
     * @param modelConfig - Embedding model configuration
     * @returns True if index file exists for the model
     */
    indexExistsForModel(modelConfig: EmbeddingModelConfig): boolean {
        const modelSpecificPath = this.getModelSpecificIndexPath(modelConfig);
        return fs.existsSync(modelSpecificPath);
    }

    /**
     * Get current model configuration
     * @returns Current model configuration or null if not set
     */
    getCurrentModel(): EmbeddingModelConfig | null {
        return this.currentModel;
    }

    /**
     * Switch to a different embedding model
     * @param modelConfig - New embedding model configuration
     * @param indexType - Type of index (default: 'Flat')
     */
    async switchModel(modelConfig: EmbeddingModelConfig, indexType: string = 'Flat'): Promise<void> {
        // Save current index if it exists
        if (this.index) {
            await this.saveIndex();
        }

        // Load or create index for the new model
        await this.loadIndex(modelConfig);
    }

    /**
     * Create index from RAGModelEntity
     * @param ragModel - RAG model entity
     * @param indexType - Type of index (default: 'Flat')
     */
    async createIndexFromRAGModel(ragModel: RAGModelEntity, indexType: string = 'Flat'): Promise<void> {
        const modelConfig: EmbeddingModelConfig = {
            modelId: ragModel.modelId,
            dimensions: ragModel.dimensions,
            name: ragModel.name,
            description: ragModel.description
        };

        await this.createIndex(modelConfig, indexType);
    }

    /**
     * Load index from RAGModelEntity
     * @param ragModel - RAG model entity
     */
    async loadIndexFromRAGModel(ragModel: RAGModelEntity): Promise<void> {
        const modelConfig: EmbeddingModelConfig = {
            modelId: ragModel.modelId,
            dimensions: ragModel.dimensions,
            name: ragModel.name,
            description: ragModel.description
        };

        await this.loadIndex(modelConfig);
    }
}

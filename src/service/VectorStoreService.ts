import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { RAGModelEntity } from '@/entity/RAGModel.entity';
import { RAGChunkModule } from '@/modules/RAGChunkModule';
import { SqliteDb } from '@/config/SqliteDb';
import * as path from 'path';
import { IVectorDatabase } from '@/modules/interface/IVectorDatabase';
import { VectorDatabaseFactory, VectorDatabaseType, VectorDatabaseFactoryConfig } from '@/modules/factories/VectorDatabaseFactory';
import { VectorDatabaseConfig } from '@/modules/interface/IVectorDatabase';

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
 * Vector store service for managing vector databases using the Strategy pattern
 * Supports multiple vector database backends (FAISS, Chroma, Pinecone, etc.)
 */
export class VectorStoreService {
    private db: SqliteDb;
    private vectorDatabase: IVectorDatabase;
    private indexPath: string;
    private currentModel: EmbeddingModelConfig | null = null;
    private ragChunkModule: RAGChunkModule;
    private databaseType: VectorDatabaseType;

    constructor(
        db: SqliteDb, 
        indexPath?: string, 
        databaseType: VectorDatabaseType = VectorDatabaseType.FAISS
    ) {
        this.db = db;
        this.indexPath = indexPath || path.join(process.cwd(), 'data', 'vector_index');
        this.databaseType = databaseType;
        this.ragChunkModule = new RAGChunkModule();
        
        // Create vector database instance using factory
        this.vectorDatabase = VectorDatabaseFactory.createDatabase({
            type: databaseType,
            baseIndexPath: this.indexPath
        });
    }

    /**
     * Initialize the vector store service
     */
    async initialize(): Promise<void> {
        try {
            await this.vectorDatabase.initialize();
            console.log(`${this.databaseType} vector database initialized successfully`);
        } catch (error) {
            console.error(`Failed to initialize ${this.databaseType} vector database:`, error);
            throw new Error(`Failed to initialize ${this.databaseType} vector database`);
        }
    }

    /**
     * Create a new vector database index with specific embedding model configuration
     * @param modelConfig - Embedding model configuration
     * @param indexType - Type of index (default: 'Flat')
     */
    async createIndex(modelConfig: EmbeddingModelConfig, indexType: string = 'Flat'): Promise<void> {
        if (!this.vectorDatabase.isInitialized()) {
            await this.initialize();
        }

        try {
            this.currentModel = modelConfig;
            
            const vectorDbConfig: VectorDatabaseConfig = {
                indexPath: this.indexPath,
                modelId: modelConfig.modelId,
                dimensions: modelConfig.dimensions,
                indexType
            };

            await this.vectorDatabase.createIndex(vectorDbConfig);
            console.log(`Created ${indexType} index for model ${modelConfig.modelId} with dimension ${modelConfig.dimensions}`);
        } catch (error) {
            console.error(`Failed to create ${this.databaseType} index:`, error);
            throw new Error(`Failed to create ${this.databaseType} index`);
        }
    }

    /**
     * Create a new vector database index (legacy method for backward compatibility)
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
        if (!this.vectorDatabase.isInitialized()) {
            await this.initialize();
        }

        try {
            this.currentModel = modelConfig;
            
            const vectorDbConfig: VectorDatabaseConfig = {
                indexPath: this.indexPath,
                modelId: modelConfig.modelId,
                dimensions: modelConfig.dimensions
            };

            await this.vectorDatabase.loadIndex(vectorDbConfig);
            const stats = this.vectorDatabase.getIndexStats();
            console.log(`Loaded existing index for model ${modelConfig.modelId} with ${stats.totalVectors} vectors`);
        } catch (error) {
            console.error(`Failed to load ${this.databaseType} index:`, error);
            throw new Error(`Failed to load ${this.databaseType} index`);
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
        try {
            await this.vectorDatabase.saveIndex();
        } catch (error) {
            console.error(`Failed to save ${this.databaseType} index:`, error);
            throw new Error(`Failed to save ${this.databaseType} index`);
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
        if (!this.vectorDatabase.isInitialized()) {
            throw new Error('Vector database not initialized');
        }

        if (vectors.length !== chunkIds.length) {
            throw new Error('Vectors and chunk IDs length mismatch');
        }

        try {
            // Add vectors to the vector database
            await this.vectorDatabase.addVectors(vectors);

            // Update chunk entities with embedding IDs using RAGChunkModule
            const stats = this.vectorDatabase.getIndexStats();
            const startIndex = stats.totalVectors - vectors.length;

            for (let i = 0; i < chunkIds.length; i++) {
                const embeddingId = (startIndex + i).toString();
                await this.ragChunkModule.updateChunkEmbedding(
                    chunkIds[i], 
                    embeddingId, 
                    stats.dimension
                );
            }

            console.log(`Added ${vectors.length} vectors to ${this.databaseType} index`);
        } catch (error) {
            console.error(`Failed to add vectors to ${this.databaseType} index:`, error);
            throw new Error(`Failed to add vectors to ${this.databaseType} index`);
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
        if (!this.vectorDatabase.isInitialized()) {
            throw new Error('Vector database not initialized');
        }

        const stats = this.vectorDatabase.getIndexStats();
        if (queryVector.length !== stats.dimension) {
            throw new Error(`Query vector dimension ${queryVector.length} does not match index dimension ${stats.dimension}`);
        }

        try {
            const results = await this.vectorDatabase.search(queryVector, k);
            
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
            console.error(`Failed to search vectors in ${this.databaseType}:`, error);
            throw new Error(`Failed to search vectors in ${this.databaseType}`);
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
        databaseType: string;
    } {
        const dbStats = this.vectorDatabase.getIndexStats();
        return {
            totalVectors: dbStats.totalVectors,
            dimension: dbStats.dimension,
            indexType: dbStats.indexType,
            isInitialized: dbStats.isInitialized,
            currentModel: this.currentModel,
            databaseType: this.databaseType
        };
    }

    /**
     * Reset the index
     */
    async resetIndex(): Promise<void> {
        try {
            await this.vectorDatabase.resetIndex();
        } catch (error) {
            console.error(`Failed to reset ${this.databaseType} index:`, error);
            throw new Error(`Failed to reset ${this.databaseType} index`);
        }
    }

    /**
     * Optimize the index
     */
    async optimizeIndex(): Promise<void> {
        try {
            await this.vectorDatabase.optimizeIndex();
        } catch (error) {
            console.error(`Failed to optimize ${this.databaseType} index:`, error);
            throw new Error(`Failed to optimize ${this.databaseType} index`);
        }
    }

    /**
     * Backup the index
     * @param backupPath - Path to save backup
     */
    async backupIndex(backupPath: string): Promise<void> {
        try {
            await this.vectorDatabase.backupIndex(backupPath);
        } catch (error) {
            console.error(`Failed to backup ${this.databaseType} index:`, error);
            throw new Error(`Failed to backup ${this.databaseType} index`);
        }
    }

    /**
     * Restore index from backup
     * @param backupPath - Path to backup file
     */
    async restoreIndex(backupPath: string): Promise<void> {
        if (!this.vectorDatabase.isInitialized()) {
            await this.initialize();
        }

        try {
            await this.vectorDatabase.restoreIndex(backupPath);
        } catch (error) {
            console.error(`Failed to restore ${this.databaseType} index:`, error);
            throw new Error(`Failed to restore ${this.databaseType} index`);
        }
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        try {
            await this.vectorDatabase.cleanup();
        } catch (error) {
            console.error(`Failed to cleanup ${this.databaseType} vector database:`, error);
        }
    }

    /**
     * Get index file size
     * @returns Index file size in bytes
     */
    getIndexFileSize(): number {
        return this.vectorDatabase.getIndexFileSize();
    }

    /**
     * Check if index exists
     * @returns True if index file exists
     */
    indexExists(): boolean {
        return this.vectorDatabase.indexExists();
    }

    /**
     * Check if index exists for a specific model
     * @param modelConfig - Embedding model configuration
     * @returns True if index file exists for the model
     */
    indexExistsForModel(modelConfig: EmbeddingModelConfig): boolean {
        // Create a temporary vector database config to check existence
        const vectorDbConfig: VectorDatabaseConfig = {
            indexPath: this.indexPath,
            modelId: modelConfig.modelId,
            dimensions: modelConfig.dimensions
        };
        
        // Create a temporary database instance to check if index exists
        const tempDb = VectorDatabaseFactory.createDatabase({
            type: this.databaseType,
            baseIndexPath: this.indexPath
        });
        
        // Generate the expected path for this model
        const baseDir = path.dirname(this.indexPath);
        const fileName = `index_${modelConfig.modelId}_${modelConfig.dimensions}.${this.getFileExtension()}`;
        const modelSpecificPath = path.join(baseDir, 'models', fileName);
        
        return require('fs').existsSync(modelSpecificPath);
    }

    /**
     * Get file extension for the current database type
     */
    private getFileExtension(): string {
        switch (this.databaseType) {
            case VectorDatabaseType.FAISS:
                return 'faiss';
            // Add other database types as needed
            default:
                return 'index';
        }
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
        if (this.vectorDatabase.isInitialized()) {
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

    /**
     * Switch to a different vector database type
     * @param databaseType - New vector database type
     * @param indexPath - Optional new index path
     */
    async switchDatabase(databaseType: VectorDatabaseType, indexPath?: string): Promise<void> {
        // Save current index if it exists
        if (this.vectorDatabase.isInitialized()) {
            await this.saveIndex();
        }

        // Clean up current database
        await this.vectorDatabase.cleanup();

        // Create new database instance
        this.databaseType = databaseType;
        if (indexPath) {
            this.indexPath = indexPath;
        }

        this.vectorDatabase = VectorDatabaseFactory.createDatabase({
            type: databaseType,
            baseIndexPath: this.indexPath
        });

        console.log(`Switched to ${databaseType} vector database`);
    }

    /**
     * Get the current vector database type
     */
    getDatabaseType(): VectorDatabaseType {
        return this.databaseType;
    }
}

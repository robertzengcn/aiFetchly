// import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
// import { RAGModelEntity } from '@/entity/RAGModel.entity';
import { RAGChunkModule } from '@/modules/RAGChunkModule';
// import { SqliteDb } from '@/config/SqliteDb';
import * as path from 'path';
import * as fs from 'fs';
import { IVectorDatabase } from '@/modules/interface/IVectorDatabase';
import { VectorDatabaseFactory, VectorDatabaseType, VectorDatabaseFactoryConfig } from '@/modules/factories/VectorDatabaseFactory';
import { VectorDatabasePool, VectorDatabaseKeyGenerator } from '@/modules/factories/VectorDatabasePool';
import { VectorDatabaseConfig } from '@/modules/interface/IVectorDatabase';

/**
 * Embedding model configuration interface
 */
export interface EmbeddingModelConfig {
    // modelId: string;
    dimensions: number;
    name: string;
    description?: string;
    documentIndexPath?: string;
}

/**
 * Vector store service for managing vector databases using the Strategy pattern
 * Supports multiple vector database backends (FAISS, Chroma, Pinecone, etc.)
 */
export class VectorStoreService {
    // private db: SqliteDb;
    private vectorDatabase: IVectorDatabase;
    private indexPath: string;
    private currentModel: EmbeddingModelConfig | null = null;
    private ragChunkModule: RAGChunkModule;
    private databaseType: VectorDatabaseType;

    constructor(
        // db: SqliteDb, 
        indexPath?: string, 
        databaseType: VectorDatabaseType = VectorDatabaseType.SQLITE_VEC
    ) {
        // this.db = db;
        this.indexPath = indexPath || path.join(process.cwd(), 'data', 'vector_index');
        this.databaseType = databaseType;
        this.ragChunkModule = new RAGChunkModule();
        
        // Create vector database instance using factory (will be replaced by pool later)
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
                modelName: modelConfig.name,
                dimensions: modelConfig.dimensions,
                indexType
            };

            const indexPath = await this.vectorDatabase.createIndex(vectorDbConfig);
            console.log(`Created ${indexType} index for model ${modelConfig.name} with dimension ${modelConfig.name} at ${indexPath}`);
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
    async createIndexLegacy(modelName: string, dimension: number, indexType: string = 'Flat'): Promise<void> {
        const defaultModel: EmbeddingModelConfig = {
            name: modelName,
            dimensions: dimension,
            // name: 'Default Model',
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
                modelName: modelConfig.name,
                dimensions: modelConfig.dimensions
            };

            await this.vectorDatabase.loadIndex(vectorDbConfig);
            
            // Note: sqlite-vec stores chunk_id directly, so no need to rebuild chunk ID mapping
            // Only FAISS needs this workaround
            if (this.databaseType === VectorDatabaseType.FAISS && 
                'rebuildChunkIdMapping' in this.vectorDatabase &&
                vectorDbConfig.documentId) {
                await (this.vectorDatabase as any).rebuildChunkIdMapping(this.ragChunkModule, vectorDbConfig.documentId);
            }
            
            const stats = this.vectorDatabase.getIndexStats();
            console.log(`Loaded existing index for model ${modelConfig.name} with ${stats.totalVectors} vectors`);
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
    async loadIndexLegacy(modelName: string, dimension: number): Promise<void> {
        const defaultModel: EmbeddingModelConfig = {
            name: modelName,
            dimensions: dimension,
            // name: 'Default Model',
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
     * Store a single embedding with model information (document-specific) using pooled instance
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
        vectorIndexPath?: string;
    }): Promise<void> {
        // Check if we need to create or load document-specific index for this model
        if (embeddingData.model && embeddingData.dimensions && embeddingData.documentId) {
            const modelConfig: EmbeddingModelConfig = {
                name: embeddingData.model,
                dimensions: embeddingData.dimensions,
                documentIndexPath: embeddingData.vectorIndexPath
            };

            // Check if document-specific index exists by vectorIndexPath if provided
            let indexExists = false;
            if (embeddingData.vectorIndexPath) {
                indexExists = this.checkIndexExistsByPath(embeddingData.vectorIndexPath);
            } else {
                indexExists = this.documentIndexExists(embeddingData.documentId, modelConfig);
            }

            // Get pooled instance for this document and model
            const pooledInstance = this.getPooledDocumentInstance(embeddingData.documentId, modelConfig);

            // If index doesn't exist, create it
            if (!indexExists) {
                console.log(`Creating new document-specific index for document ${embeddingData.documentId} with model ${embeddingData.model} (using pool)`);
                if (embeddingData.vectorIndexPath) {
                    await this.createDocumentIndexByPath(embeddingData.vectorIndexPath, embeddingData.documentId, modelConfig);
                } else {
                    await this.createDocumentIndex(embeddingData.documentId, modelConfig);
                }
            } else if (!this.currentModel || 
                       this.currentModel.name !== embeddingData.model 
                    //    this.currentModel.dimensions !== embeddingData.dimensions
                    ) {
                console.log(`Loading existing document-specific index for document ${embeddingData.documentId} with model ${embeddingData.model} (using pool)`);
                await this.loadDocumentIndex(embeddingData.documentId, modelConfig);
            }

            // Use pooled instance to add vectors
            await this.addVectorsWithInstance(pooledInstance, embeddingData.embedding, embeddingData.chunkId);
        } else {
            throw new Error('Document ID, model, and dimensions are required for document-specific indexing');
        }
    }

    /**
     * Add vectors to the index
     * @param vectors - Array of vectors to add
     * @param chunkIds - Array of chunk IDs corresponding to vectors
     */
    async addVectors(vectors: number[], chunkIds: number): Promise<void> {
        return this.addVectorsWithInstance(this.vectorDatabase, vectors, chunkIds);
    }

    /**
     * Add vectors to a specific instance
     * @param instance - Vector database instance
     * @param vectors - Array of vectors to add
     * @param chunkIds - Array of chunk IDs corresponding to vectors
     */
    private async addVectorsWithInstance(instance: IVectorDatabase, vectors: number[], chunkIds: number): Promise<void> {
        if (!instance.isInitialized()) {
            throw new Error('Vector database not initialized');
        }

        // if (vectors.length !== chunkIds.length) {
        //     throw new Error('Vectors and chunk IDs length mismatch');
        // }

        try {
            // const stats = instance.getIndexStats();
            // const startIndex = stats.totalVectors;

            // Add each vector individually (API expects single vector)
            // for (let i = 0; i < vectors.length; i++) {
                await instance.addVectors(vectors, chunkIds);
                
                // Update chunk entity with embedding ID
                // const embeddingId = (startIndex + i).toString();
                // await this.ragChunkModule.updateChunkEmbedding(
                //     chunkIds[i], 
                //     embeddingId
                //     // stats.dimension
                // );
            // }

            console.log(`Added ${vectors.length} vectors to ${this.databaseType} index (using pool)`);
        } catch (error) {
            console.error(`Failed to add vectors to ${this.databaseType} index:`, error);
            throw new Error(`Failed to add vectors to ${this.databaseType} index`);
        }
    }

    /**
     * Search for similar vectors
     * @param queryVector - Query vector
     * @param k - Number of results to return
     * @returns Search results with indices, distances, and chunkIds
     */
    async search(queryVector: number[], k: number = 10): Promise<{
        indices: number[];
        distances: number[];
        chunkIds: number[];
    }> {
        if (!this.vectorDatabase.isInitialized()) {
            throw new Error('Vector database not initialized');
        }

        // const stats = this.vectorDatabase.getIndexStats();
        // if (queryVector.length !== stats.dimension) {
        //     throw new Error(`Query vector dimension ${queryVector.length} does not match index dimension ${stats.dimension}`);
        // }

        try {
            const results = await this.vectorDatabase.search(queryVector, k);
            
            // Vector database now returns chunkIds directly
            return {
                indices: results.indices,
                distances: results.distances,
                chunkIds: results.chunkIds
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
     * Get total number of vectors in the index
     * @returns Total number of vectors
     */
    getTotalVectors(): number {
        return this.vectorDatabase.getTotalVectors();
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
            modelName: modelConfig.name,
            dimensions: modelConfig.dimensions
        };
        
        // Create a temporary database instance to check if index exists
        const tempDb = VectorDatabaseFactory.createDatabase({
            type: this.databaseType,
            baseIndexPath: this.indexPath
        });
        
        // Generate the expected path for this model
        const baseDir = path.dirname(this.indexPath);
        const fileName = `index_${modelConfig.name}_${modelConfig.name}.${this.getFileExtension()}`;
        const modelSpecificPath = path.join(baseDir, 'models', fileName);
        
        return require('fs').existsSync(modelSpecificPath);
    }

    /**
     * Get file extension for the current database type
     */
    private getFileExtension(): string {
        switch (this.databaseType) {
            case VectorDatabaseType.FAISS:
                return 'index';
            case VectorDatabaseType.SQLITE_VEC:
                return 'db';
            // Add other database types as needed
            default:
                return 'db';
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
     * Generate instance key for pool
     * @param modelConfig - Model configuration
     * @param documentId - Optional document ID
     * @returns Instance key
     */
    private getInstanceKey(modelConfig: EmbeddingModelConfig, documentId?: number): string {
        if (documentId) {
            return VectorDatabaseKeyGenerator.generateDocumentKey(documentId, modelConfig, this.indexPath);
        } else {
            return VectorDatabaseKeyGenerator.generateModelKey(modelConfig, this.indexPath);
        }
    }

    /**
     * Get pooled instance for document-specific operations
     * @param documentId - Document ID
     * @param modelConfig - Model configuration
     * @returns Pooled vector database instance
     */
    private getPooledDocumentInstance(documentId: number, modelConfig: EmbeddingModelConfig): IVectorDatabase {
        const key = this.getInstanceKey(modelConfig, documentId);
        return VectorDatabasePool.getInstance(key, {
            type: this.databaseType,
            baseIndexPath: this.indexPath
        });
    }

    /**
     * Get pooled instance for model-specific operations
     * @param modelConfig - Model configuration
     * @returns Pooled vector database instance
     */
    private getPooledModelInstance(modelConfig: EmbeddingModelConfig): IVectorDatabase {
        const key = this.getInstanceKey(modelConfig);
        return VectorDatabasePool.getInstance(key, {
            type: this.databaseType,
            baseIndexPath: this.indexPath
        });
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
    // async createIndexFromRAGModel(ragModel: RAGModelEntity, indexType: string = 'Flat'): Promise<void> {
    //     const modelConfig: EmbeddingModelConfig = {
    //         modelId: ragModel.modelId,
    //         dimensions: ragModel.dimensions,
    //         name: ragModel.name,
    //         description: ragModel.description
    //     };

    //     await this.createIndex(modelConfig, indexType);
    // }

    /**
     * Load index from RAGModelEntity
     * @param ragModel - RAG model entity
     */
    // async loadIndexFromRAGModel(ragModel: RAGModelEntity): Promise<void> {
    //     const modelConfig: EmbeddingModelConfig = {
    //         modelId: ragModel.modelId,
    //         dimensions: ragModel.dimensions,
    //         name: ragModel.name,
    //         description: ragModel.description
    //     };

    //     await this.loadIndex(modelConfig);
    // }

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

    /**
     * Create a document-specific index using pooled instance
     * @param documentId - Document ID
     * @param modelConfig - Embedding model configuration
     * @param indexType - Type of index (default: 'Flat')
     * @returns The file path of the created vector index
     */
    async createDocumentIndex(documentId: number, modelConfig: EmbeddingModelConfig, indexType: string = 'Flat'): Promise<string|undefined|null> {
        try {
            this.currentModel = modelConfig;
            
            // Get pooled instance for this document and model
            const pooledInstance = this.getPooledDocumentInstance(documentId, modelConfig);
            
            const vectorDbConfig: VectorDatabaseConfig = {
                indexPath: this.indexPath,
                modelName: modelConfig.name,
                dimensions: modelConfig.dimensions,
                indexType,
                documentId: documentId
            };

            const indexFilePath = await pooledInstance.createIndex(vectorDbConfig);
            console.log(`Created document-specific ${indexType} index for document ${documentId} with model ${modelConfig.name} (using pool) at ${indexFilePath}`);
            
            return indexFilePath;
        } catch (error) {
            console.error(`Failed to create document-specific index for document ${documentId}:`, error);
            throw new Error(`Failed to create document-specific index for document ${documentId}`);
        }
    }

    /**
     * Create a document-specific index at a specific path using pooled instance
     * @param indexPath - Full path where the index should be created
     * @param documentId - Document ID
     * @param modelConfig - Embedding model configuration
     * @param indexType - Type of index (default: 'Flat')
     * @returns The file path of the created vector index
     */
    async createDocumentIndexByPath(indexPath: string, documentId: number, modelConfig: EmbeddingModelConfig, indexType: string = 'Flat'): Promise<string> {
        try {
            this.currentModel = modelConfig;
            
            // Ensure the directory exists
            const dir = path.dirname(indexPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Get pooled instance for this document and model
            const pooledInstance = this.getPooledDocumentInstance(documentId, modelConfig);
            
            const vectorDbConfig: VectorDatabaseConfig = {
                indexPath: path.dirname(indexPath),
                modelName: modelConfig.name,
                dimensions: modelConfig.dimensions,
                indexType,
                documentId: documentId,
                documentIndexPath: indexPath
            };

            const indexFilePath = await pooledInstance.createIndex(vectorDbConfig);
            console.log(`Created document-specific ${indexType} index for document ${documentId} with model ${modelConfig.name} at specified path ${indexFilePath}`);
            
            return indexFilePath;
        } catch (error) {
            console.error(`Failed to create document-specific index at path ${indexPath} for document ${documentId}:`, error);
            throw new Error(`Failed to create document-specific index at path ${indexPath} for document ${documentId}`);
        }
    }

    /**
     * Load a document-specific index
     * @param documentId - Document ID
     * @param modelConfig - Embedding model configuration
     */
    async loadDocumentIndex(documentId: number, modelConfig: EmbeddingModelConfig): Promise<void> {
        if (!this.vectorDatabase.isInitialized()) {
            await this.initialize();
        }
        
        try {
            this.currentModel = modelConfig;
            
            const vectorDbConfig: VectorDatabaseConfig = {
                indexPath: this.indexPath,
                modelName: modelConfig.name,
                dimensions: modelConfig.dimensions,
                documentId: documentId,
                documentIndexPath: modelConfig.documentIndexPath
            };

            await this.vectorDatabase.loadIndex(vectorDbConfig);
            
            // Note: sqlite-vec stores chunk_id directly, so no need to rebuild chunk ID mapping
            // Only FAISS needs this workaround
            if (this.databaseType === VectorDatabaseType.FAISS && 
                'rebuildChunkIdMapping' in this.vectorDatabase) {
                await (this.vectorDatabase as any).rebuildChunkIdMapping(this.ragChunkModule, documentId);
            }
            
            console.log(`Loaded document-specific index for document ${documentId} with model ${modelConfig.name}`);
        } catch (error) {
            console.error(`Failed to load document-specific index for document ${documentId}:`, error);
            throw new Error(`Failed to load document-specific index for document ${documentId}`);
        }
    }

    /**
     * Delete a document-specific index using pooled instance
     * @param documentId - Document ID
     */
    async deleteDocumentIndex(documentId: number): Promise<void> {
        try {
            if (this.currentModel) {
                // Get pooled instance to delete the index
                const pooledInstance = this.getPooledDocumentInstance(documentId, this.currentModel);
                await pooledInstance.deleteDocumentIndex(documentId);
                
                // Clear the pooled instance after deletion
                const key = this.getInstanceKey(this.currentModel, documentId);
                await VectorDatabasePool.clearInstance(key);
                
                console.log(`Deleted document-specific index for document ${documentId} (cleared from pool)`);
            } else {
                // Fallback to current instance if no model is set
                await this.vectorDatabase.deleteDocumentIndex(documentId);
                console.log(`Deleted document-specific index for document ${documentId} (fallback)`);
            }
        } catch (error) {
            console.error(`Failed to delete document-specific index for document ${documentId}:`, error);
            throw new Error(`Failed to delete document-specific index for document ${documentId}`);
        }
    }

    /**
     * Check if a document-specific index exists
     * @param documentId - Document ID
     * @param modelConfig - Embedding model configuration
     * @returns True if document-specific index exists
     */
    documentIndexExists(documentId: number, modelConfig: EmbeddingModelConfig): boolean {
        return this.vectorDatabase.documentIndexExists(documentId);
    }

    /**
     * Search within a specific document's index
     * @param queryVector - Query vector
     * @param documentId - Document ID to search within
     * @param k - Number of results to return
     * @returns Search results with indices, distances, and chunkIds
     */
    async searchDocument(queryVector: number[], documentId: number, k: number = 10): Promise<{
        indices: number[];
        distances: number[];
        chunkIds: number[];
    }> {
        if (!this.vectorDatabase.isInitialized()) {
            throw new Error('Vector database not initialized');
        }

        // Load the document-specific index for searching
        if (this.currentModel) {
            await this.loadDocumentIndex(documentId, this.currentModel);
        } else {
            throw new Error('No current model configured for document search');
        }

        return await this.search(queryVector, k);
    }

    /**
     * Get pool statistics
     * @returns Pool statistics
     */
    getPoolStats(): any {
        return {
            poolSize: VectorDatabasePool.getPoolSize(),
            instanceKeys: VectorDatabasePool.getInstanceKeys(),
            currentModel: this.currentModel,
            databaseType: this.databaseType
        };
    }

    /**
     * Clear all pooled instances
     */
    async clearPool(): Promise<void> {
        await VectorDatabasePool.clearAllInstances();
        console.log('Cleared all vector database pool instances');
    }

    /**
     * Get the file path for a document-specific vector index
     * @param documentId - Document ID
     * @param modelConfig - Embedding model configuration
     * @returns The file path of the vector index
     */
    getDocumentIndexPath(documentId: number, modelConfig: EmbeddingModelConfig): string {
        const baseDir = path.dirname(this.indexPath);
        const fileName = `index_doc_${documentId}_${modelConfig.name}_${modelConfig.dimensions}.${this.getFileExtension()}`;
        return path.join(baseDir, 'documents', fileName);
    }

    /**
     * Check if an index exists at a specific path
     * @param indexPath - Full path to the index file
     * @returns True if the index file exists
     */
    private checkIndexExistsByPath(indexPath: string): boolean {
        return fs.existsSync(indexPath);
    }
}

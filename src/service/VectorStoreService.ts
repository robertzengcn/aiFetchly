import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { SqliteDb } from '@/config/SqliteDb';
import * as fs from 'fs';
import * as path from 'path';

/**
 * FAISS index interface for type safety
 */
interface FAISSIndex {
    add(vectors: number[][]): void;
    search(queryVector: number[], k: number): { indices: number[], distances: number[] };
    save(path: string): void;
    load(path: string): void;
    getDimension(): number;
    getTotalVectors(): number;
    reset(): void;
}

/**
 * Vector store service for managing FAISS indices
 */
export class VectorStoreService {
    private db: SqliteDb;
    private faiss: any = null;
    private index: FAISSIndex | null = null;
    private indexPath: string;
    private dimension: number = 0;
    private isInitialized: boolean = false;

    constructor(db: SqliteDb, indexPath?: string) {
        this.db = db;
        this.indexPath = indexPath || path.join(process.cwd(), 'data', 'vector_index');
        this.ensureIndexDirectory();
    }

    /**
     * Initialize the vector store service
     */
    async initialize(): Promise<void> {
        try {
            // Dynamic import to avoid bundling issues
            this.faiss = await import('faiss-node') as any;
            this.isInitialized = true;
            console.log('FAISS initialized successfully');
        } catch (error) {
            console.error('Failed to initialize FAISS:', error);
            throw new Error('Failed to initialize FAISS. Please ensure faiss-node is installed.');
        }
    }

    /**
     * Create a new FAISS index
     * @param dimension - Vector dimension
     * @param indexType - Type of index (default: 'Flat')
     */
    async createIndex(dimension: number, indexType: string = 'Flat'): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            this.dimension = dimension;
            
            switch (indexType.toLowerCase()) {
                case 'flat':
                    this.index = new this.faiss.IndexFlatL2(dimension);
                    break;
                case 'ivf':
                    // IVF index requires training data, using Flat for now
                    this.index = new this.faiss.IndexFlatL2(dimension);
                    break;
                case 'hnsw':
                    // HNSW index for better performance
                    this.index = new this.faiss.IndexHNSWFlat(dimension, 32);
                    break;
                default:
                    this.index = new this.faiss.IndexFlatL2(dimension);
            }

            console.log(`Created ${indexType} index with dimension ${dimension}`);
        } catch (error) {
            console.error('Failed to create FAISS index:', error);
            throw new Error('Failed to create FAISS index');
        }
    }

    /**
     * Load existing index from disk
     * @param dimension - Expected vector dimension
     */
    async loadIndex(dimension: number): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            if (fs.existsSync(this.indexPath)) {
                this.index = this.faiss.IndexFlatL2.load(this.indexPath);
                this.dimension = dimension;
                console.log(`Loaded existing index with ${this.index?.getTotalVectors() || 0} vectors`);
            } else {
                console.log('No existing index found, creating new one');
                await this.createIndex(dimension);
            }
        } catch (error) {
            console.error('Failed to load FAISS index:', error);
            throw new Error('Failed to load FAISS index');
        }
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
     * Store a single embedding
     * @param embeddingData - Embedding data to store
     */
    async storeEmbedding(embeddingData: {
        chunkId: number;
        documentId: number;
        content: string;
        embedding: number[];
        metadata?: any;
    }): Promise<void> {
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

            // Update chunk entities with embedding IDs
            const repository = this.db.connection.getRepository(RAGChunkEntity);
            const startIndex = this.index.getTotalVectors() - vectors.length;

            for (let i = 0; i < chunkIds.length; i++) {
                const embeddingId = (startIndex + i).toString();
                await repository.update(
                    { id: chunkIds[i] },
                    { 
                        embeddingId,
                        vectorDimensions: this.dimension
                    }
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
            
            // Get chunk IDs for the results
            const repository = this.db.connection.getRepository(RAGChunkEntity);
            const chunkIds: number[] = [];

            for (const index of results.indices) {
                const chunk = await repository.findOne({
                    where: { embeddingId: index.toString() }
                });
                if (chunk) {
                    chunkIds.push(chunk.id);
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
    } {
        return {
            totalVectors: this.index?.getTotalVectors() || 0,
            dimension: this.dimension,
            indexType: this.index?.constructor.name || 'Unknown',
            isInitialized: this.isInitialized
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

            this.index = this.faiss.IndexFlatL2.load(backupPath);
            this.dimension = this.index?.getDimension() || 0;
            console.log(`Index restored from ${backupPath}`);
        } catch (error) {
            console.error('Failed to restore index:', error);
            throw new Error('Failed to restore index');
        }
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
}

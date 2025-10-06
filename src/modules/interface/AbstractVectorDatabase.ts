import * as fs from 'fs';
import * as path from 'path';
import { IVectorDatabase, VectorDatabaseConfig, IndexStats } from '@/modules/interface/IVectorDatabase';

/**
 * Abstract base class for vector database implementations
 * Provides common functionality that can be shared across implementations
 */
export abstract class AbstractVectorDatabase implements IVectorDatabase {
    protected config: VectorDatabaseConfig | null = null;
    protected initialized: boolean = false;
    protected indexPath: string = '';
    protected dimension: number = 0;

    constructor(protected baseIndexPath?: string) {
        this.indexPath = baseIndexPath || path.join(process.cwd(), 'data', 'vector_index');
    }

    /**
     * Initialize the vector database (to be implemented by subclasses)
     */
    abstract initialize(): Promise<void>;

    /**
     * Create a new index (to be implemented by subclasses)
     */
    abstract createIndex(config: VectorDatabaseConfig): Promise<void>;

    /**
     * Load an existing index (to be implemented by subclasses)
     */
    abstract loadIndex(config: VectorDatabaseConfig): Promise<void>;

    /**
     * Save the index (to be implemented by subclasses)
     */
    abstract saveIndex(): Promise<void>;

    /**
     * Add vectors to the index (to be implemented by subclasses)
     */
    abstract addVectors(vectors: number[][]): Promise<void>;

    /**
     * Search for similar vectors (to be implemented by subclasses)
     */
    abstract search(queryVector: number[], k: number): Promise<{ indices: number[]; distances: number[]; }>;

    /**
     * Get index statistics (to be implemented by subclasses)
     */
    abstract getIndexStats(): IndexStats;

    /**
     * Reset the index (to be implemented by subclasses)
     */
    abstract resetIndex(): Promise<void>;

    /**
     * Optimize the index (to be implemented by subclasses)
     */
    abstract optimizeIndex(): Promise<void>;

    /**
     * Backup the index (to be implemented by subclasses)
     */
    abstract backupIndex(backupPath: string): Promise<void>;

    /**
     * Restore index from backup (to be implemented by subclasses)
     */
    abstract restoreIndex(backupPath: string): Promise<void>;

    /**
     * Check if index exists (common implementation)
     */
    indexExists(): boolean {
        return fs.existsSync(this.indexPath);
    }

    /**
     * Get index file size (common implementation)
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
     * Check if the database is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Clean up resources (to be implemented by subclasses)
     */
    abstract cleanup(): Promise<void>;

    /**
     * Generate model-specific index path
     */
    protected getModelSpecificIndexPath(config: VectorDatabaseConfig): string {
        const baseDir = path.dirname(this.indexPath);
        const fileName = `index_${config.modelId}_${config.dimensions}.${this.getFileExtension()}`;
        return path.join(baseDir, 'models', fileName);
    }

    /**
     * Ensure index directory exists
     */
    protected ensureIndexDirectory(): void {
        const dir = path.dirname(this.indexPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Get file extension for the specific database type
     * Override in subclasses for database-specific extensions
     */
    protected getFileExtension(): string {
        return 'index';
    }

    /**
     * Validate vector dimensions
     */
    protected validateDimensions(vector: number[], expectedDimension: number): void {
        if (vector.length !== expectedDimension) {
            throw new Error(`Vector dimension ${vector.length} does not match expected dimension ${expectedDimension}`);
        }
    }

    /**
     * Validate configuration
     */
    protected validateConfig(config: VectorDatabaseConfig): void {
        if (!config.modelId || !config.dimensions) {
            throw new Error('Model ID and dimensions are required');
        }
        if (config.dimensions <= 0) {
            throw new Error('Dimensions must be greater than 0');
        }
    }
}

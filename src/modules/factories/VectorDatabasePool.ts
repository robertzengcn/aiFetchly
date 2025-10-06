import { IVectorDatabase } from '@/modules/interface/IVectorDatabase';
import { VectorDatabaseFactory, VectorDatabaseFactoryConfig, VectorDatabaseType } from './VectorDatabaseFactory';
import { EmbeddingModelConfig } from '@/service/VectorStoreService';

/**
 * Poolable interface for vector database instances
 */
interface PoolableVectorDatabase extends IVectorDatabase {
    reset(): void;
}

/**
 * Lightweight instance pool for vector databases
 * Manages instances based on unique keys to avoid redundant creation
 */
export class VectorDatabasePool {
    private static instances = new Map<string, PoolableVectorDatabase>();
    private static readonly MAX_POOL_SIZE = 20; // Maximum number of instances to keep

    /**
     * Get or create a vector database instance
     * @param key - Unique identifier for the instance
     * @param config - Vector database configuration
     * @returns Vector database instance
     */
    static getInstance(key: string, config: VectorDatabaseFactoryConfig): IVectorDatabase {
        if (!this.instances.has(key)) {
            if (this.instances.size >= this.MAX_POOL_SIZE) {
                // Remove oldest instance if pool is full
                const oldestKey = this.instances.keys().next().value;
                if (oldestKey) {
                    this.clearInstanceSync(oldestKey);
                }
            }

            const instance = VectorDatabaseFactory.createDatabase(config);
            const poolableInstance = instance as PoolableVectorDatabase;
            
            // Add reset method if not present
            if (!poolableInstance.reset) {
                poolableInstance.reset = () => {
                    // Reset instance state if needed
                    console.log(`Resetting vector database instance: ${key}`);
                };
            }

            this.instances.set(key, poolableInstance);
            console.log(`Created new vector database instance with key: ${key} (Pool size: ${this.instances.size})`);
        }
        return this.instances.get(key)!;
    }

    /**
     * Remove and cleanup a specific instance
     * @param key - Key of the instance to remove
     */
    static async clearInstance(key: string): Promise<void> {
        const instance = this.instances.get(key);
        if (instance) {
            try {
                await instance.cleanup();
            } catch (error) {
                console.warn(`Error cleaning up instance ${key}:`, error);
            }
            this.instances.delete(key);
            console.log(`Cleaned up vector database instance with key: ${key} (Pool size: ${this.instances.size})`);
        }
    }

    /**
     * Synchronous version of clearInstance for internal use
     */
    private static clearInstanceSync(key: string): void {
        const instance = this.instances.get(key);
        if (instance) {
            // Don't await cleanup in sync method
            instance.cleanup().catch(error => 
                console.warn(`Error cleaning up instance ${key}:`, error)
            );
            this.instances.delete(key);
        }
    }

    /**
     * Clear all instances
     */
    static async clearAllInstances(): Promise<void> {
        const cleanupPromises = Array.from(this.instances.entries()).map(async ([key, instance]) => {
            try {
                await instance.cleanup();
                console.log(`Cleaned up instance: ${key}`);
            } catch (error) {
                console.warn(`Error cleaning up instance ${key}:`, error);
            }
        });
        
        await Promise.all(cleanupPromises);
        this.instances.clear();
        console.log('Cleared all vector database instances');
    }

    /**
     * Get current pool size
     */
    static getPoolSize(): number {
        return this.instances.size;
    }

    /**
     * Check if instance exists
     */
    static hasInstance(key: string): boolean {
        return this.instances.has(key);
    }

    /**
     * Get all instance keys
     */
    static getInstanceKeys(): string[] {
        return Array.from(this.instances.keys());
    }

    /**
     * Reset an instance to its initial state
     * @param key - Key of the instance to reset
     */
    static resetInstance(key: string): void {
        const instance = this.instances.get(key);
        if (instance && instance.reset) {
            instance.reset();
            console.log(`Reset vector database instance: ${key}`);
        }
    }
}

/**
 * Key generation utilities for different use cases
 */
export class VectorDatabaseKeyGenerator {
    /**
     * Generate key for document-specific index
     * @param documentId - Document ID
     * @param modelConfig - Model configuration
     * @param basePath - Base index path
     * @returns Unique key for document-specific index
     */
    static generateDocumentKey(
        documentId: number, 
        modelConfig: EmbeddingModelConfig, 
        basePath?: string
    ): string {
        const pathHash = basePath ? this.hashPath(basePath) : 'default';
        return `doc_${documentId}_${modelConfig.modelId}_${modelConfig.dimensions}_${pathHash}`;
    }

    /**
     * Generate key for model-specific index
     * @param modelConfig - Model configuration
     * @param basePath - Base index path
     * @returns Unique key for model-specific index
     */
    static generateModelKey(
        modelConfig: EmbeddingModelConfig, 
        basePath?: string
    ): string {
        const pathHash = basePath ? this.hashPath(basePath) : 'default';
        return `model_${modelConfig.modelId}_${modelConfig.dimensions}_${pathHash}`;
    }

    /**
     * Generate key for global index
     * @param basePath - Base index path
     * @param databaseType - Database type
     * @returns Unique key for global index
     */
    static generateGlobalKey(basePath: string, databaseType: VectorDatabaseType): string {
        const pathHash = this.hashPath(basePath);
        return `global_${databaseType}_${pathHash}`;
    }

    /**
     * Generate key for custom use cases
     * @param prefix - Key prefix
     * @param params - Additional parameters
     * @returns Custom key
     */
    static generateCustomKey(prefix: string, ...params: (string | number)[]): string {
        const paramStr = params.join('_');
        return `${prefix}_${paramStr}`;
    }

    /**
     * Hash path to create a shorter, filesystem-safe identifier
     * @param path - File path
     * @returns Hashed path
     */
    private static hashPath(path: string): string {
        // Simple hash function for path
        let hash = 0;
        const str = path.replace(/[^a-zA-Z0-9]/g, '_');
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }
}

/**
 * Pool statistics interface
 */
export interface PoolStats {
    totalInstances: number;
    maxPoolSize: number;
    instanceKeys: string[];
    memoryUsage?: number; // Optional memory usage estimation
}

/**
 * Pool statistics utility
 */
export class VectorDatabasePoolStats {
    /**
     * Get current pool statistics
     */
    static getStats(): PoolStats {
        return {
            totalInstances: VectorDatabasePool.getPoolSize(),
            maxPoolSize: 20, // Should match MAX_POOL_SIZE
            instanceKeys: VectorDatabasePool.getInstanceKeys()
        };
    }

    /**
     * Log pool statistics
     */
    static logStats(): void {
        const stats = this.getStats();
        console.log('Vector Database Pool Statistics:');
        console.log(`  Total Instances: ${stats.totalInstances}/${stats.maxPoolSize}`);
        console.log(`  Instance Keys: ${stats.instanceKeys.join(', ')}`);
    }
}

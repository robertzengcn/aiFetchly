import { IVectorDatabase } from '@/modules/interface/IVectorDatabase';
// import { FaissVectorDatabase } from '@/modules/adapters/FaissVectorDatabase';
import { SqliteVecDatabase } from '@/modules/adapters/SqliteVecDatabase';

/**
 * Supported vector database types
 */
export enum VectorDatabaseType {
    FAISS = 'faiss',
    SQLITE_VEC = 'sqlite-vec',
    // Add more types as you implement them
    // CHROMA = 'chroma',
    // PINECONE = 'pinecone',
    // WEAVIATE = 'weaviate',
    // QDRANT = 'qdrant',
    // MILVUS = 'milvus'
}

/**
 * Vector database factory configuration
 */
export interface VectorDatabaseFactoryConfig {
    type: VectorDatabaseType;
    baseIndexPath?: string;
    // Add database-specific configuration here
    faissConfig?: {
        // FAISS-specific options
    };
    sqliteVecConfig?: {
        // SQLite-vec specific options
        // e.g., extension path, etc.
    };
    // chromaConfig?: ChromaConfig;
    // pineconeConfig?: PineconeConfig;
    // etc.
}

/**
 * Vector database factory for creating different vector database implementations
 * Uses Factory pattern to create the appropriate vector database instance
 */
export class VectorDatabaseFactory {
    /**
     * Create a vector database instance based on the configuration
     */
    static createDatabase(config: VectorDatabaseFactoryConfig): IVectorDatabase {
        switch (config.type) {
            // case VectorDatabaseType.FAISS:
            //     return new FaissVectorDatabase(config.baseIndexPath);
            
            case VectorDatabaseType.SQLITE_VEC:
                return new SqliteVecDatabase(config.baseIndexPath);
            
            // Add cases for other database types as needed
            // case VectorDatabaseType.CHROMA:
            //     return new ChromaVectorDatabase(config.baseIndexPath);
            // case VectorDatabaseType.PINECONE:
            //     return new PineconeVectorDatabase(config.baseIndexPath);
            // case VectorDatabaseType.WEAVIATE:
            //     return new WeaviateVectorDatabase(config.weaviateConfig);
            // case VectorDatabaseType.QDRANT:
            //     return new QdrantVectorDatabase(config.qdrantConfig);
            // case VectorDatabaseType.MILVUS:
            //     return new MilvusVectorDatabase(config.milvusConfig);
            
            default:
                throw new Error(`Unsupported vector database type: ${config.type}`);
        }
    }

    /**
     * Get all supported vector database types
     */
    static getSupportedTypes(): VectorDatabaseType[] {
        return Object.values(VectorDatabaseType);
    }

    /**
     * Check if a vector database type is supported
     */
    static isSupported(type: string): type is VectorDatabaseType {
        return Object.values(VectorDatabaseType).includes(type as VectorDatabaseType);
    }

    /**
     * Create a FAISS database instance (convenience method)
     * @deprecated Use createSqliteVecDatabase instead for better compatibility
     */
    // static createFaissDatabase(baseIndexPath?: string): IVectorDatabase {
    //     return new FaissVectorDatabase(baseIndexPath);
    // }

    /**
     * Create a SQLite-vec database instance (convenience method)
     */
    static createSqliteVecDatabase(baseIndexPath?: string): IVectorDatabase {
        return new SqliteVecDatabase(baseIndexPath);
    }

    /**
     * Create a Chroma database instance (convenience method)
     * @deprecated Chroma support removed
     */
    static createChromaDatabase(baseIndexPath?: string): IVectorDatabase {
        throw new Error('Chroma support has been removed');
    }

    /**
     * Create a Pinecone database instance (convenience method)
     * @deprecated Pinecone support removed
     */
    static createPineconeDatabase(baseIndexPath?: string): IVectorDatabase {
        throw new Error('Pinecone support has been removed');
    }

    /**
     * Create database from environment variables or configuration
     * This allows for easy configuration switching
     */
    static createFromConfig(): IVectorDatabase {
        // Default to sqlite-vec for better compatibility
        const dbType = process.env.VECTOR_DB_TYPE || VectorDatabaseType.SQLITE_VEC;
        const baseIndexPath = process.env.VECTOR_DB_PATH;

        if (!this.isSupported(dbType)) {
            console.warn(`Unsupported vector database type: ${dbType}, falling back to sqlite-vec`);
            return this.createSqliteVecDatabase(baseIndexPath);
        }

        return this.createDatabase({
            type: dbType as VectorDatabaseType,
            baseIndexPath
        });
    }
}

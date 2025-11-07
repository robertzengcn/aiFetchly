/**
 * Metadata type definitions for document processing and vector search
 */

// Base metadata interface for document uploads
export interface DocumentMetadata {
    title?: string;
    description?: string;
    // model_name:string;
    tags?: string[];
    author?: string;
}

// Metadata for vector search results
export interface VectorSearchMetadata {
    chunkIndex: number;
    startPosition?: number;
    endPosition?: number;
    pageNumber?: number;
}

// Metadata for document processing
export interface DocumentProcessingMetadata {
    documentId: number;
    fileName: string;
    fileType: string;
    fileSize?: number;
    uploadDate?: string;
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    chunkCount?: number;
    embeddingCount?: number;
    processingTime?: number;
}

// Metadata for configuration responses
export interface ConfigurationMetadata {
    version: string;
    lastUpdated: string;
    ttl: number;
    autoSelected: boolean;
    selectionReason?: string;
}

// Metadata for chunk and embed operations
export interface ChunkEmbedMetadata {
    documentId: number;
    chunksCreated: number;
    embeddingsGenerated: number;
    processingTime: number;
    success: boolean;
    steps: {
        chunking: boolean;
        embedding: boolean;
    };
    chunkingResult?: {
        chunksCreated: number;
        processingTime: number;
        message: string;
    };
    embeddingResult?: {
        chunksProcessed: number;
        processingTime: number;
        message: string;
    };
}

// Metadata for file upload operations
export interface FileUploadMetadata {
    originalName: string;
    tempPath: string;
    mimeType?: string;
    size: number;
    uploadedAt: string;
    uploadedBy?: string;
}

// Metadata for search operations
export interface SearchMetadata {
    query: string;
    filters?: {
        documentTypes?: string[];
        dateRange?: {
            start: Date;
            end: Date;
        };
        tags?: string[];
        authors?: string[];
    };
    resultsCount: number;
    searchTime: number;
    vectorSimilarity?: number;
}

// Metadata for document updates
export interface DocumentUpdateMetadata {
    id: number;
    updatedFields: string[];
    updatedAt: string;
    updatedBy?: string;
    previousValues?: Record<string, any>;
}

// Union type for all metadata types
export type Metadata = 
    | DocumentMetadata
    | VectorSearchMetadata
    | DocumentProcessingMetadata
    | ConfigurationMetadata
    | ChunkEmbedMetadata
    | FileUploadMetadata
    | SearchMetadata
    | DocumentUpdateMetadata;

// Generic metadata wrapper
export interface MetadataWrapper<T extends Metadata> {
    type: string;
    data: T;
    timestamp: string;
    version?: string;
}

// Helper type for metadata with optional fields
export type OptionalMetadata<T extends Metadata> = Partial<T> & Pick<T, keyof T>;

// Metadata validation result
export interface MetadataValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

// Metadata factory function type
export type MetadataFactory<T extends Metadata> = (data: Partial<T>) => T;

# Metadata Types Documentation

This directory contains comprehensive type definitions for metadata used throughout the application, particularly in document processing, vector search, and RAG (Retrieval-Augmented Generation) operations.

## Files

- `metadataType.ts` - Core metadata type definitions
- `metadataUsageExample.ts` - Usage examples and utility functions
- `commonType.ts` - Re-exports metadata types for convenience

## Core Metadata Types

### 1. DocumentMetadata
Used for document uploads and basic document information.

```typescript
interface DocumentMetadata {
    title?: string;
    description?: string;
    tags?: string[];
    author?: string;
}
```

### 2. VectorSearchMetadata
Used for vector search results and chunk information.

```typescript
interface VectorSearchMetadata {
    chunkIndex: number;
    startPosition?: number;
    endPosition?: number;
    pageNumber?: number;
}
```

### 3. DocumentProcessingMetadata
Used for tracking document processing status and results.

```typescript
interface DocumentProcessingMetadata {
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
```

### 4. ConfigurationMetadata
Used for configuration responses and system settings.

```typescript
interface ConfigurationMetadata {
    version: string;
    lastUpdated: string;
    ttl: number;
    autoSelected: boolean;
    selectionReason?: string;
}
```

### 5. ChunkEmbedMetadata
Used for chunking and embedding operations.

```typescript
interface ChunkEmbedMetadata {
    documentId: number;
    chunksCreated: number;
    embeddingsGenerated: number;
    processingTime: number;
    success: boolean;
    steps: {
        chunking: boolean;
        embedding: boolean;
    };
    // ... additional properties
}
```

## Usage Examples

### Basic Document Upload

```typescript
import { DocumentMetadata, createDocumentUploadMetadata } from '@/entityTypes';

// Create metadata for document upload
const metadata: DocumentMetadata = createDocumentUploadMetadata(
    'My Document',
    'A sample document for testing',
    ['test', 'sample'],
    'John Doe'
);
```

### Vector Search Results

```typescript
import { VectorSearchMetadata, createVectorSearchMetadata } from '@/entityTypes';

// Create metadata for search results
const searchMetadata: VectorSearchMetadata = createVectorSearchMetadata(
    0, // chunkIndex
    100, // startPosition
    200, // endPosition
    1 // pageNumber
);
```

### Document Processing

```typescript
import { DocumentProcessingMetadata, createDocumentProcessingMetadata } from '@/entityTypes';

// Create metadata for document processing
const processingMetadata: DocumentProcessingMetadata = createDocumentProcessingMetadata(
    123, // documentId
    'document.pdf', // fileName
    'pdf', // fileType
    1024000 // fileSize
);
```

## Utility Functions

### Type Guards

```typescript
import { isDocumentMetadata, isVectorSearchMetadata } from '@/entityTypes';

// Runtime type checking
if (isDocumentMetadata(someData)) {
    // someData is now typed as DocumentMetadata
    console.log(someData.title);
}
```

### Validation

```typescript
import { validateDocumentMetadata } from '@/entityTypes';

const validation = validateDocumentMetadata(metadata);
if (!validation.isValid) {
    console.error('Validation errors:', validation.errors);
}
```

### Merging and Sanitization

```typescript
import { mergeDocumentMetadata, sanitizeDocumentMetadata } from '@/entityTypes';

// Merge metadata
const merged = mergeDocumentMetadata(baseMetadata, updates);

// Sanitize metadata
const sanitized = sanitizeDocumentMetadata(userInput);
```

## Integration with Existing Code

### In Vue Components

```typescript
// In a Vue component
import { DocumentMetadata, createDocumentUploadMetadata } from '@/entityTypes';

export default {
    data() {
        return {
            uploadMetadata: createDocumentUploadMetadata('New Document')
        };
    },
    methods: {
        updateMetadata(updates: Partial<DocumentMetadata>) {
            this.uploadMetadata = { ...this.uploadMetadata, ...updates };
        }
    }
};
```

### In API Calls

```typescript
// In API service
import { DocumentMetadata, FileUploadMetadata } from '@/entityTypes';

async function uploadDocument(file: File, metadata: DocumentMetadata) {
    const uploadMetadata: FileUploadMetadata = {
        originalName: file.name,
        tempPath: '/tmp/upload',
        size: file.size,
        uploadedAt: new Date().toISOString()
    };
    
    // Use metadata in API call
    return await api.upload(file, { ...metadata, ...uploadMetadata });
}
```

## Best Practices

1. **Always use type guards** for runtime validation when receiving metadata from external sources
2. **Validate metadata** before processing to ensure data integrity
3. **Use utility functions** for common operations like merging and sanitization
4. **Prefer specific types** over generic `any` type for better type safety
5. **Document metadata structure** in your API responses and database schemas

## Migration Guide

If you're updating existing code to use these types:

1. Replace `any` types with specific metadata types
2. Use the provided utility functions for common operations
3. Add validation where metadata comes from external sources
4. Update API interfaces to use the new types

## Type Safety

All metadata types are designed to be:
- **Strictly typed** - No `any` types in the core definitions
- **Optional where appropriate** - Non-essential fields are optional
- **Extensible** - Easy to add new fields without breaking existing code
- **Validated** - Include validation utilities for runtime safety

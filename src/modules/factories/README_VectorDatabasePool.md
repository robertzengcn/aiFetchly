# Vector Database Pool Implementation

## Overview

The Vector Database Pool is a lightweight instance pool that manages vector database instances to improve performance and resource utilization. It provides efficient reuse of instances while maintaining document-specific isolation.

## Key Features

- **Instance Reuse**: Avoids redundant creation of vector database instances
- **Document Isolation**: Each document gets its own pooled instance
- **Model Support**: Different embedding models can coexist
- **Automatic Cleanup**: Instances are cleaned up when no longer needed
- **Pool Management**: Built-in statistics and management utilities

## Usage

### Basic Usage

```typescript
import { VectorDatabasePool, VectorDatabaseKeyGenerator } from '@/modules/factories/VectorDatabasePool';

// Generate key for document-specific index
const documentId = 123;
const modelConfig = { modelId: 'text-embedding-3-small', dimensions: 1536 };
const key = VectorDatabaseKeyGenerator.generateDocumentKey(documentId, modelConfig);

// Get pooled instance
const vectorDb = VectorDatabasePool.getInstance(key, {
    type: VectorDatabaseType.FAISS,
    baseIndexPath: '/path/to/indexes'
});

// Use the instance
await vectorDb.initialize();
```

### Key Generation

The pool uses unique keys to identify instances:

- **Document Key**: `doc_{documentId}_{modelId}_{dimensions}_{pathHash}`
- **Model Key**: `model_{modelId}_{dimensions}_{pathHash}`
- **Global Key**: `global_{databaseType}_{pathHash}`
- **Custom Key**: `{prefix}_{param1}_{param2}_...`

### Pool Management

```typescript
// Get pool statistics
const stats = VectorDatabasePoolStats.getStats();

// Clear specific instance
await VectorDatabasePool.clearInstance(key);

// Clear all instances
await VectorDatabasePool.clearAllInstances();
```

## Integration with VectorStoreService

The `VectorStoreService` has been updated to automatically use the pool:

```typescript
// Document-specific operations automatically use pooled instances
await vectorStoreService.createDocumentIndex(documentId, modelConfig);
await vectorStoreService.storeEmbedding(embeddingData);
await vectorStoreService.deleteDocumentIndex(documentId);

// Get pool statistics
const poolStats = vectorStoreService.getPoolStats();
```

## Benefits

1. **Performance**: Reuses existing instances instead of creating new ones
2. **Memory Efficiency**: Automatic cleanup prevents memory leaks
3. **Scalability**: Handles multiple documents and models efficiently
4. **Isolation**: Each document maintains its own index instance
5. **Flexibility**: Supports custom key generation for special use cases

## Configuration

- **Max Pool Size**: 20 instances (configurable)
- **Automatic Cleanup**: Oldest instances are removed when pool is full
- **Path Hashing**: File paths are hashed for shorter, safer keys

## Example

See `src/examples/VectorDatabasePoolExample.ts` for comprehensive usage examples.

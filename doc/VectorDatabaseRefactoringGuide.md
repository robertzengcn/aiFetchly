# Vector Database Refactoring Guide

## Overview

This guide explains the refactoring of the `VectorStoreService` to use design patterns that allow easy switching between different vector databases (FAISS, Chroma, Pinecone, etc.).

## Design Patterns Used

### 1. Strategy Pattern
The Strategy pattern is used to encapsulate different vector database algorithms and make them interchangeable at runtime.

- **Interface**: `IVectorDatabase` defines the contract for all vector database implementations
- **Concrete Strategies**: `FaissVectorDatabase` (with support for adding more databases)
- **Context**: `VectorStoreService` uses the strategy without knowing the specific implementation

### 2. Factory Pattern
The Factory pattern is used to create vector database instances based on configuration.

- **Factory**: `VectorDatabaseFactory` creates the appropriate vector database instance
- **Product**: Different vector database implementations
- **Client**: `VectorStoreService` requests database instances from the factory

### 3. Abstract Base Class
The Abstract Base Class pattern provides common functionality while requiring specific implementations.

- **Abstract Class**: `AbstractVectorDatabase` provides shared functionality
- **Concrete Classes**: Extend the abstract class with database-specific implementations

## Architecture

```
VectorStoreService
    ↓ (uses)
IVectorDatabase (interface)
    ↑ (implements)
AbstractVectorDatabase (abstract base)
    ↑ (extends)
FaissVectorDatabase
    ↑ (created by)
VectorDatabaseFactory
```

## Benefits

1. **Easy Database Switching**: Change vector databases by changing a single parameter
2. **Consistent API**: All databases use the same interface
3. **Extensibility**: Add new databases by implementing the interface
4. **Maintainability**: Database-specific logic is isolated
5. **Testability**: Easy to mock and test different implementations

## Usage Examples

### Basic Usage

```typescript
import { VectorStoreService } from '@/service/VectorStoreService';
import { VectorDatabaseType } from '@/factories/VectorDatabaseFactory';
import { SqliteDb } from '@/config/SqliteDb';

// Create service with FAISS (default)
const db = new SqliteDb();
const vectorService = new VectorStoreService(db);

// Or specify the database type
const vectorService = new VectorStoreService(
    db, 
    './data/vector_index',
    VectorDatabaseType.FAISS
);
```

### Switching Between Different Models

```typescript
// Start with FAISS and first model
await vectorService.initialize();
await vectorService.createIndex(modelConfig1);

// Switch to different model configuration
await vectorService.switchModel(modelConfig2);

// Create index with different index type
await vectorService.createIndex(modelConfig3, 'HNSW');
```

### Environment-Based Configuration

```typescript
// Set environment variables
process.env.VECTOR_DB_TYPE = 'faiss';
process.env.VECTOR_DB_PATH = './data/vector_index';

// Create service with environment configuration
const vectorService = new VectorStoreService(
    db,
    process.env.VECTOR_DB_PATH,
    process.env.VECTOR_DB_TYPE as VectorDatabaseType
);
```

## Adding New Vector Databases

To add a new vector database:

1. **Create the adapter class**:
```typescript
export class NewVectorDatabase extends AbstractVectorDatabase {
    async initialize(): Promise<void> {
        // Initialize your database
    }
    
    async createIndex(config: VectorDatabaseConfig): Promise<void> {
        // Create index logic
    }
    
    // Implement all required methods...
}
```

2. **Add to the enum**:
```typescript
export enum VectorDatabaseType {
    FAISS = 'faiss',
    NEW_DATABASE = 'new_database' // Add here
}
```

3. **Update the factory**:
```typescript
static createDatabase(config: VectorDatabaseFactoryConfig): IVectorDatabase {
    switch (config.type) {
        case VectorDatabaseType.FAISS:
            return new FaissVectorDatabase(config.baseIndexPath);
        case VectorDatabaseType.NEW_DATABASE:
            return new NewVectorDatabase(config.baseIndexPath);
        // ...
    }
}
```

## Configuration

### Database-Specific Configuration

Each database can have specific configuration options:

```typescript
interface VectorDatabaseFactoryConfig {
    type: VectorDatabaseType;
    baseIndexPath?: string;
    faissConfig?: {
        // FAISS-specific options
    };
    chromaConfig?: {
        // Chroma-specific options
    };
    pineconeConfig?: {
        apiKey?: string;
        environment?: string;
    };
}
```

### Environment Variables

- `VECTOR_DB_TYPE`: Database type (faiss, chroma, pinecone)
- `VECTOR_DB_PATH`: Base path for index files
- `PINECONE_API_KEY`: Pinecone API key
- `PINECONE_ENVIRONMENT`: Pinecone environment

## Migration Guide

### From Old VectorStoreService

The old `VectorStoreService` API is still supported for backward compatibility:

```typescript
// Old way (still works)
const vectorService = new VectorStoreService(db, './data/vector_index');
await vectorService.createIndexLegacy(1536, 'Flat');

// New way (recommended)
const vectorService = new VectorStoreService(
    db, 
    './data/vector_index',
    VectorDatabaseType.FAISS
);
const modelConfig = {
    modelId: 'text-embedding-ada-002',
    dimensions: 1536,
    name: 'OpenAI Ada 002'
};
await vectorService.createIndex(modelConfig);
```

### Breaking Changes

- Constructor now accepts `VectorDatabaseType` parameter
- Some internal methods have changed, but public API remains the same
- `getIndexStats()` now includes `databaseType` field

## Testing

### Unit Testing

```typescript
import { VectorStoreService } from '@/service/VectorStoreService';
import { VectorDatabaseType } from '@/factories/VectorDatabaseFactory';

describe('VectorStoreService', () => {
    it('should work with FAISS', async () => {
        const service = new VectorStoreService(mockDb, undefined, VectorDatabaseType.FAISS);
        // Test FAISS functionality
    });
    
    it('should work with Chroma', async () => {
        const service = new VectorStoreService(mockDb, undefined, VectorDatabaseType.CHROMA);
        // Test Chroma functionality
    });
});
```

### Integration Testing

```typescript
describe('Vector Database Integration', () => {
    it('should switch between databases seamlessly', async () => {
        const service = new VectorStoreService(mockDb);
        
        // Test with FAISS
        await service.switchDatabase(VectorDatabaseType.FAISS);
        await testBasicOperations(service);
        
        // Test with Chroma
        await service.switchDatabase(VectorDatabaseType.CHROMA);
        await testBasicOperations(service);
    });
});
```

## Performance Considerations

### FAISS
- **Pros**: Fast, memory-efficient, supports various index types (Flat, IVF, HNSW)
- **Cons**: Local storage only, requires manual scaling

### Future Database Support
The architecture is designed to easily add support for other vector databases like:
- **Chroma**: Easy to use, good for development
- **Pinecone**: Managed service, auto-scaling
- **Weaviate**: Open-source vector database
- **Qdrant**: High-performance vector database
- **Milvus**: Scalable vector database

### Choosing the Right Database

- **Development/Testing**: FAISS with different index types
- **Production (Small scale)**: FAISS with proper backup strategy
- **Production (Large scale)**: Add support for managed services as needed
- **Flexible approach**: Use different index types for different use cases

## Troubleshooting

### Common Issues

1. **Database not found**: Ensure the database type is supported and dependencies are installed
2. **Dimension mismatch**: Verify that vector dimensions match the index configuration
3. **Index not found**: Check if the index exists or needs to be created first

### Debug Mode

Enable debug logging:

```typescript
// Set environment variable
process.env.DEBUG = 'vector-database:*';

// Or in code
console.log('Current database type:', vectorService.getDatabaseType());
console.log('Index stats:', vectorService.getIndexStats());
```

## Future Enhancements

1. **More Database Support**: Chroma, Pinecone, Weaviate, Qdrant, Milvus
2. **Enhanced FAISS Support**: More index types, training data support
3. **Auto-Failover**: Automatic switching between databases
4. **Hybrid Search**: Combine multiple databases for better results
5. **Performance Monitoring**: Built-in metrics and monitoring
6. **Configuration Validation**: Validate database-specific configurations

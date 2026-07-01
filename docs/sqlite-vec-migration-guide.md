# SQLite-vec Migration Guide

This guide explains how to migrate from FAISS to SQLite-vec for vector similarity search in the aiFetchly RAG system.

## Overview

The migration from `faiss-node` to `sqlite-vec` provides:
- ✅ Better cross-platform compatibility (no native bindings)
- ✅ Simplified deployment (no electron-rebuild required)
- ✅ Unified storage (uses existing SQLite infrastructure)
- ✅ Easier backup/restore (standard SQLite mechanisms)
- ✅ Transaction support (ACID guarantees)

## Prerequisites

- SQLite-vec extension installed (via `sqlite-vec` npm package)
- Platform-specific extension package installed (e.g., `sqlite-vec-linux-x64`, `sqlite-vec-darwin-x64`)
- Existing FAISS indices (if migrating existing data)
- Access to embedding API (for re-generating embeddings during migration)

## Migration Process

### Automatic Migration

The migration tool automatically detects existing FAISS indices and migrates them to SQLite-vec:

```typescript
import { VectorDatabaseMigrator } from '@/modules/migration/VectorDatabaseMigrator';

const migrator = new VectorDatabaseMigrator(
    baseIndexPath, // Optional: path to vector indices directory
    (progress) => {
        // Progress callback
        console.log(`Progress: ${progress.percentage}% - ${progress.message}`);
    }
);

// Migrate all FAISS indices
const result = await migrator.migrateAll({
    backupPath: './backups/faiss-indices', // Optional: backup FAISS indices
    documentIds: [1, 2, 3], // Optional: migrate specific documents only
    modelName: 'text-embedding-3-small' // Optional: migrate specific model only
});

if (result.success) {
    console.log(`Migration completed: ${result.chunksMigrated} chunks migrated`);
} else {
    console.error('Migration errors:', result.errors);
}
```

### Manual Migration

For more control, you can migrate individual documents:

```typescript
// Migrate a single document
const result = await migrator.migrateDocument(
    documentId: 123,
    modelName: 'text-embedding-3-small',
    dimensions: 1536,
    backupPath: './backups/faiss-indices' // Optional
);
```

### Validation

After migration, validate the migrated data:

```typescript
const validation = await migrator.validateMigration(
    documentId: 123,
    modelName: 'text-embedding-3-small',
    dimensions: 1536
);

if (validation.valid) {
    console.log('Migration validated successfully');
} else {
    console.error('Validation errors:', validation.errors);
}
```

## Important Notes

### Vector Re-generation

**Note**: FAISS doesn't support extracting stored vectors from an index. Therefore, the migration tool **re-generates embeddings** from chunk content stored in the database. This means:

1. **Requires embedding API access**: The migration tool needs access to the embedding API to re-generate vectors
2. **May take time**: Re-generating embeddings for large documents can take significant time
3. **API costs**: If using a paid embedding API, migration will incur API costs

### Chunk ID Mapping

- **FAISS**: Uses an in-memory mapping between vector indices and chunk IDs
- **SQLite-vec**: Stores chunk IDs directly in the database, eliminating the need for mapping

### File Extensions

- **FAISS**: Uses `.index` file extension
- **SQLite-vec**: Uses `.db` file extension

The migration tool automatically handles file extension changes.

## Migration Steps

1. **Backup existing FAISS indices** (optional but recommended):
   ```bash
   cp -r data/vector_index data/vector_index_backup
   ```

2. **Run migration**:
   ```typescript
   const migrator = new VectorDatabaseMigrator();
   const result = await migrator.migrateAll({
       backupPath: './backups/faiss-indices'
   });
   ```

3. **Validate migration**:
   ```typescript
   for (const documentId of migratedDocuments) {
       const validation = await migrator.validateMigration(
           documentId,
           modelName,
           dimensions
       );
       if (!validation.valid) {
           console.error(`Validation failed for document ${documentId}:`, validation.errors);
       }
   }
   ```

4. **Test search functionality**:
   ```typescript
   const vectorStoreService = new VectorStoreService(
       indexPath,
       VectorDatabaseType.SQLITE_VEC
   );
   await vectorStoreService.initialize();
   const results = await vectorStoreService.search(queryVector, 10);
   ```

5. **Verify data integrity**:
   - Check vector counts match chunk counts
   - Verify search results are consistent
   - Test with multiple queries

## Configuration

### Environment Variables

Set the default vector database type:

```bash
export VECTOR_DB_TYPE=sqlite-vec
export VECTOR_DB_PATH=./data/vector_index
```

### Code Configuration

```typescript
import { VectorStoreService } from '@/service/VectorStoreService';
import { VectorDatabaseType } from '@/modules/factories/VectorDatabaseFactory';

// Create service with SQLite-vec
const vectorStoreService = new VectorStoreService(
    indexPath,
    VectorDatabaseType.SQLITE_VEC // Default is now SQLITE_VEC
);
```

## Rollback

If migration fails or you need to rollback:

1. **Restore FAISS indices** from backup:
   ```bash
   cp -r data/vector_index_backup/* data/vector_index/
   ```

2. **Switch back to FAISS**:
   ```typescript
   const vectorStoreService = new VectorStoreService(
       indexPath,
       VectorDatabaseType.FAISS
   );
   ```

3. **Verify FAISS functionality**:
   ```typescript
   await vectorStoreService.initialize();
   const results = await vectorStoreService.search(queryVector, 10);
   ```

## Troubleshooting

### Extension Loading Errors

If you see errors like "sqlite-vec extension could not be loaded":

1. **Check platform support**: Ensure your platform is supported:
   - Linux x64
   - Linux ARM64
   - macOS x64
   - macOS ARM64
   - Windows x64

2. **Verify package installation**:
   ```bash
   yarn install
   # Check if platform-specific package is installed
   ls node_modules/sqlite-vec-*
   ```

3. **Check extension file**:
   ```bash
   # Linux
   ls node_modules/sqlite-vec-linux-x64/vec0.so
   
   # macOS
   ls node_modules/sqlite-vec-darwin-x64/vec0.dylib
   
   # Windows
   ls node_modules/sqlite-vec-windows-x64/vec0.dll
   ```

### Migration Errors

If migration fails:

1. **Check embedding API access**: Ensure the embedding API is accessible and working
2. **Verify chunk data**: Check that chunks have content in the database
3. **Check dimensions**: Ensure dimensions match between FAISS and SQLite-vec
4. **Review error messages**: Check the `errors` array in the migration result

### Search Errors

If search fails after migration:

1. **Verify extension loaded**: Check console logs for "sqlite-vec extension loaded successfully"
2. **Check database file**: Ensure the `.db` file exists and is readable
3. **Validate vectors**: Verify vectors were added correctly using `getIndexStats()`
4. **Test query vector**: Ensure query vector dimensions match index dimensions

## Performance Considerations

### Migration Performance

- **Batch processing**: Migration processes chunks in batches of 10 to avoid overwhelming the API
- **Progress reporting**: Use progress callbacks to monitor migration progress
- **Error handling**: Migration continues even if individual chunks fail

### Search Performance

- **SQLite-vec**: Generally performs well for small to medium datasets (< 100k vectors)
- **FAISS**: May be faster for very large datasets (> 1M vectors)
- **Memory usage**: SQLite-vec uses less memory than FAISS (vectors stored on disk)

## Best Practices

1. **Always backup**: Create backups before migration
2. **Test migration**: Test migration on a small subset first
3. **Validate data**: Always validate migrated data
4. **Monitor progress**: Use progress callbacks for long migrations
5. **Handle errors**: Check error arrays and handle failures appropriately
6. **Keep FAISS**: Keep FAISS indices as backup until migration is verified

## API Reference

### VectorDatabaseMigrator

#### Constructor

```typescript
new VectorDatabaseMigrator(baseIndexPath?: string, onProgress?: MigrationProgressCallback)
```

#### Methods

- `detectFaissIndices()`: Detect existing FAISS indices
- `migrateDocument(documentId, modelName, dimensions, backupPath?)`: Migrate a single document
- `migrateAll(options?)`: Migrate all FAISS indices
- `validateMigration(documentId, modelName, dimensions)`: Validate migrated data

### MigrationResult

```typescript
interface MigrationResult {
    success: boolean;
    documentsProcessed: number;
    chunksMigrated: number;
    errors: string[];
    warnings: string[];
    backupPath?: string;
    duration: number;
}
```

## Support

For issues or questions:
1. Check the [migration spec](./sqlite-vec-migration-spec.md) for detailed technical information
2. Review the [merge guide](./sqlite-vec-merge-guide.md) for SQLite-vec integration details
3. Check console logs for detailed error messages
4. Verify platform support and package installation

## Conclusion

The migration from FAISS to SQLite-vec provides better compatibility and simpler deployment while maintaining similar functionality. The migration tool automates the process, but requires embedding API access to re-generate vectors. Always backup data before migration and validate results after migration.


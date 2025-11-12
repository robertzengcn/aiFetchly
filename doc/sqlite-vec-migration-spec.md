# Migration Specification: Replace faiss-node with sqlite-vec

## Executive Summary

This document specifies the migration from `faiss-node` to `sqlite-vec` for vector similarity search in the aiFetchly RAG (Retrieval Augmented Generation) system. The migration aims to improve cross-platform compatibility, simplify deployment, and eliminate native dependency issues.

---

## Table of Contents

1. [Background](#background)
2. [Motivation](#motivation)
3. [Current Architecture](#current-architecture)
4. [Proposed Architecture](#proposed-architecture)
5. [Migration Strategy](#migration-strategy)
6. [Implementation Plan](#implementation-plan)
7. [API Mapping](#api-mapping)
8. [Testing Strategy](#testing-strategy)
9. [Rollback Plan](#rollback-plan)
10. [Performance Considerations](#performance-considerations)
11. [Migration Checklist](#migration-checklist)

---

## 1. Background

### Current Implementation: faiss-node

The project currently uses `faiss-node` (v0.5.1) for vector similarity search operations. FAISS (Facebook AI Similarity Search) is a library for efficient similarity search and clustering of dense vectors.

**Files Affected:**
- `/src/modules/adapters/FaissVectorDatabase.ts` - Main implementation
- `/src/modules/factories/VectorDatabaseFactory.ts` - Factory pattern
- `/src/service/VectorStoreService.ts` - Service layer
- Build configuration files (vite configs, forge.config.js)
- Package management (package.json, yarn.lock)

### sqlite-vec Overview

`sqlite-vec` is a SQLite extension that provides vector search capabilities directly within SQLite databases. It offers:
- Pure C implementation with no Node.js native bindings required
- Works with existing SQLite infrastructure (better-sqlite3)
- Simpler cross-platform deployment
- No electron-rebuild requirements
- Built-in persistence (no separate index file management)

---

## 2. Motivation

### Problems with faiss-node

1. **Native Dependencies**: Requires platform-specific native modules that must be rebuilt for Electron
2. **Build Complexity**: Needs `electron-rebuild` for each platform (Windows, macOS, Linux)
3. **Deployment Issues**: Native bindings can break across different OS versions
4. **Build Configuration Overhead**: Marked as external in multiple Vite configs
5. **Maintenance Burden**: Script `rebuild-faiss-node` in package.json indicates ongoing issues

### Benefits of sqlite-vec

1. **Better Compatibility**: No native Node.js bindings, uses SQLite's extension mechanism
2. **Simplified Build**: No electron-rebuild required
3. **Unified Storage**: Leverages existing SQLite infrastructure (better-sqlite3 already in use)
4. **Easier Deployment**: One less native dependency to manage
5. **Better Integration**: Can store vectors alongside metadata in the same database
6. **Simpler Backup/Restore**: Standard SQLite backup mechanisms
7. **Transaction Support**: ACID guarantees from SQLite

---

## 3. Current Architecture

### Component Hierarchy

```
VectorSearchService
    └── VectorStoreService
        └── IVectorDatabase (interface)
            └── FaissVectorDatabase (implementation)
                └── faiss-node (npm package)
```

### Key Classes and Interfaces

#### IVectorDatabase Interface
```typescript
interface IVectorDatabase {
    initialize(): Promise<void>;
    createIndex(config: VectorDatabaseConfig): Promise<string>;
    loadIndex(config: VectorDatabaseConfig): Promise<void>;
    saveIndex(): Promise<void>;
    addVectors(vectors: number[], chunkIds: number[]): Promise<void>;
    search(queryVector: number[], k: number): Promise<VectorSearchResult>;
    getIndexStats(): IndexStats;
    getTotalVectors(): number;
    resetIndex(): Promise<void>;
    optimizeIndex(): Promise<void>;
    backupIndex(backupPath: string): Promise<void>;
    restoreIndex(backupPath: string): Promise<void>;
    indexExists(): boolean;
    getIndexFileSize(): number;
    cleanup(): Promise<void>;
    isInitialized(): boolean;
    deleteDocumentIndex(documentId: number): Promise<void>;
    documentIndexExists(documentId: number): boolean;
}
```

#### Current Data Flow

1. **Document Processing** → Chunks → Embeddings → Vector Storage
2. **Vector Storage**: 
   - Vectors stored in FAISS index files (`.index` extension)
   - Chunk ID mapping maintained in-memory (Map<number, number>)
   - Separate index files per document or per model
3. **Search Flow**:
   - Query → Embedding → FAISS search → Chunk IDs → Document retrieval

### File Structure

```
vector_indices/
├── model_{modelId}/
│   └── index.index           # Model-specific index
└── document_{documentId}/
    └── model_{modelId}/
        └── index.index       # Document-specific index
```

---

## 4. Proposed Architecture

### Component Hierarchy (New)

```
VectorSearchService
    └── VectorStoreService
        └── IVectorDatabase (interface)
            ├── FaissVectorDatabase (deprecated, optional)
            └── SqliteVecDatabase (new implementation)
                └── better-sqlite3 + sqlite-vec extension
```

### Key Changes

1. **New Implementation**: `SqliteVecDatabase` class implementing `IVectorDatabase`
2. **Storage Model**: SQLite database files instead of FAISS index files
3. **Metadata Storage**: Vectors and chunk metadata stored together
4. **Factory Update**: `VectorDatabaseFactory` updated to support sqlite-vec
5. **Build Simplification**: Remove faiss-node from build configurations

### Database Schema

```sql
-- Vector storage table (per document or per model)
CREATE TABLE IF NOT EXISTS vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id INTEGER NOT NULL,
    embedding BLOB NOT NULL,           -- sqlite-vec compatible format
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Virtual table for vector search (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_index USING vec0(
    chunk_id INTEGER,
    embedding FLOAT[{dimensions}]      -- dimensions specified at creation
);

-- Metadata table
CREATE TABLE IF NOT EXISTS vector_metadata (
    id INTEGER PRIMARY KEY,
    dimension INTEGER NOT NULL,
    total_vectors INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    index_type TEXT DEFAULT 'flat',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster chunk lookups
CREATE INDEX IF NOT EXISTS idx_vectors_chunk_id ON vectors(chunk_id);
```

### File Structure (New)

```
vector_indices/
├── model_{modelId}/
│   └── index.db              # SQLite database
└── document_{documentId}/
    └── model_{modelId}/
        └── index.db          # SQLite database
```

---

## 5. Migration Strategy

### Approach: Parallel Implementation with Feature Flag

1. **Phase 1**: Implement `SqliteVecDatabase` alongside existing `FaissVectorDatabase`
2. **Phase 2**: Add database type selection via configuration
3. **Phase 3**: Test both implementations in parallel
4. **Phase 4**: Default to sqlite-vec, deprecate faiss-node
5. **Phase 5**: Remove faiss-node dependency and code

### Migration Paths

#### For Existing Users

1. **Automatic Migration**: On first startup with sqlite-vec:
   - Detect existing FAISS index files
   - Read vectors and rebuild in SQLite format
   - Preserve chunk ID mappings
   - Mark FAISS indices as deprecated

2. **Manual Migration**: Via CLI/UI:
   - User-triggered migration command
   - Progress reporting
   - Validation step

3. **Hybrid Mode**: Support both during transition:
   - Read from FAISS if SQLite index doesn't exist
   - Write to SQLite going forward
   - Gradual migration as documents are reindexed

#### For New Users

- Default to sqlite-vec from the start
- No FAISS dependency required

---

## 6. Implementation Plan

### Task Breakdown

#### Task 1: Setup and Dependencies
**Priority**: High  
**Estimated Effort**: 2 hours

- [ ] Research sqlite-vec installation and setup
- [ ] Add `sqlite-vec` to dependencies (or compile as loadable extension)
- [ ] Verify compatibility with existing `better-sqlite3` (v11.9.1)
- [ ] Create sample proof-of-concept for vector operations

#### Task 2: Create SqliteVecDatabase Implementation
**Priority**: High  
**Estimated Effort**: 1 day

- [ ] Create `/src/modules/adapters/SqliteVecDatabase.ts`
- [ ] Implement `IVectorDatabase` interface
- [ ] Implement core methods:
  - [ ] `initialize()` - Load sqlite-vec extension
  - [ ] `createIndex()` - Create SQLite database with vec0 virtual table
  - [ ] `loadIndex()` - Open existing database
  - [ ] `addVectors()` - Insert vectors using sqlite-vec API
  - [ ] `search()` - Perform vector similarity search
  - [ ] `saveIndex()` - SQLite auto-saves, implement checkpoint
  - [ ] `getIndexStats()` - Query metadata table
  - [ ] `getTotalVectors()` - COUNT(*) query
  - [ ] `resetIndex()` - DROP and recreate tables
  - [ ] `optimizeIndex()` - SQLite VACUUM and ANALYZE
  - [ ] `backupIndex()` - SQLite backup API
  - [ ] `restoreIndex()` - Restore from backup
  - [ ] `deleteDocumentIndex()` - Delete database file
  - [ ] `documentIndexExists()` - Check file existence
- [ ] Implement helper methods:
  - [ ] `rebuildChunkIdMapping()` - Load from database (not needed with sqlite)
  - [ ] Vector serialization/deserialization for BLOB storage
  - [ ] Error handling and logging

#### Task 3: Update VectorDatabaseFactory
**Priority**: High  
**Estimated Effort**: 2 hours

- [ ] Update `/src/modules/factories/VectorDatabaseFactory.ts`
- [ ] Add `SQLITE_VEC = 'sqlite-vec'` to `VectorDatabaseType` enum
- [ ] Add factory method for SqliteVecDatabase
- [ ] Update `createDatabase()` to support sqlite-vec type
- [ ] Add `createSqliteVecDatabase()` convenience method
- [ ] Update `createFromEnvironment()` to default to sqlite-vec

#### Task 4: Configuration Updates
**Priority**: Medium  
**Estimated Effort**: 1 hour

- [ ] Add environment variable `VECTOR_DB_TYPE=sqlite-vec`
- [ ] Update config file if exists
- [ ] Add migration flag `ENABLE_FAISS_TO_SQLITE_MIGRATION=true`

#### Task 5: Migration Tool
**Priority**: Medium  
**Estimated Effort**: 1 day

- [ ] Create `/src/modules/migration/VectorDatabaseMigrator.ts`
- [ ] Implement FAISS → SQLite migration:
  - [ ] Detect existing FAISS indices
  - [ ] Read vectors from FAISS index
  - [ ] Query chunk IDs from database
  - [ ] Write vectors to SQLite with metadata
  - [ ] Validate migrated data
  - [ ] Create backup of original FAISS files
- [ ] Add progress reporting
- [ ] Add CLI command for migration
- [ ] Add IPC handler for UI-triggered migration

#### Task 6: Update VectorStoreService
**Priority**: Medium  
**Estimated Effort**: 4 hours

- [ ] Review `/src/service/VectorStoreService.ts`
- [ ] Update database initialization logic
- [ ] Remove FAISS-specific workarounds if any
- [ ] Update error messages
- [ ] Verify chunk ID mapping logic (simplified with SQLite)

#### Task 7: Build Configuration Cleanup
**Priority**: Medium  
**Estimated Effort**: 2 hours

- [ ] Remove `faiss-node` from externals in `/vite.render.config.mjs`
- [ ] Remove `faiss-node` from externals in `/vite.preload.config.mjs`
- [ ] Remove `faiss-node` from externals in `/vite.main.config.mjs`
- [ ] Remove `faiss-node` from externals in `/forge.config.js`
- [ ] Remove `rebuild-faiss-node` script from `package.json`
- [ ] Remove `faiss-node` dependency from `package.json`
- [ ] Update documentation references

#### Task 8: Testing
**Priority**: High  
**Estimated Effort**: 2 days

- [ ] Unit tests for `SqliteVecDatabase`
  - [ ] Test vector insertion
  - [ ] Test vector search
  - [ ] Test edge cases (empty index, dimension mismatch)
  - [ ] Test backup/restore
  - [ ] Test optimization
- [ ] Integration tests
  - [ ] Test with `VectorStoreService`
  - [ ] Test document indexing flow
  - [ ] Test search accuracy compared to FAISS
- [ ] Migration tests
  - [ ] Test FAISS → SQLite migration
  - [ ] Test data integrity after migration
- [ ] Performance tests
  - [ ] Benchmark search performance
  - [ ] Compare with FAISS baseline
  - [ ] Test with large datasets (10k, 100k, 1M vectors)
- [ ] Cross-platform tests
  - [ ] Test on Windows
  - [ ] Test on macOS
  - [ ] Test on Linux

#### Task 9: Documentation
**Priority**: Medium  
**Estimated Effort**: 4 hours

- [ ] Update `/doc/rag_prd.md` - Replace faiss-node references
- [ ] Update `/doc/rag_api_documentation.md` - Update VectorStoreService docs
- [ ] Update `/doc/VectorDatabaseRefactoringGuide.md` - Add sqlite-vec section
- [ ] Update `/doc/rag_todo_list.md` - Mark FAISS tasks complete, add sqlite-vec tasks
- [ ] Create migration guide for users
- [ ] Update README if needed

#### Task 10: Deprecation and Cleanup
**Priority**: Low  
**Estimated Effort**: 2 hours

- [ ] Mark `FaissVectorDatabase` as deprecated (add JSDoc @deprecated)
- [ ] Add migration warnings in logs for FAISS users
- [ ] Plan removal timeline (e.g., 2 versions ahead)
- [ ] Remove FAISS code in future version

---

## 7. API Mapping

### faiss-node → sqlite-vec Mapping

| faiss-node Operation | sqlite-vec Equivalent | Notes |
|---------------------|----------------------|-------|
| `new faiss.IndexFlatL2(dim)` | `CREATE VIRTUAL TABLE vec_index USING vec0(embedding FLOAT[dim])` | Create index |
| `index.add(vectors)` | `INSERT INTO vec_index VALUES (?, ?)` | Add vectors |
| `index.search(query, k)` | `SELECT * FROM vec_index WHERE embedding MATCH ? ORDER BY distance LIMIT k` | Search |
| `index.write(path)` | N/A (auto-persisted) | SQLite auto-saves |
| `index.read(path)` | `new Database(path)` | Open database |
| `index.ntotal()` | `SELECT COUNT(*) FROM vectors` | Count vectors |
| `index.getDimension()` | `SELECT dimension FROM vector_metadata` | Get dimension |
| `index.reset()` | `DELETE FROM vec_index; DELETE FROM vectors;` | Clear index |

### Distance Metrics

| FAISS | sqlite-vec | Compatibility |
|-------|-----------|---------------|
| L2 (Euclidean) | L2 distance | ✅ Direct mapping |
| Inner Product | Cosine similarity | ⚠️ Requires normalization |
| Cosine | Cosine similarity | ✅ Direct mapping |

### IVectorDatabase Method Implementations

#### initialize()
```typescript
// FAISS
async initialize(): Promise<void> {
    // Static import at top, just set flag
    this.initialized = true;
}

// SQLite-vec
async initialize(): Promise<void> {
    // Load sqlite-vec extension
    this.db.loadExtension('vec0');
    this.initialized = true;
}
```

#### createIndex()
```typescript
// FAISS
async createIndex(config: VectorDatabaseConfig): Promise<string> {
    this.index = new faiss.IndexFlatL2(config.dimensions);
    this.index.write(this.indexPath);
    return this.indexPath;
}

// SQLite-vec
async createIndex(config: VectorDatabaseConfig): Promise<string> {
    this.db = new Database(this.indexPath);
    this.db.exec(`
        CREATE VIRTUAL TABLE vec_index USING vec0(
            chunk_id INTEGER,
            embedding FLOAT[${config.dimensions}]
        );
        CREATE TABLE vectors (...);
        CREATE TABLE vector_metadata (...);
    `);
    return this.indexPath;
}
```

#### addVectors()
```typescript
// FAISS
async addVectors(vectors: number[], chunkIds: number[]): Promise<void> {
    const currentCount = this.index.ntotal();
    this.index.add(vectors);
    for (let i = 0; i < chunkIds.length; i++) {
        this.chunkIdMapping.set(currentCount + i, chunkIds[i]);
    }
    this.index.write(this.indexPath);
}

// SQLite-vec
async addVectors(vectors: number[], chunkIds: number[]): Promise<void> {
    const stmt = this.db.prepare(`
        INSERT INTO vec_index (chunk_id, embedding) VALUES (?, ?)
    `);
    const vectorsStmt = this.db.prepare(`
        INSERT INTO vectors (chunk_id, embedding) VALUES (?, ?)
    `);
    
    const insertMany = this.db.transaction((items) => {
        for (const [chunkId, vector] of items) {
            stmt.run(chunkId, serializeVector(vector));
            vectorsStmt.run(chunkId, serializeVector(vector));
        }
    });
    
    insertMany(zip(chunkIds, splitVectors(vectors, this.dimension)));
}
```

#### search()
```typescript
// FAISS
async search(queryVector: number[], k: number): Promise<VectorSearchResult> {
    const results = this.index.search(queryVector, k);
    const chunkIds = results.labels.map(idx => this.chunkIdMapping.get(idx));
    return {
        indices: results.labels,
        distances: results.distances,
        chunkIds: chunkIds
    };
}

// SQLite-vec
async search(queryVector: number[], k: number): Promise<VectorSearchResult> {
    const stmt = this.db.prepare(`
        SELECT chunk_id, distance 
        FROM vec_index 
        WHERE embedding MATCH ? 
        ORDER BY distance 
        LIMIT ?
    `);
    
    const results = stmt.all(serializeVector(queryVector), k);
    return {
        indices: results.map((_, i) => i),
        distances: results.map(r => r.distance),
        chunkIds: results.map(r => r.chunk_id)
    };
}
```

---

## 8. Testing Strategy

### Test Categories

#### 1. Unit Tests
**File**: `/test/modules/SqliteVecDatabase.test.ts`

```typescript
describe('SqliteVecDatabase', () => {
    describe('Initialization', () => {
        it('should initialize with sqlite-vec extension');
        it('should fail gracefully if extension not found');
    });
    
    describe('Index Creation', () => {
        it('should create index with correct dimension');
        it('should create document-specific index');
        it('should create model-specific index');
        it('should throw on invalid dimensions');
    });
    
    describe('Vector Operations', () => {
        it('should add single vector');
        it('should add multiple vectors in batch');
        it('should reject vectors with wrong dimensions');
        it('should handle empty vector arrays');
    });
    
    describe('Search Operations', () => {
        it('should search and return top k results');
        it('should handle k larger than total vectors');
        it('should return empty results on empty index');
        it('should return correct chunk IDs');
        it('should return sorted by distance');
    });
    
    describe('Persistence', () => {
        it('should persist vectors to disk');
        it('should load existing index');
        it('should handle corrupted databases');
    });
    
    describe('Backup and Restore', () => {
        it('should backup index to specified path');
        it('should restore index from backup');
        it('should validate restored data');
    });
});
```

#### 2. Integration Tests
**File**: `/test/integration/vector-store-sqlite.test.ts`

```typescript
describe('VectorStoreService with SqliteVec', () => {
    it('should create index via VectorStoreService');
    it('should add document embeddings');
    it('should search across documents');
    it('should switch between models');
    it('should delete document indices');
});
```

#### 3. Migration Tests
**File**: `/test/migration/faiss-to-sqlite.test.ts`

```typescript
describe('FAISS to SQLite Migration', () => {
    it('should detect existing FAISS indices');
    it('should migrate vectors correctly');
    it('should preserve chunk ID mappings');
    it('should validate migrated data');
    it('should backup original FAISS files');
    it('should handle partial migrations');
});
```

#### 4. Performance Tests
**File**: `/test/performance/vector-search-benchmark.test.ts`

```typescript
describe('Performance Benchmarks', () => {
    it('should benchmark insertion speed (1k vectors)');
    it('should benchmark search speed (10k index, k=10)');
    it('should compare with FAISS baseline');
    it('should test with large datasets (100k+ vectors)');
    it('should measure memory usage');
});
```

### Acceptance Criteria

- ✅ All unit tests pass
- ✅ Integration tests pass
- ✅ Migration from FAISS completes successfully
- ✅ Search results match FAISS within acceptable tolerance
- ✅ Performance within 20% of FAISS (or document tradeoffs)
- ✅ Cross-platform builds succeed (Windows, macOS, Linux)
- ✅ No electron-rebuild errors
- ✅ Documentation updated

---

## 9. Rollback Plan

### Scenarios Requiring Rollback

1. **Critical Performance Regression**: sqlite-vec significantly slower than FAISS
2. **Data Loss**: Migration issues causing data corruption
3. **Platform Incompatibility**: sqlite-vec doesn't work on target platforms
4. **Critical Bugs**: Showstopper bugs discovered late

### Rollback Procedure

#### Immediate Rollback (Same Version)

1. **Revert Configuration**:
   ```bash
   # Set environment variable back to FAISS
   export VECTOR_DB_TYPE=faiss
   ```

2. **Keep Both Implementations**: 
   - Don't remove `FaissVectorDatabase` immediately
   - Keep it for at least 2 versions
   - Allow runtime switching

3. **Data Preservation**:
   - Keep original FAISS indices during migration
   - Store in `.backup/` subdirectory
   - Don't delete until migration verified

#### Version Rollback

1. **Revert Code Changes**:
   ```bash
   git revert <commit-hash-range>
   ```

2. **Reinstall Dependencies**:
   ```bash
   yarn install
   yarn rebuild-faiss-node
   ```

3. **Restore FAISS Indices**:
   - Copy from `.backup/` to original location
   - Restart application

### Rollback Timeline

- **Week 1-2**: Both implementations available, easy rollback
- **Week 3-4**: sqlite-vec default, FAISS available with flag
- **Month 2+**: FAISS deprecated, removal planned
- **Month 3+**: FAISS removed (point of no return)

---

## 10. Performance Considerations

### Expected Performance Characteristics

#### sqlite-vec Advantages
- ✅ **Better write performance**: Batch inserts with transactions
- ✅ **Lower memory usage**: Vectors on disk, not in-memory mapping
- ✅ **Simpler persistence**: Auto-save with SQLite
- ✅ **Better for small-medium datasets**: < 100k vectors

#### sqlite-vec Disadvantages
- ⚠️ **Potentially slower search**: Not as optimized as FAISS for large datasets
- ⚠️ **Limited index types**: Primarily flat (exhaustive) search
- ⚠️ **CPU-bound**: No GPU acceleration (FAISS supports GPU)

### Optimization Strategies

1. **Batch Operations**: Use transactions for bulk inserts
2. **Connection Pooling**: Reuse database connections
3. **Indices**: Create appropriate SQL indices on metadata
4. **VACUUM**: Regular database optimization
5. **Memory Mode**: Option for in-memory database for speed
6. **Prepared Statements**: Reuse prepared statements for searches

### Performance Benchmarks to Track

| Metric | Target | Baseline (FAISS) |
|--------|--------|------------------|
| Insert 1k vectors | < 500ms | ~200ms |
| Search (10k index, k=10) | < 50ms | ~20ms |
| Memory usage (10k vectors) | < 100MB | ~80MB |
| Index file size (10k vectors) | < 50MB | ~40MB |

### When sqlite-vec May Not Be Suitable

- Datasets > 1M vectors
- Real-time search requirements (< 10ms)
- GPU acceleration needed
- Complex index types required (IVF, HNSW with specific parameters)

**Mitigation**: Keep FAISS as optional backend for high-performance scenarios

---

## 11. Migration Checklist

### Pre-Migration

- [ ] Review current FAISS usage patterns
- [ ] Document vector dimensions used in production
- [ ] Backup all existing FAISS indices
- [ ] Identify performance requirements
- [ ] Review sqlite-vec documentation and examples

### Implementation

- [ ] Install and configure sqlite-vec
- [ ] Implement `SqliteVecDatabase` class
- [ ] Update `VectorDatabaseFactory`
- [ ] Create migration tool
- [ ] Update configuration system
- [ ] Update build configurations
- [ ] Write tests (unit, integration, migration)
- [ ] Update documentation

### Testing

- [ ] Run unit tests
- [ ] Run integration tests
- [ ] Perform migration tests with real data
- [ ] Benchmark performance
- [ ] Test on all platforms (Windows, macOS, Linux)
- [ ] User acceptance testing

### Deployment

- [ ] Deploy with feature flag (FAISS still default)
- [ ] Monitor performance metrics
- [ ] Gather user feedback
- [ ] Switch default to sqlite-vec
- [ ] Deprecate FAISS

### Post-Migration

- [ ] Monitor error rates
- [ ] Track performance metrics
- [ ] Address user issues
- [ ] Clean up FAISS code (after grace period)
- [ ] Update documentation to remove FAISS references

---

## Appendix A: File Changes Summary

### Files to Create
- `/src/modules/adapters/SqliteVecDatabase.ts` - New implementation
- `/src/modules/migration/VectorDatabaseMigrator.ts` - Migration tool
- `/test/modules/SqliteVecDatabase.test.ts` - Unit tests
- `/test/integration/vector-store-sqlite.test.ts` - Integration tests
- `/test/migration/faiss-to-sqlite.test.ts` - Migration tests
- `/doc/sqlite-vec-migration-guide.md` - User guide

### Files to Modify
- `/src/modules/factories/VectorDatabaseFactory.ts` - Add sqlite-vec support
- `/src/service/VectorStoreService.ts` - Update for sqlite-vec
- `/vite.render.config.mjs` - Remove faiss-node external
- `/vite.preload.config.mjs` - Remove faiss-node external
- `/vite.main.config.mjs` - Remove faiss-node external
- `/forge.config.js` - Remove faiss-node external
- `/package.json` - Update dependencies and scripts
- `/doc/rag_prd.md` - Update vector search section
- `/doc/rag_api_documentation.md` - Update API docs
- `/doc/VectorDatabaseRefactoringGuide.md` - Add sqlite-vec

### Files to Deprecate (Later)
- `/src/modules/adapters/FaissVectorDatabase.ts` - Mark deprecated, remove later

---

## Appendix B: sqlite-vec API Reference

### Basic Usage

```typescript
import Database from 'better-sqlite3';

// Load extension
const db = new Database('vectors.db');
db.loadExtension('vec0');

// Create virtual table
db.exec(`
    CREATE VIRTUAL TABLE vec_items USING vec0(
        embedding FLOAT[3]
    )
`);

// Insert vectors
const stmt = db.prepare('INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)');
stmt.run(1, new Float32Array([0.1, 0.2, 0.3]));
stmt.run(2, new Float32Array([0.4, 0.5, 0.6]));

// Search
const search = db.prepare(`
    SELECT rowid, distance 
    FROM vec_items 
    WHERE embedding MATCH ? 
    ORDER BY distance 
    LIMIT 5
`);
const results = search.all(new Float32Array([0.1, 0.2, 0.3]));
```

### Distance Functions

```sql
-- L2 (Euclidean) distance
WHERE embedding MATCH ? AND k = 10

-- Cosine similarity
WHERE embedding MATCH ? AND k = 10 USING 'cosine'
```

---

## Appendix C: Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Performance regression | High | Medium | Keep FAISS as fallback; benchmark early |
| Data loss during migration | Critical | Low | Backup before migration; validate after |
| sqlite-vec incompatibility | High | Low | Test on all platforms early |
| Search accuracy issues | Medium | Low | Compare results with FAISS in tests |
| User resistance | Low | Low | Transparent migration; clear benefits |
| Extended timeline | Medium | Medium | Parallel implementation; phased rollout |

---

## Appendix D: Success Metrics

### Technical Metrics
- ✅ Zero electron-rebuild errors related to vectors
- ✅ Build time reduced by > 30 seconds
- ✅ Search performance within 20% of FAISS
- ✅ No data loss in migrations
- ✅ Cross-platform compatibility verified

### User Metrics
- ✅ No user-reported regressions
- ✅ Positive feedback on installation simplicity
- ✅ < 5% rollback rate

### Project Metrics
- ✅ Reduced maintenance burden (no native rebuilds)
- ✅ Documentation updated and accurate
- ✅ Clean, maintainable codebase

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-12 | AI Assistant | Initial specification document |

---

**Document Status**: ✅ Ready for Review  
**Next Steps**: Review and approval by project maintainers


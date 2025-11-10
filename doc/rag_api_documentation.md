# RAG Engine API Documentation

## Overview

The RAG (Retrieval Augmented Generation) Engine provides a comprehensive API for document management, vector search, and AI-powered question answering. This documentation covers all available APIs and their usage.

## Table of Contents

1. [Core Services](#core-services)
2. [RAG Module](#rag-module)
3. [IPC Handlers](#ipc-handlers)
4. [Data Models](#data-models)
5. [Error Handling](#error-handling)
6. [Examples](#examples)

## Core Services

### DocumentService

The DocumentService handles document upload, management, and metadata operations.

#### Methods

##### `uploadDocument(options: DocumentUploadOptions): Promise<RAGDocumentEntity>`

Uploads a document to the knowledge base.

**Parameters:**
- `options.filePath: string` - Path to the document file
- `options.name: string` - Document name
- `options.title?: string` - Document title
- `options.description?: string` - Document description
- `options.tags?: string[]` - Document tags
- `options.author?: string` - Document author

**Returns:** Promise resolving to the created document entity

**Example:**
```typescript
const document = await documentService.uploadDocument({
    filePath: '/path/to/document.pdf',
    name: 'AI Research Paper',
    title: 'Advances in Machine Learning',
    description: 'A comprehensive study on ML techniques',
    tags: ['ai', 'machine-learning', 'research'],
    author: 'Dr. Smith'
});
```

##### `findDocumentById(id: number): Promise<RAGDocumentEntity | null>`

Retrieves a document by its ID.

**Parameters:**
- `id: number` - Document ID

**Returns:** Promise resolving to the document entity or null if not found

##### `getDocuments(filters?: DocumentFilters): Promise<RAGDocumentEntity[]>`

Retrieves documents with optional filtering.

**Parameters:**
- `filters?: DocumentFilters` - Optional filters
  - `status?: string` - Filter by status
  - `fileType?: string` - Filter by file type
  - `tags?: string[]` - Filter by tags
  - `author?: string` - Filter by author

**Returns:** Promise resolving to array of document entities

##### `updateDocumentStatus(id: number, status: string, processingStatus?: string): Promise<void>`

Updates document status.

**Parameters:**
- `id: number` - Document ID
- `status: string` - New status
- `processingStatus?: string` - Optional processing status

##### `deleteDocument(id: number, deleteFile?: boolean): Promise<void>`

Deletes a document.

**Parameters:**
- `id: number` - Document ID
- `deleteFile?: boolean` - Whether to delete the physical file

##### `getDocumentStats(): Promise<DocumentStats>`

Returns document statistics.

**Returns:** Promise resolving to statistics object

### ChunkingService

The ChunkingService handles document chunking and text processing.

#### Methods

##### `chunkDocument(document: RAGDocumentEntity): Promise<RAGChunkEntity[]>`

Chunks a document into smaller pieces.

**Parameters:**
- `document: RAGDocumentEntity` - Document to chunk

**Returns:** Promise resolving to array of chunk entities

##### `getChunkStats(): Promise<ChunkStats>`

Returns chunking statistics.

**Returns:** Promise resolving to chunk statistics

### VectorStoreService

The VectorStoreService manages FAISS vector indices.

#### Methods

##### `initialize(): Promise<void>`

Initializes the vector store service.

##### `createIndex(dimension: number, indexType?: string): Promise<void>`

Creates a new FAISS index.

**Parameters:**
- `dimension: number` - Vector dimension
- `indexType?: string` - Index type (default: 'Flat')

##### `addVectors(vectors: number[][], chunkIds: number[]): Promise<void>`

Adds vectors to the index.

**Parameters:**
- `vectors: number[][]` - Array of vectors
- `chunkIds: number[]` - Corresponding chunk IDs

##### `search(queryVector: number[], k?: number): Promise<SearchResult>`

Searches for similar vectors.

**Parameters:**
- `queryVector: number[]` - Query vector
- `k?: number` - Number of results (default: 10)

**Returns:** Promise resolving to search results

### VectorSearchService

The VectorSearchService provides high-level search functionality.

#### Methods

##### `search(query: string, options?: SearchOptions): Promise<SearchResult[]>`

Performs vector search.

**Parameters:**
- `query: string` - Search query
- `options?: SearchOptions` - Search options
  - `limit?: number` - Maximum results
  - `threshold?: number` - Similarity threshold
  - `includeMetadata?: boolean` - Include metadata

**Returns:** Promise resolving to search results

##### `searchWithFilters(query: string, filters: SearchFilters, options?: SearchOptions): Promise<SearchResult[]>`

Performs filtered search.

**Parameters:**
- `query: string` - Search query
- `filters: SearchFilters` - Search filters
- `options?: SearchOptions` - Search options

**Returns:** Promise resolving to filtered search results

## RAG Module

The RAGModule provides the main interface for RAG operations.

### Methods

##### `initialize(embeddingConfig: EmbeddingConfig, llmConfig: LlmCongfig): Promise<void>`

Initializes the RAG module.

**Parameters:**
- `embeddingConfig: EmbeddingConfig` - Embedding configuration
- `llmConfig: LlmCongfig` - LLM configuration

##### `processQuery(ragQuery: RAGQuery): Promise<RAGResponse>`

Processes a query through the complete RAG pipeline.

**Parameters:**
- `ragQuery: RAGQuery` - Query object
  - `query: string` - Query text
  - `options?: QueryOptions` - Query options

**Returns:** Promise resolving to RAG response

**Example:**
```typescript
const response = await ragModule.processQuery({
    query: "What is machine learning?",
    options: {
        queryProcessing: {
            enableExpansion: true,
            maxExpansionTerms: 5
        },
        responseGeneration: {
            maxLength: 500,
            temperature: 0.7
        },
        search: {
            limit: 10,
            threshold: 0.6
        }
    }
});
```

##### `uploadDocument(filePath: string, options: DocumentOptions): Promise<UploadResult>`

Uploads and processes a document.

**Parameters:**
- `filePath: string` - Path to document
- `options: DocumentOptions` - Document options

**Returns:** Promise resolving to upload result

##### `getStats(): RAGStats`

Returns module statistics.

**Returns:** RAG statistics object

##### `getQuerySuggestions(partialQuery: string, limit?: number): Promise<string[]>`

Gets query suggestions.

**Parameters:**
- `partialQuery: string` - Partial query
- `limit?: number` - Maximum suggestions

**Returns:** Promise resolving to suggestions array

## IPC Handlers

The RAG IPC handlers provide Electron main process integration.

### Available Handlers

#### `rag:initialize`
Initializes the RAG module.

**Parameters:**
```typescript
{
    embedding: EmbeddingConfig,
    llm: LlmCongfig
}
```

**Returns:**
```typescript
{
    success: boolean,
    message: string
}
```

#### `rag:query`
Processes a RAG query.

**Parameters:**
```typescript
{
    query: string,
    options?: QueryOptions
}
```

**Returns:**
```typescript
{
    success: boolean,
    data?: RAGResponse,
    message?: string
}
```

#### `rag:upload-document`
Uploads a document.

**Parameters:**
```typescript
{
    filePath: string,
    name: string,
    title?: string,
    description?: string,
    tags?: string[],
    author?: string
}
```

**Returns:**
```typescript
{
    success: boolean,
    data?: UploadResult,
    message?: string
}
```

#### `rag:get-documents`
Retrieves documents.

**Parameters:**
```typescript
filters?: DocumentFilters
```

**Returns:**
```typescript
{
    success: boolean,
    data?: RAGDocumentEntity[],
    message?: string
}
```

#### `rag:search`
Performs search.

**Parameters:**
```typescript
{
    query: string,
    options?: SearchOptions,
    filters?: SearchFilters
}
```

**Returns:**
```typescript
{
    success: boolean,
    data?: SearchResponse,
    message?: string
}
```

## Data Models

### RAGDocumentEntity

```typescript
interface RAGDocumentEntity {
    id: number;
    name: string;
    title?: string;
    description?: string;
    filePath: string;
    fileType: string;
    fileSize: number;
    status: string;
    processingStatus?: string;
    tags?: string[];
    author?: string;
    uploadedAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}
```

### RAGChunkEntity

```typescript
interface RAGChunkEntity {
    id: number;
    documentId: number;
    chunkIndex: number;
    content: string;
    tokenCount: number;
    embeddingId?: string;
    vectorDimensions?: number;
    startPosition?: number;
    endPosition?: number;
    pageNumber?: number;
    createdAt?: Date;
    updatedAt?: Date;
}
```

### RAGModelEntity

```typescript
interface RAGModelEntity {
    id: number;
    name: string;
    provider: string;
    modelId: string;
    dimensions: number;
    isActive: boolean;
    config: any;
    createdAt?: Date;
    updatedAt?: Date;
}
```

### RAGResponse

```typescript
interface RAGResponse {
    query: string;
    response: string;
    sources: RAGSource[];
    confidence: number;
    processingTime: number;
    metadata: {
        queryIntent: string;
        chunksUsed: number;
        documentsUsed: number;
        model: string;
    };
}
```

### RAGSource

```typescript
interface RAGSource {
    chunkId: number;
    documentId: number;
    documentName: string;
    title?: string;
    content: string;
    relevanceScore: number;
    pageNumber?: number;
}
```

## Error Handling

All API methods return promises that can be rejected with errors. Common error types:

### DocumentService Errors
- `File not found` - When file path doesn't exist
- `Unsupported file type` - When file type is not supported
- `Document not found` - When document ID doesn't exist
- `Invalid file format` - When file cannot be parsed

### ChunkingService Errors
- `Document not found` - When document doesn't exist
- `Chunking failed` - When chunking process fails
- `Invalid content` - When content cannot be processed

### VectorStoreService Errors
- `Index not initialized` - When index is not created
- `Dimension mismatch` - When vector dimensions don't match
- `FAISS not available` - When FAISS library is not installed

### RAGModule Errors
- `Module not initialized` - When RAG module is not initialized
- `Embedding service not available` - When embedding service is not set
- `LLM not available` - When LLM service is not configured

## Examples

### Basic Document Upload

```typescript
import { DocumentService } from '@/service/DocumentService';
import { SqliteDb } from '@/config/SqliteDb';

const db = SqliteDb.getInstance('/path/to/database');
const documentService = new DocumentService(db);

// Upload a document
const document = await documentService.uploadDocument({
    filePath: '/path/to/document.pdf',
    name: 'Research Paper',
    title: 'AI Research',
    tags: ['ai', 'research']
});

console.log('Document uploaded:', document.id);
```

### RAG Query Processing

```typescript
import { RAGModule } from '@/modules/rag/RAGModule';
import { SqliteDb } from '@/config/SqliteDb';

const db = SqliteDb.getInstance('/path/to/database');
const ragModule = new RAGModule(db);

// Initialize with configuration
await ragModule.initialize({
    provider: 'openai',
    model: 'text-embedding-ada-002',
    apiKey: 'your-api-key'
}, {
    model: 'gpt-3.5-turbo',
    apiKey: 'your-api-key'
});

// Process a query
const response = await ragModule.processQuery({
    query: "What are the main benefits of machine learning?",
    options: {
        search: { limit: 5, threshold: 0.7 },
        responseGeneration: { maxLength: 300 }
    }
});

console.log('Response:', response.response);
console.log('Sources:', response.sources);
```

### Search with Filters

```typescript
import { RagSearchController } from '@/controller/RagSearchController';
import { SqliteDb } from '@/config/SqliteDb';

const searchController = new RagSearchController();

// Perform search
const results = await searchController.search({
    query: "machine learning algorithms",
    options: {
        limit: 10,
        threshold: 0.6,
        includeMetadata: true
    },
    filters: {
        documentTypes: ['pdf', 'txt'],
        dateRange: {
            start: new Date('2023-01-01'),
            end: new Date('2023-12-31')
        }
    }
});

console.log('Found', results.totalResults, 'results');
```

### Error Handling

```typescript
try {
    const document = await documentService.uploadDocument({
        filePath: '/path/to/document.pdf',
        name: 'Test Document'
    });
} catch (error) {
    if (error.message.includes('File not found')) {
        console.error('Document file not found');
    } else if (error.message.includes('Unsupported file type')) {
        console.error('File type not supported');
    } else {
        console.error('Upload failed:', error.message);
    }
}
```

## Configuration

### Embedding Configuration

```typescript
interface EmbeddingConfig {
    provider: 'openai' | 'huggingface' | 'ollama';
    model: string;
    apiKey?: string;
    url?: string;
    dimensions?: number;
    maxTokens?: number;
    temperature?: number;
    maxRetries?: number;
}
```

### LLM Configuration

```typescript
interface LlmCongfig {
    model: string;
    apiKey?: string;
    url?: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
}
```

## Performance Considerations

1. **Vector Index Size**: Large document collections may require significant memory for the FAISS index
2. **Embedding Generation**: Generating embeddings for large documents can be time-consuming
3. **Search Performance**: Vector search performance depends on index type and size
4. **Memory Usage**: Keep track of memory usage when processing large documents

## Security Notes

1. **API Keys**: Store API keys securely and never commit them to version control
2. **File Validation**: Always validate uploaded files before processing
3. **Access Control**: Implement proper access control for document operations
4. **Data Privacy**: Ensure sensitive documents are handled according to privacy requirements

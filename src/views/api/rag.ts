import { windowInvoke } from '@/views/utils/apirequest';
import { EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';
import { LlmCongfig } from '@/entityTypes/commonType';
import {
  RAG_INITIALIZE,
  RAG_QUERY,
  RAG_UPLOAD_DOCUMENT,
  RAG_GET_STATS,
  RAG_TEST_PIPELINE,
  RAG_GET_DOCUMENTS,
  RAG_GET_DOCUMENT,
  RAG_UPDATE_DOCUMENT,
  RAG_DELETE_DOCUMENT,
  RAG_GET_DOCUMENT_STATS,
  RAG_SEARCH,
  RAG_GET_SUGGESTIONS,
  RAG_GET_SEARCH_ANALYTICS,
  RAG_UPDATE_EMBEDDING_MODEL,
  RAG_GET_AVAILABLE_MODELS,
  RAG_TEST_EMBEDDING_SERVICE,
  RAG_CLEAR_CACHE,
  RAG_CLEANUP
} from '@/config/channellist';

// RAG API response types
export interface RAGResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface RAGStats {
  totalDocuments: number;
  totalChunks: number;
  isInitialized: boolean;
  lastUpdated: string;
}

export interface DocumentInfo {
  id: number;
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  author?: string;
  filePath: string;
  fileSize: number;
  uploadDate: string;
  status: 'processing' | 'completed' | 'error';
}

export interface SearchRequest {
  query: string;
  limit?: number;
  filters?: {
    tags?: string[];
    author?: string;
    dateRange?: {
      start: string;
      end: string;
    };
  };
}

export interface SearchResult {
  id: number;
  documentId: number;
  content: string;
  score: number;
  metadata: {
    title: string;
    author?: string;
    tags?: string[];
  };
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  processingTime: number;
}

/**
 * Initialize RAG module
 */
export async function initializeRAG(config: {
  embedding: EmbeddingConfig;
  llm: LlmCongfig;
}): Promise<RAGResponse> {
  return await windowInvoke(RAG_INITIALIZE, config);
}

/**
 * Get RAG statistics
 */
export async function getRAGStats(): Promise<RAGResponse<RAGStats>> {
  return await windowInvoke(RAG_GET_STATS, {});
}

/**
 * Process a RAG query
 */
export async function processRAGQuery(query: {
  query: string;
  options?: any;
}): Promise<RAGResponse> {
  return await windowInvoke(RAG_QUERY, query);
}

/**
 * Upload a document
 */
export async function uploadDocument(options: {
  filePath: string;
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  author?: string;
}): Promise<RAGResponse<DocumentInfo>> {
  return await windowInvoke(RAG_UPLOAD_DOCUMENT, options);
}

/**
 * Get all documents
 */
export async function getDocuments(filters?: any): Promise<RAGResponse<DocumentInfo[]>> {
  return await windowInvoke(RAG_GET_DOCUMENTS, filters);
}

/**
 * Get a specific document
 */
export async function getDocument(id: number): Promise<RAGResponse<DocumentInfo>> {
  return await windowInvoke(RAG_GET_DOCUMENT, { id });
}

/**
 * Update document metadata
 */
export async function updateDocument(id: number, metadata: any): Promise<RAGResponse> {
  return await windowInvoke(RAG_UPDATE_DOCUMENT, { id, metadata });
}

/**
 * Delete a document
 */
export async function deleteDocument(id: number, deleteFile?: boolean): Promise<RAGResponse> {
  return await windowInvoke(RAG_DELETE_DOCUMENT, { id, deleteFile });
}

/**
 * Get document statistics
 */
export async function getDocumentStats(): Promise<RAGResponse> {
  return await windowInvoke(RAG_GET_DOCUMENT_STATS, {});
}

/**
 * Search documents
 */
export async function searchDocuments(request: SearchRequest): Promise<RAGResponse<SearchResponse>> {
  return await windowInvoke(RAG_SEARCH, request);
}

/**
 * Get search suggestions
 */
export async function getSearchSuggestions(query: string, limit?: number): Promise<RAGResponse<string[]>> {
  return await windowInvoke(RAG_GET_SUGGESTIONS, { query, limit });
}

/**
 * Get search analytics
 */
export async function getSearchAnalytics(): Promise<RAGResponse> {
  return await windowInvoke(RAG_GET_SEARCH_ANALYTICS, {});
}

/**
 * Update embedding model
 */
export async function updateEmbeddingModel(config: {
  provider: string;
  model: string;
  apiKey?: string;
  url?: string;
}): Promise<RAGResponse> {
  return await windowInvoke(RAG_UPDATE_EMBEDDING_MODEL, config);
}

/**
 * Get available models
 */
export async function getAvailableModels(): Promise<RAGResponse<string[]>> {
  return await windowInvoke(RAG_GET_AVAILABLE_MODELS, {});
}

/**
 * Test embedding service
 */
export async function testEmbeddingService(): Promise<RAGResponse> {
  return await windowInvoke(RAG_TEST_EMBEDDING_SERVICE, {});
}

/**
 * Test RAG pipeline
 */
export async function testRAGPipeline(): Promise<RAGResponse> {
  return await windowInvoke(RAG_TEST_PIPELINE, {});
}

/**
 * Clear all caches
 */
export async function clearRAGCache(): Promise<RAGResponse> {
  return await windowInvoke(RAG_CLEAR_CACHE, {});
}

/**
 * Cleanup RAG resources
 */
export async function cleanupRAG(): Promise<RAGResponse> {
  return await windowInvoke(RAG_CLEANUP, {});
}
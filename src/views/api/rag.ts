import { windowInvoke, windowInvokeBinary, windowSend, windowSendBinary, windowReceive } from '@/views/utils/apirequest';
import { EmbeddingConfig, LlmCongfig, SaveTempFileResponse, ChunkAndEmbedResponse, CommonMessage } from '@/entityTypes/commonType';
import { ModelInfo } from '@/api/ragConfigApi';
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
  RAG_CLEANUP,
  RAG_CHUNK_AND_EMBED_DOCUMENT,
  RAG_DOWNLOAD_DOCUMENT,
  RAG_GET_DOCUMENT_ERROR_LOG,
  SHOW_OPEN_DIALOG,
  GET_FILE_STATS,
  SAVE_TEMP_FILE,
  SAVE_TEMP_FILE_PROGRESS,
  SAVE_TEMP_FILE_COMPLETE
} from '@/config/channellist';
import { DocumentMetadata } from '@/entityTypes/metadataType';
import { RagStatsResponse } from '@/entityTypes/commonType';
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
  fileType?: string;
  uploadDate: string;
  status: 'processing' | 'completed' | 'error';
  processingStatus?: string;
  log?: string; // Error log file path
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

// Progress event types for file upload
export interface FileUploadProgress {
  progress: number;
  message: string;
  fileName: string;
}

export interface FileUploadComplete {
  status: boolean;
  msg: string;
  data: SaveTempFileResponse;
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
export async function getRAGStats(): Promise<CommonMessage<RagStatsResponse>> {
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
export async function getDocuments(filters?: any): Promise<DocumentInfo[]> {
  const response = await windowInvoke(RAG_GET_DOCUMENTS, filters);
  if (response) {
    return response;
  }
  return [];
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
 * @param id - Document ID to delete
 * @param deleteFile - Whether to also delete the physical file and vector index (default: true)
 */
export async function deleteDocument(id: number, deleteFile: boolean = true): Promise<RAGResponse> {
  try {      
    await windowInvoke(RAG_DELETE_DOCUMENT, { id, deleteFile });
    return {
      success: true,
      message: ''
    };
  } catch (error) {
    console.error('Error deleting document:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
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
 * @returns Object with modelName and dimension if successful, null otherwise
 */
export async function updateEmbeddingModel(modelName: string): Promise<{ modelName: string; dimension: number } | null> {
  const response = await windowInvoke(RAG_UPDATE_EMBEDDING_MODEL, { model: modelName });
  
  return response || null;
}

/**
 * Get available embedding models
 */
export async function getAvailableEmbeddingModels(): Promise<RAGResponse<ModelInfo[]>> {
  const response = await windowInvoke(RAG_GET_AVAILABLE_MODELS, {});
  if (response) {
    // Transform the response data to match our expected format
    const modelsData = response;
    const modelsArray: ModelInfo[] = Object.values(modelsData.models || {});
    
    return {
      success: response.status,
      data: modelsArray,
      message: response.msg
    };
  }
  return {
    success: false,
    data: [],
    message: 'Failed to get available models'
  };
}

/**
 * Get available embedding models with default model info
 */
export async function getAvailableEmbeddingModelsWithDefault(): Promise<RAGResponse<{ models: ModelInfo[], defaultModel: string }>> {
  const response = await windowInvoke(RAG_GET_AVAILABLE_MODELS, {});
  if (response) {
    const modelsData = response;
    const modelsArray: ModelInfo[] = Object.values(modelsData.models || {});
    
    return {
      success: response.status,
      data: {
        models: modelsArray,
        defaultModel: modelsData.default_model || ''
      },
      message: response.msg
    };
  }
  return {
    success: false,
    data: { models: [], defaultModel: '' },
    message: 'Failed to get available models'
  };
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

// File Dialog API Functions

/**
 * Show native file dialog
 */
export async function showOpenDialog(options: {
  properties: string[];
  filters: Array<{ name: string; extensions: string[] }>;
}): Promise<{ canceled: boolean; filePaths: string[] }> {
  return await windowInvoke(SHOW_OPEN_DIALOG, options);
}

/**
 * Get file statistics
 */
export async function getFileStats(filePath: string): Promise<{
  size: number;
  mtime: Date;
  isFile: boolean;
  isDirectory: boolean;
}> {
  return await windowInvoke(GET_FILE_STATS, { filePath });
}

/**
 * Save temporary file with progress updates
 */
export async function saveTempFile(
  data: {
    fileName: string;
    buffer: Uint8Array;
    metadata?: {
      title?: string;
      description?: string;
      tags?: string[];
      author?: string;
    };
  },
  onProgress?: (progress: FileUploadProgress) => void,
  onComplete?: (result: FileUploadComplete) => void
): Promise<SaveTempFileResponse> {
  console.log("saveTempFile is ready");
  console.log(data);

  return new Promise((resolve, reject) => {
    // Set up progress listener
    const progressHandler = (progressData: any) => {
      try {
        const progress: FileUploadProgress = JSON.parse(progressData);
        if (onProgress) {
          onProgress(progress);
        }
      } catch (error) {
        console.error('Error parsing progress data:', error);
      }
    };

    // Set up completion listener
    const completeHandler = (completeData: any) => {
      try {
        const result: FileUploadComplete = JSON.parse(completeData);
        
        if (onComplete) {
          onComplete(result);
        }
        
        if (result.status) {
          resolve(result.data);
        } else {
          reject(new Error(result.msg));
        }
      } catch (error) {
        console.error('Error parsing completion data:', error);
        reject(error);
      }
    };

    // Register event listeners using the project's API
    windowReceive(SAVE_TEMP_FILE_PROGRESS, progressHandler);
    windowReceive(SAVE_TEMP_FILE_COMPLETE, completeHandler);

    // Send the file data to main process using binary send method
    windowSendBinary(SAVE_TEMP_FILE, data);
  });
}

/**
 * Select files using native dialog
 */
export async function selectFilesNative(): Promise<(File & { path: string })[]> {
  try {
    const result = await showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'txt', 'doc', 'docx', 'md', 'html', 'htm'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      // Convert file paths to File objects for consistency
      const files = await Promise.all(result.filePaths.map(async (filePath: string) => {
        const fileName = filePath.split('/').pop() || 'unknown';
        const stats = await getFileStats(filePath);
        
        // Create a File-like object with the actual file path
        return {
          name: fileName,
          path: filePath, // This is the key difference - we have the actual path
          size: stats.size,
          type: getFileType(fileName),
          lastModified: stats.mtime.getTime()
        } as File & { path: string };
      }));
      
      return files;
    }
    return [];
  } catch (error) {
    console.error('Error selecting files:', error);
    throw new Error('Failed to select files');
  }
}

/**
 * Copy file to temporary location with progress updates
 */
export async function copyFileToTemp(
  file: File, 
  metadata?: DocumentMetadata,
  onProgress?: (progress: FileUploadProgress) => void,
  onComplete?: (result: FileUploadComplete) => void
): Promise<SaveTempFileResponse> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // Convert file to buffer
        const arrayBuffer = reader.result as ArrayBuffer;
        const buffer = new Uint8Array(arrayBuffer);
        console.log("buffer is ready");
        console.log(buffer);
        // Generate temporary file path
        const tempFileName = `rag_upload_${Date.now()}_${file.name}`;
        console.log("tempFileName is ready");
        console.log(tempFileName);
        
        // Prepare metadata with defaults
        const fileMetadata = {
          title: metadata?.title || file.name.replace(/\.[^/.]+$/, ''),
          description: metadata?.description || `Uploaded document: ${file.name}`,
          tags: metadata?.tags || ['uploaded', 'knowledge'],
          author: metadata?.author || 'User',
          // model_name: metadata?.model_name
        };
        
        // Use API to save file to temp location with progress callbacks
        const saveResult = await saveTempFile({
          fileName: tempFileName,
          buffer: buffer,
          metadata: fileMetadata
        }, onProgress, onComplete);
        console.log("saveResult is ready");
        console.log(saveResult);
        
        // Check if database save was successful
        if (saveResult.databaseError) {
          console.warn('Database save failed:', saveResult.databaseError);
        } else if (saveResult.databaseSaved) {
          console.log('Document successfully saved to database');
        }
        
        resolve(saveResult);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Get file MIME type from extension
 */
function getFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'md': 'text/markdown',
    'html': 'text/html',
    'htm': 'text/html'
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Chunk and embed a document
 * 
 * This function takes a document ID from the frontend and performs two operations:
 * 1. Chunks the document into smaller pieces for better search and retrieval
 * 2. Generates embeddings for each chunk to enable semantic search
 * 
 * The chunking configuration is automatically fetched from the remote server.
 * If the remote server is unavailable, default configuration will be used.
 * 
 * @param documentId - Document ID to chunk and embed
 * @param modelName - Embedding model name to use
 * @returns Promise with chunking and embedding results
 * 
 * @example
 * ```typescript
 * // Basic usage - chunking config fetched from remote server
 * const result = await chunkAndEmbedDocument(123, 'Qwen/Qwen3-Embedding-4B');
 * 
 * if (result.success) {
 *   console.log(`Created ${result.data.chunksCreated} chunks`);
 *   console.log(`Generated ${result.data.embeddingsGenerated} embeddings`);
 * }
 * ```
 */
export async function chunkAndEmbedDocument(
  documentId: number,
  // modelName: string
): Promise<RAGResponse<ChunkAndEmbedResponse>> {
  try {
    const requestData = {
      documentId,
      // modelName
    };

    const response = await windowInvoke(RAG_CHUNK_AND_EMBED_DOCUMENT, requestData);
    
    return {
      success: true,
      data: response.data,
      message: ""
    };
  } catch (error) {
    console.error('Error chunking and embedding document:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Download a document
 * @param documentId - Document ID to download
 * @param fileName - File name for the download
 * @returns Download result
 */
export async function downloadDocument(documentId: number, fileName: string): Promise<RAGResponse<{ downloaded: boolean }>> {
  try {
    const requestData = {
      documentId,
      fileName
    };

    const response = await windowInvoke(RAG_DOWNLOAD_DOCUMENT, requestData);
    
    return {
      success: true,
      data: response,
      message: ""
    };
  } catch (error) {
    console.error('Error downloading document:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Get document error log
 * @param documentId - Document ID to get error log for
 * @returns Error log content or null if no log exists
 */
export async function getDocumentErrorLog(documentId: number): Promise<RAGResponse<string | null>> {
  try {
    const requestData = { documentId };
    const response = await windowInvoke(RAG_GET_DOCUMENT_ERROR_LOG, requestData);
    
    return {
      success: true,
      data: response,
      message: ""
    };
  } catch (error) {
    console.error('Error getting document error log:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}
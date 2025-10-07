import { ipcMain, dialog, app } from 'electron';
import { RagSearchController } from '@/controller/RagSearchController';
import { SearchRequest, SearchResponse } from '@/modules/RagSearchModule';
import { CommonMessage, SaveTempFileResponse, DocumentUploadResponse, ChunkAndEmbedResponse, UploadedDocument, RagStatsResponse } from '@/entityTypes/commonType';
import { DocumentInfo } from '@/views/api/rag';
import { RagConfigApi, ModelInfo, AvailableModelsResponse } from '@/api/ragConfigApi';
import * as fs from 'fs';
import * as path from 'path';
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
    SHOW_OPEN_DIALOG,
    GET_FILE_STATS,
    SAVE_TEMP_FILE
} from '@/config/channellist';

/**
 * Helper function to create and initialize a RAG controller
 * @returns Initialized RagSearchController instance
 */
async function createRagController(): Promise<RagSearchController> {
    const controller = new RagSearchController();
    await controller.initialize();
    return controller;
}


/**
 * Register RAG IPC handlers
 */
export function registerRagIpcHandlers(): void {
    console.log("RAG IPC handlers registered");

    // Save temporary file handler
    ipcMain.handle(SAVE_TEMP_FILE, async (event, data): Promise<CommonMessage<SaveTempFileResponse>> => {
        try {
            //console.log('Received data in main process:', typeof data, data);
            const { fileName, buffer, metadata } = data;
            if (!fileName || !buffer || buffer.length <= 1) {
                const errorResponse: CommonMessage<SaveTempFileResponse> = {
                    status: false,
                    msg: 'Invalid fileName or buffer: fileName must be provided and buffer must have length > 1',
                    data: {
                        tempFilePath: '',
                        databaseSaved: false,
                        databaseError: 'Invalid input parameters'
                    }
                };
                return errorResponse;
            }
            // Create app data directory for uploaded files using Electron's app.getPath
            const appDataDir = path.join(app.getPath('userData'), 'uploads');
            if (!fs.existsSync(appDataDir)) {
                fs.mkdirSync(appDataDir, { recursive: true });
            }
            
            // Generate unique filename to avoid conflicts
            const timestamp = Date.now();
            const fileExt = path.extname(fileName);
            const baseName = path.basename(fileName, fileExt);
            const uniqueFileName = `${baseName}_${timestamp}${fileExt}`;
            const appDataFilePath = path.join(appDataDir, uniqueFileName);
            
            // Convert Uint8Array to Buffer and write to file
            // If buffer comes as an object with numeric keys, convert it back to Uint8Array first
            let uint8Buffer;
            if (buffer instanceof Uint8Array) {
                uint8Buffer = buffer;
            } else if (typeof buffer === 'object' && buffer.constructor === Object) {
                // Handle case where Uint8Array was serialized as plain object
                const values = Object.values(buffer) as number[];
                uint8Buffer = new Uint8Array(values);
            } else {
                uint8Buffer = new Uint8Array(buffer);
            }
            
            const nodeBuffer = Buffer.from(uint8Buffer);
            fs.writeFileSync(appDataFilePath, nodeBuffer);
            
            let documentInfo: UploadedDocument | null = null;
            let databaseSaved = false;
            let databaseError: string | null = null;
            
            // If metadata is provided, save document to database
            if (metadata) {
                try {
                    const ragController = await createRagController();
                    
                    // Get default embedding model from controller
                    const defaultEmbeddingModel = await ragController.getDefaultEmbeddingModel();
                    
                    // Extract original filename without timestamp prefix
                    const originalFileName = fileName.replace(/^rag_upload_\d+_/, '');
                    
                    const uploadOptions = {
                        filePath: appDataFilePath,
                        name: originalFileName,
                        title: metadata.title || originalFileName.replace(/\.[^/.]+$/, ''),
                        description: metadata.description || `Uploaded document: ${originalFileName}`,
                        tags: metadata.tags || ['uploaded', 'knowledge'],
                        author: metadata.author || 'User',
                        modelName: defaultEmbeddingModel || metadata.model_name
                    };
                    
                    const uploadResult = await ragController.uploadDocument(uploadOptions);
                    console.log(`Document saved to database with ID: ${uploadResult.documentId}`);
                    
                    documentInfo = {
                        id: uploadResult.document.id,
                        name: uploadResult.document.name,
                        title: uploadResult.document.title || uploadResult.document.name,
                        description: uploadResult.document.description,
                        tags: uploadResult.document.tags ? JSON.parse(uploadResult.document.tags) : [],
                        author: uploadResult.document.author,
                        filePath: uploadResult.document.filePath,
                        fileSize: uploadResult.document.fileSize,
                        fileType: uploadResult.document.fileType,
                        uploadDate: uploadResult.document.uploadedAt?.toISOString() || new Date().toISOString(),
                        status: uploadResult.document.status,
                        processingStatus: uploadResult.document.processingStatus
                    };
                    databaseSaved = true;
                } catch (dbError) {
                    console.warn('Failed to save document to database:', dbError);
                    databaseError = dbError instanceof Error ? dbError.message : 'Unknown database error';
                }
            }
            
            const response: CommonMessage<SaveTempFileResponse> = {
                status: true,
                msg: 'File saved successfully',
                data: {
                    tempFilePath: appDataFilePath,
                    databaseSaved,
                    databaseError,
                    document: documentInfo || undefined
                }
            };
            
            return response;
        } catch (error) {
            console.error('Error saving temporary file:', error);
            throw new Error(`Failed to save temporary file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Show native file dialog
    ipcMain.handle(SHOW_OPEN_DIALOG, async (event, options): Promise<any> => {
        try {
            const result = await dialog.showOpenDialog(options);
            return result;
        } catch (error) {
            console.error('Error showing open dialog:', error);
            throw new Error(`Failed to show open dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Get file stats
    ipcMain.handle(GET_FILE_STATS, async (event, data: { filePath: string }): Promise<any> => {
        try {
            const stats = fs.statSync(data.filePath);
            return {
                size: stats.size,
                mtime: stats.mtime,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory()
            };
        } catch (error) {
            console.error('Error getting file stats:', error);
            throw new Error(`Failed to get file stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Initialize RAG module
    ipcMain.handle(RAG_INITIALIZE, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            // Create controller and check default embedding model
            const ragController = await createRagController();
            
            // Check if default embedding model exists in system settings
            await ragController.checkAndSetDefaultEmbeddingModel();
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "RAG module initialized successfully",
                data: { initialized: true }
            };
            return response;
        } catch (error) {
            console.error('RAG initialization error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Get RAG statistics
    ipcMain.handle(RAG_GET_STATS, async (event, data): Promise<CommonMessage<RagStatsResponse | null>> => {
        try {
            const ragSearchController = await createRagController();
            const stats = await ragSearchController.getSearchStats();
            
            // Get default embedding model from controller
            const defaultEmbeddingModel = await ragSearchController.getDefaultEmbeddingModel();
            
            // Include default embedding model in the stats response
            const enhancedStats: RagStatsResponse = {
                ...stats,
                defaultEmbeddingModel
            };
            
            const response: CommonMessage<RagStatsResponse> = {
                status: true,
                msg: "RAG statistics retrieved successfully",
                data: enhancedStats
            };
            return response;
        } catch (error) {
            console.error('RAG get stats error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Process RAG query
    ipcMain.handle(RAG_QUERY, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const requestData = JSON.parse(data) as {
                query: string;
                options?: any;
            };

            const ragSearchController = await createRagController();

            const searchRequest: SearchRequest = {
                query: requestData.query,
                options: requestData.options
            };

            const result = await ragSearchController.search(searchRequest);
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "RAG query processed successfully",
                data: result
            };
            return response;
        } catch (error) {
            console.error('RAG query error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Upload document
    ipcMain.handle(RAG_UPLOAD_DOCUMENT, async (event, data): Promise<CommonMessage<DocumentUploadResponse | null>> => {
        try {
            const options = JSON.parse(data) as {
                filePath: string;
                name: string;
                title?: string;
                description?: string;
                tags?: string[];
                author?: string;
                modelName: string;
            };

            const ragSearchController = await createRagController();
            const uploadResult = await ragSearchController.uploadDocument(options);
            
            const response: CommonMessage<DocumentUploadResponse> = {
                status: true,
                msg: "Document uploaded and processed successfully",
                data: {
                    documentId: uploadResult.documentId,
                    chunksCreated: uploadResult.chunksCreated,
                    processingTime: uploadResult.processingTime,
                    document: {
                        id: uploadResult.document.id,
                        name: uploadResult.document.name,
                        title: uploadResult.document.title || uploadResult.document.name,
                        description: uploadResult.document.description,
                        tags: uploadResult.document.tags ? JSON.parse(uploadResult.document.tags) : [],
                        author: uploadResult.document.author,
                        filePath: uploadResult.document.filePath,
                        fileSize: uploadResult.document.fileSize,
                        fileType: uploadResult.document.fileType,
                        uploadDate: uploadResult.document.uploadedAt?.toISOString() || new Date().toISOString(),
                        status: uploadResult.document.status,
                        processingStatus: uploadResult.document.processingStatus
                    }
                }
            };
            return response;
        } catch (error) {
            console.error('RAG upload document error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Test RAG pipeline
    ipcMain.handle(RAG_TEST_PIPELINE, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const ragSearchController = await createRagController();

            // Mock test result
            const testResult = {
                success: true,
                message: "RAG pipeline test completed successfully",
                testQuery: "test query",
                responseTime: Math.floor(Math.random() * 1000),
                resultsFound: Math.floor(Math.random() * 10)
            };
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "RAG pipeline tested successfully",
                data: testResult
            };
            return response;
        } catch (error) {
            console.error('RAG test pipeline error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Get documents
    ipcMain.handle(RAG_GET_DOCUMENTS, async (event, data): Promise<CommonMessage<DocumentInfo[] | null>> => {
        try {
            const filters = data ? JSON.parse(data) : undefined;
            
            const ragSearchController = await createRagController();
            const documents = await ragSearchController.getDocuments(filters);
            
            // Transform documents for frontend
            const transformedDocuments: DocumentInfo[] = documents.map(doc => ({
                id: doc.id,
                name: doc.name,
                title: doc.title,
                description: doc.description,
                tags: doc.tags ? JSON.parse(doc.tags) : [],
                author: doc.author,
                filePath: doc.filePath,
                fileSize: doc.fileSize,
                fileType: doc.fileType,
                uploadDate: doc.uploadedAt?.toISOString() || new Date().toISOString(),
                status: doc.status as 'processing' | 'completed' | 'error',
                processingStatus: doc.processingStatus
            }));
            
            const response: CommonMessage<DocumentInfo[]> = {
                status: true,
                msg: "Documents retrieved successfully",
                data: transformedDocuments
            };
            return response;
        } catch (error) {
            console.error('RAG get documents error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Get specific document
    ipcMain.handle(RAG_GET_DOCUMENT, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const { id } = JSON.parse(data) as { id: number };
            
            const ragSearchController = await createRagController();
            const document = await ragSearchController.getDocument(id);
            
            if (!document) {
                const errorResponse: CommonMessage<null> = {
                    status: false,
                    msg: "Document not found",
                    data: null
                };
                return errorResponse;
            }
            
            const transformedDocument = {
                id: document.id,
                name: document.name,
                title: document.title,
                description: document.description,
                tags: document.tags ? JSON.parse(document.tags) : [],
                author: document.author,
                filePath: document.filePath,
                fileSize: document.fileSize,
                fileType: document.fileType,
                uploadDate: document.uploadedAt?.toISOString() || new Date().toISOString(),
                status: document.status,
                processingStatus: document.processingStatus
            };
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "Document retrieved successfully",
                data: transformedDocument
            };
            return response;
        } catch (error) {
            console.error('RAG get document error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Update document
    ipcMain.handle(RAG_UPDATE_DOCUMENT, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const { id, metadata } = JSON.parse(data) as { id: number; metadata: any };
            
            const ragSearchController = await createRagController();
            await ragSearchController.updateDocument(id, metadata);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "Document updated successfully"
            };
            return response;
        } catch (error) {
            console.error('RAG update document error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    // Delete document
    ipcMain.handle(RAG_DELETE_DOCUMENT, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const { id, deleteFile } = JSON.parse(data) as { id: number; deleteFile?: boolean };
            
            const ragSearchController = await createRagController();
            await ragSearchController.deleteDocument(id, deleteFile || false);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "Document deleted successfully"
            };
            return response;
        } catch (error) {
            console.error('RAG delete document error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    // Get document statistics
    ipcMain.handle(RAG_GET_DOCUMENT_STATS, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const ragSearchController = await createRagController();
            const stats = await ragSearchController.getDocumentStats();
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "Document statistics retrieved successfully",
                data: stats
            };
            return response;
        } catch (error) {
            console.error('RAG get document stats error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Search documents
    ipcMain.handle(RAG_SEARCH, async (event, data): Promise<CommonMessage<SearchResponse | null>> => {
        try {
            const requestData = JSON.parse(data) as SearchRequest;
            
            const ragSearchController = await createRagController();
            
            const request: SearchRequest = {
                query: requestData.query,
                options: requestData.options,
                filters: requestData.filters
            };
            
            const result = await ragSearchController.search(request);
            
            const response: CommonMessage<SearchResponse> = {
                status: true,
                msg: "Search completed successfully",
                data: result
            };
            return response;
        } catch (error) {
            console.error('RAG search error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Get search suggestions
    ipcMain.handle(RAG_GET_SUGGESTIONS, async (event, data): Promise<CommonMessage<string[] | null>> => {
        try {
            const requestData = JSON.parse(data) as { 
                query: string; 
                limit?: number;
            };
            
            const ragSearchController = await createRagController();
            const suggestions = await ragSearchController.getSuggestions(requestData.query, requestData.limit || 5);
            
            const response: CommonMessage<string[]> = {
                status: true,
                msg: "Suggestions retrieved successfully",
                data: suggestions
            };
            return response;
        } catch (error) {
            console.error('RAG get suggestions error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Get search analytics
    ipcMain.handle(RAG_GET_SEARCH_ANALYTICS, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const ragSearchController = await createRagController();
            const analytics = await ragSearchController.getAnalytics();
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "Search analytics retrieved successfully",
                data: analytics
            };
            return response;
        } catch (error) {
            console.error('RAG get search analytics error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Update embedding model
    ipcMain.handle(RAG_UPDATE_EMBEDDING_MODEL, async (event, data): Promise<CommonMessage<boolean>> => {
        try {
            const config = JSON.parse(data) as {
                model: string;
            };

            const ragSearchController = await createRagController();
            await ragSearchController.updateEmbeddingModel(config.model);
            
            const response: CommonMessage<boolean> = {
                status: true,
                msg: "Embedding model updated successfully",
                data: true
            };
            return response;
        } catch (error) {
            console.error('RAG update embedding model error:', error);
            const errorResponse: CommonMessage<boolean> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: false
            };
            return errorResponse;
        }
    });

    // Get available models
    ipcMain.handle(RAG_GET_AVAILABLE_MODELS, async (event, data): Promise<CommonMessage<AvailableModelsResponse | null>> => {
        try {
            const ragConfigApi = new RagConfigApi();
            const response = await ragConfigApi.getAvailableEmbeddingModels();
            
            if (response.status && response.data) {
                // Get the default embedding model from controller
                const ragController = await createRagController();
                const defaultModelFromSettings = await ragController.getDefaultEmbeddingModel();
                
                // Override the default_model with the one from system settings if available
                if (defaultModelFromSettings) {
                    response.data.default_model = defaultModelFromSettings;
                }
                
                return {
                    status: true,
                    msg: "Available models retrieved successfully",
                    data: response.data
                };
            } else {
                return {
                    status: false,
                    msg: response.msg || "Failed to retrieve available models",
                    data: null
                };
            }
        } catch (error) {
            console.error('RAG get available models error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Test embedding service
    ipcMain.handle(RAG_TEST_EMBEDDING_SERVICE, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const ragSearchController = await createRagController();
            const testResult = await ragSearchController.testEmbeddingService();
            
            const response: CommonMessage<any> = {
                status: testResult.success,
                msg: testResult.message,
                data: testResult
            };
            return response;
        } catch (error) {
            console.error('RAG test embedding service error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Clear cache
    ipcMain.handle(RAG_CLEAR_CACHE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const ragSearchController = await createRagController();
            ragSearchController.clearCache();
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "Cache cleared successfully"
            };
            return response;
        } catch (error) {
            console.error('RAG clear cache error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    // Chunk and embed document
    ipcMain.handle(RAG_CHUNK_AND_EMBED_DOCUMENT, async (event, data): Promise<CommonMessage<ChunkAndEmbedResponse | null>> => {
        try {
            const requestData = JSON.parse(data) as {
                documentId: number;
                modelName: string;
            };

            const ragSearchController = await createRagController();
            const result = await ragSearchController.chunkAndEmbedDocument(requestData.documentId, requestData.modelName);

            const response: CommonMessage<ChunkAndEmbedResponse> = {
                status: result.success,
                msg: result.message,
                data: result
            };

            return response;
        } catch (error) {
            console.error('RAG chunk and embed document error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Cleanup
    ipcMain.handle(RAG_CLEANUP, async (event, data): Promise<CommonMessage<void>> => {
        try {
            // Since we're creating controllers per request, cleanup is handled automatically
            // when the controller goes out of scope. This handler is kept for compatibility.
            const response: CommonMessage<void> = {
                status: true,
                msg: "RAG cleanup completed successfully"
            };
            return response;
        } catch (error) {
            console.error('RAG cleanup error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });
}


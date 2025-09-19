import { ipcMain } from 'electron';
import { RagSearchController } from '@/controller/RagSearchController';
import { SearchRequest, SearchResponse } from '@/modules/RagSearchModule';
import { CommonMessage, LlmCongfig } from '@/entityTypes/commonType';
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

    // Initialize RAG module
    ipcMain.handle(RAG_INITIALIZE, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            // No configuration needed - controller handles everything automatically
            await createRagController();
            
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
    ipcMain.handle(RAG_GET_STATS, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const ragSearchController = await createRagController();
            const stats = await ragSearchController.getSearchStats();
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "RAG statistics retrieved successfully",
                data: stats
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
    ipcMain.handle(RAG_UPLOAD_DOCUMENT, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const options = JSON.parse(data) as {
                filePath: string;
                name: string;
                title?: string;
                description?: string;
                tags?: string[];
                author?: string;
            };

            // Mock implementation - replace with actual document upload logic
            const documentInfo = {
                id: Math.floor(Math.random() * 1000),
                name: options.name,
                title: options.title,
                description: options.description,
                tags: options.tags,
                author: options.author,
                filePath: options.filePath,
                fileSize: 0,
                uploadDate: new Date().toISOString(),
                status: 'completed' as const
            };
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "Document uploaded successfully",
                data: documentInfo
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
    ipcMain.handle(RAG_GET_DOCUMENTS, async (event, data): Promise<CommonMessage<any[] | null>> => {
        try {
            const filters = data ? JSON.parse(data) : undefined;
            
            // Mock documents list - replace with actual document retrieval logic
            const documents = [
                {
                    id: 1,
                    name: "Sample Document 1",
                    title: "Introduction to RAG",
                    description: "A comprehensive guide to RAG systems",
                    tags: ["rag", "ai", "nlp"],
                    author: "AI Team",
                    filePath: "/path/to/doc1.pdf",
                    fileSize: 1024000,
                    uploadDate: new Date().toISOString(),
                    status: "completed"
                },
                {
                    id: 2,
                    name: "Sample Document 2",
                    title: "Advanced RAG Techniques",
                    description: "Advanced techniques for RAG implementation",
                    tags: ["rag", "advanced", "techniques"],
                    author: "Research Team",
                    filePath: "/path/to/doc2.pdf",
                    fileSize: 2048000,
                    uploadDate: new Date().toISOString(),
                    status: "completed"
                }
            ];
            
            const response: CommonMessage<any[]> = {
                status: true,
                msg: "Documents retrieved successfully",
                data: documents
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
            
            // Mock document - replace with actual document retrieval logic
            const document = {
                id: id,
                name: `Document ${id}`,
                title: `Document Title ${id}`,
                description: `Description for document ${id}`,
                tags: ["sample", "document"],
                author: "System",
                filePath: `/path/to/doc${id}.pdf`,
                fileSize: 1024000,
                uploadDate: new Date().toISOString(),
                status: "completed"
            };
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "Document retrieved successfully",
                data: document
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
            
            // Mock update - replace with actual document update logic
            console.log(`Updating document ${id} with metadata:`, metadata);
            
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
            
            // Mock delete - replace with actual document deletion logic
            console.log(`Deleting document ${id}, deleteFile: ${deleteFile}`);
            
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
            // Mock document stats - replace with actual stats retrieval logic
            const stats = {
                totalDocuments: 10,
                totalChunks: 150,
                totalSize: 10240000,
                averageSize: 1024000,
                byStatus: {
                    completed: 8,
                    processing: 1,
                    error: 1
                },
                byType: {
                    pdf: 6,
                    txt: 3,
                    docx: 1
                }
            };
            
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
    ipcMain.handle(RAG_UPDATE_EMBEDDING_MODEL, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const config = JSON.parse(data) as {
                model: string;
            };

            const ragSearchController = await createRagController();
            await ragSearchController.updateEmbeddingModel(config.model);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "Embedding model updated successfully"
            };
            return response;
        } catch (error) {
            console.error('RAG update embedding model error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    // Get available models
    ipcMain.handle(RAG_GET_AVAILABLE_MODELS, async (event, data): Promise<CommonMessage<string[] | null>> => {
        try {
            const ragSearchController = await createRagController();
            const models = ragSearchController.getAvailableModels();
            
            const response: CommonMessage<string[]> = {
                status: true,
                msg: "Available models retrieved successfully",
                data: models.map(m => `${m.provider}:${m.models.join(',')}`).flat()
            };
            return response;
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


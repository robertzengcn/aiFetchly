import { RagSearchModule, SearchRequest, SearchResponse, DocumentUploadResponse } from '@/modules/RagSearchModule';
import { DocumentUploadOptions } from '@/modules/RAGDocumentModule';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { RagConfigApi, ChunkingConfig } from '@/api/ragConfigApi';
import { SystemSettingModel } from '@/model/SystemSetting.model';
// import { SystemSettingGroupEntity } from '@/entity/SystemSettingGroup.entity';
import { SystemSettingGroupModel } from '@/model/SystemSettingGroup.model';
import { SystemSettingModule } from '@/modules/SystemSettingModule';
import { SystemSettingGroupModule } from '@/modules/SystemSettingGroupModule';

export class RagSearchController {
    private ragSearchModule: RagSearchModule;
    private ragConfigApi: RagConfigApi;
    private systemSettingModel: SystemSettingModel;
    private systemSettingGroupModel: SystemSettingGroupModel;
    private systemSettingModule: SystemSettingModule;
    private systemSettingGroupModule: SystemSettingGroupModule; 
    constructor() {
        this.ragSearchModule = new RagSearchModule();
        this.ragConfigApi = new RagConfigApi();
        // Initialize system setting models with default database path
        this.systemSettingModule = new SystemSettingModule();
        this.systemSettingGroupModule = new SystemSettingGroupModule();
    }

    /**
     * Initialize the search controller
     * No parameters needed - configuration is retrieved automatically
     */
    async initialize(): Promise<void> {
        await this.ragSearchModule.initialize();
    }

    /**
     * Perform a search
     * @param request - Search request
     * @returns Search response
     */
    async search(request: SearchRequest): Promise<SearchResponse> {
        return await this.ragSearchModule.search(request);
    }

    /**
     * Get search suggestions
     * @param query - Partial query
     * @param limit - Number of suggestions
     * @returns Array of suggestions
     */
    async getSuggestions(query: string, limit: number = 5): Promise<string[]> {
        return await this.ragSearchModule.getSuggestions(query, limit);
    }

    /**
     * Get search analytics
     * @returns Search analytics
     */
    async getAnalytics(): Promise<any> {
        return await this.ragSearchModule.getAnalytics();
    }

    /**
     * Get performance metrics
     * @returns Performance metrics
     */
    getPerformanceMetrics(): any {
        return this.ragSearchModule.getPerformanceMetrics();
    }

    /**
     * Clear search cache
     */
    clearCache(): void {
        this.ragSearchModule.clearCache();
    }


    // private determineProviderFromModel(model: string): string {
    //     if (model.includes('text-embedding')) {
    //         return 'openai';
    //     } else if (model.includes('sentence-transformers')) {
    //         return 'huggingface';
    //     } else if (model.includes('nomic') || model.includes('llama')) {
    //         return 'ollama';
    //     }
    //     return 'openai';
    // }


    /**
     * Test embedding service
     * @returns Test result
     */
    async testEmbeddingService(): Promise<{
        success: boolean;
        message: string;
        dimensions?: number;
    }> {
        return await this.ragSearchModule.testEmbeddingService();
    }

    /**
     * Get search statistics
     * @returns Search statistics
     */
    async getSearchStats(): Promise<{
        totalDocuments: number;
        totalChunks: number;
        indexSize: number;
        averageChunkSize: number;
        embeddingModel: string;
        embeddingProvider: string;
    }> {
        return await this.ragSearchModule.getSearchStats();
    }

    /**
     * Upload and process a document
     * @param options - Document upload options
     * @returns Upload response
     */
    async uploadDocument(options: DocumentUploadOptions): Promise<DocumentUploadResponse> {
        return await this.ragSearchModule.uploadDocument(options);
    }

    /**
     * Get all documents
     * @param filters - Optional filters
     * @returns Array of documents
     */
    async getDocuments(filters?: {
        status?: string;
        processingStatus?: string;
        author?: string;
        tags?: string[];
        dateRange?: { start: Date; end: Date };
    }): Promise<RAGDocumentEntity[]> {
        return await this.ragSearchModule.getDocuments(filters);
    }

    /**
     * Get a specific document by ID
     * @param id - Document ID
     * @returns Document entity
     */
    async getDocument(id: number): Promise<RAGDocumentEntity | null> {
        return await this.ragSearchModule.getDocument(id);
    }

    /**
     * Update document metadata
     * @param id - Document ID
     * @param metadata - Updated metadata
     */
    async updateDocument(id: number, metadata: {
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
        log?: string;
    }): Promise<void> {
        return await this.ragSearchModule.updateDocument(id, metadata);
    }

    /**
     * Delete a document
     * @param id - Document ID
     * @param deleteFile - Whether to delete the physical file
     */
    async deleteDocument(id: number, deleteFile: boolean = false): Promise<void> {
        return await this.ragSearchModule.deleteDocument(id, deleteFile);
    }

    /**
     * Download a document
     * @param id - Document ID to download
     * @returns Document file path
     */
    async downloadDocument(id: number): Promise<string> {
        const document = await this.getDocument(id);
        if (!document) {
            throw new Error('Document not found');
        }
        return document.filePath;
    }

    /**
     * Get document statistics
     * @returns Document statistics
     */
    async getDocumentStats(): Promise<{
        totalDocuments: number;
        totalChunks: number;
        totalSize: number;
        averageSize: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
    }> {
        return await this.ragSearchModule.getDocumentStats();
    }

    /**
     * Chunk a document into smaller pieces
     * @param documentId - Document ID to chunk
     * @param options - Chunking options
     * @returns Chunking result
     */
    async chunkDocument(documentId: number, options?: {
        chunkSize?: number;
        overlapSize?: number;
        strategy?: 'sentence' | 'paragraph' | 'semantic' | 'fixed';
        preserveWhitespace?: boolean;
        minChunkSize?: number;
    }): Promise<{
        documentId: number;
        chunksCreated: number;
        processingTime: number;
        success: boolean;
        message: string;
    }> {
        return await this.ragSearchModule.chunkDocument(documentId, options);
    }

    /**
     * Generate embeddings for document chunks
     * @param documentId - Document ID to generate embeddings for
     * @returns Embedding generation result
     */
    async generateDocumentEmbeddings(documentId: number, modelName: string,dimension: number): Promise<{
        documentId: number;
        chunksProcessed: number;
        processingTime: number;
        success: boolean;
        message: string;
    }> {
        return await this.ragSearchModule.generateDocumentEmbeddings(documentId, modelName,dimension);
    }

    /**
     * Chunk and embed a document (combined operation)
     * @param documentId - Document ID to process
     * @returns Combined processing result
     */
    async chunkAndEmbedDocument(documentId: number): Promise<{
        documentId: number;
        chunksCreated: number;
        embeddingsGenerated: number;
        processingTime: number;
        success: boolean;
        message: string;
        steps: {
            chunking: boolean;
            embedding: boolean;
        };
        chunkingResult?: {
            chunksCreated: number;
            processingTime: number;
            message: string;
        };
        embeddingResult?: {
            chunksProcessed: number;
            processingTime: number;
            message: string;
        };
    }> {
        const startTime = Date.now();
        const steps = { chunking: false, embedding: false };

        try {
            // Step 1: Get chunking configuration from remote server
            let chunkingOptions: ChunkingConfig | undefined;
            try {
                const configResponse = await this.ragConfigApi.getChunkingConfig();
                if (configResponse.status && configResponse.data) {
                    chunkingOptions = configResponse.data.default_config;
                    console.log('Using remote chunking configuration:', chunkingOptions);
                } else {
                    console.warn('Failed to get remote chunking config, using defaults');
                }
            } catch (configError) {
                console.warn('Error fetching chunking config from remote server:', configError);
                console.log('Using default chunking configuration');
            }

            // Step 2: Chunk the document
            const chunkResult = await this.chunkDocument(documentId, chunkingOptions);
            if (!chunkResult.success) {
                return {
                    documentId,
                    chunksCreated: 0,
                    embeddingsGenerated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: `Document chunking failed: ${chunkResult.message}`,
                    steps
                };
            }
            steps.chunking = true;
            const model = await this.getDefaultEmbeddingModel();
            if (!model) {
                throw new Error('Default embedding model not found');
            }

            // Step 3: Generate embeddings for the chunks
            const embedResult = await this.generateDocumentEmbeddings(documentId, model.modelName,model.dimension);
            if (!embedResult.success) {
                return {
                    documentId,
                    chunksCreated: chunkResult.chunksCreated,
                    embeddingsGenerated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: `Embedding generation failed: ${embedResult.message}`,
                    steps,
                    chunkingResult: {
                        chunksCreated: chunkResult.chunksCreated,
                        processingTime: chunkResult.processingTime,
                        message: chunkResult.message
                    }
                };
            }
            steps.embedding = true;

            return {
                documentId,
                chunksCreated: chunkResult.chunksCreated,
                embeddingsGenerated: embedResult.chunksProcessed,
                processingTime: Date.now() - startTime,
                success: true,
                message: 'Document chunked and embedded successfully',
                steps,
                chunkingResult: {
                    chunksCreated: chunkResult.chunksCreated,
                    processingTime: chunkResult.processingTime,
                    message: chunkResult.message
                },
                embeddingResult: {
                    chunksProcessed: embedResult.chunksProcessed,
                    processingTime: embedResult.processingTime,
                    message: embedResult.message
                }
            };
        } catch (error) {
            console.error('Error in chunk and embed document:', error);
            return {
                documentId,
                chunksCreated: 0,
                embeddingsGenerated: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Chunk and embed failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                steps
            };
        }
    }

    /**
     * Update the embedding model
     * @param modelName - Name of the model to switch to
     * @param dimension - Vector dimension for the model
     */
    async updateEmbeddingModel(modelName: string, dimension: number): Promise<void> {
        try {
            // Update the embedding model in the search module
            await this.ragSearchModule.updateEmbeddingModel(modelName);
            
            // Save the default embedding model to system settings
            await this.saveDefaultEmbeddingModelToSettings(modelName, dimension);
            
            console.log(`Embedding model updated to: ${modelName}:${dimension}`);
        } catch (error) {
            console.error('Error updating embedding model:', error);
            throw new Error(`Failed to update embedding model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Save default embedding model to system settings
     * @param modelName - Name of the embedding model
     * @param dimension - Vector dimension for the model
     */
    private async saveDefaultEmbeddingModelToSettings(modelName: string, dimension: number): Promise<void> {
        try {
            // Get or create the embedding settings group
            const embeddingGroup = await this.systemSettingGroupModel.getOrCreateEmbeddingGroup();
            
            // Update the default embedding model setting
            await this.systemSettingModel.updateDefaultEmbeddingModel(`${modelName}:${dimension}`, embeddingGroup);
            
            console.log(`Default embedding model saved to settings: ${modelName}:${dimension}`);
        } catch (error) {
            console.error('Error saving default embedding model to settings:', error);
            // Don't throw error here to avoid breaking the main update process
        }
    }

    /**
     * Get default embedding model from system settings
     * @returns Default embedding model name or null if not found
     */
    async getDefaultEmbeddingModel(): Promise<{ modelName: string; dimension: number } | null> {
        try {
            return await this.systemSettingModule.getDefaultEmbeddingModel();
        } catch (error) {
            console.warn('Could not retrieve default embedding model from settings:', error);
            return null;
        }
    }

    /**
     * Check if default embedding model exists in system settings, 
     * if not, fetch it from API and update the setting.
     * If it exists, validate that it's still in the available models list.
     */
    async checkAndSetDefaultEmbeddingModel(): Promise<void> {
        try {
            // Get or create embedding settings group
            const embeddingGroup = await this.systemSettingGroupModel.getOrCreateEmbeddingGroup();
            
            // Check if default embedding model setting exists
            const defaultEmbeddingModel = await this.systemSettingModel.getDefaultEmbeddingModel();
            
            if (!defaultEmbeddingModel) {
                console.log('Default embedding model not found in system settings, fetching from API...');
                
                // Fetch available models from API
                const modelsResponse = await this.ragConfigApi.getAvailableEmbeddingModels();
                
                if (modelsResponse.status && modelsResponse.data) {
                    const defaultModel = modelsResponse.data.default_model;
                    const defaultDimensions = modelsResponse.data.default_dimensions;
                    console.log(`Setting default embedding model to: ${defaultModel}:${defaultDimensions}`);
                    
                    // Update the default embedding model setting
                    await this.systemSettingModel.updateDefaultEmbeddingModel(`${defaultModel}:${defaultDimensions}`, embeddingGroup);
                    console.log('Default embedding model updated successfully');
                } else {
                    console.warn('Failed to fetch available models from API, using fallback model');
                    // Use fallback model if API call fails
                    // const fallbackModel = 'Qwen/Qwen3-Embedding-4B';
                    // await this.systemSettingModel.updateDefaultEmbeddingModel(fallbackModel, embeddingGroup);
                    // console.log(`Using fallback model: ${fallbackModel}`);
                }
            } else {
                console.log(`Default embedding model already exists: ${defaultEmbeddingModel}`);
                
                // Validate that the existing default model is still available
                try {
                    const modelsResponse = await this.ragConfigApi.getAvailableEmbeddingModels();
                    
                    if (modelsResponse.status && modelsResponse.data) {
                        const availableModels = modelsResponse.data.models;
                        const defaultModelName = modelsResponse.data.default_model;
                        const defaultDimensions = modelsResponse.data.default_dimensions;
                        // Check if the current default embedding model is in the available models
                        const isCurrentModelAvailable = Object.keys(availableModels).includes(defaultEmbeddingModel);
                        
                        if (!isCurrentModelAvailable) {
                            console.log(`Current default embedding model '${defaultEmbeddingModel}' is not available in the models list`);
                            console.log(`Updating to new default model: ${defaultModelName}:${defaultDimensions}`);
                            
                            // Update to the new default model from the API
                            await this.systemSettingModel.updateDefaultEmbeddingModel(`${defaultModelName}:${defaultDimensions}`, embeddingGroup);
                            console.log('Default embedding model updated to available model');
                        } else {
                            console.log(`Current default embedding model '${defaultEmbeddingModel}' is still available`);
                        }
                    } else {
                        console.warn('Failed to fetch available models for validation, keeping current model');
                    }
                } catch (validationError) {
                    console.warn('Error validating default embedding model availability:', validationError);
                    console.log('Keeping current default embedding model due to validation error');
                }
            }
        } catch (error) {
            console.error('Error checking/setting default embedding model:', error);
            // Don't throw error to avoid breaking the initialization process
            // The system can still work with the fallback model
        }
    }

    /**
     * Save error log for a document
     * @param documentId - Document ID
     * @param error - Error object or error message
     * @param context - Additional context about the error
     * @returns Path to the created error log file
     */
    async saveDocumentErrorLog(documentId: number, error: Error | string, context?: string): Promise<string> {
        return await this.ragSearchModule.saveDocumentErrorLog(documentId, error, context);
    }

    /**
     * Get document error log content
     * @param documentId - Document ID
     * @returns Error log content or null if no log exists
     */
    async getDocumentErrorLog(documentId: number): Promise<string | null> {
        return await this.ragSearchModule.getDocumentErrorLog(documentId);
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        await this.ragSearchModule.cleanup();
    }
}

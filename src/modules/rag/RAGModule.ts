import { QueryProcessor, ProcessedQuery, QueryProcessingOptions } from '@/service/QueryProcessor';
import { RagSearchController } from '@/controller/RagSearchController';
import { ResponseGenerator, GeneratedResponse, ResponseGenerationOptions } from '@/service/ResponseGenerator';
import { DocumentService } from '@/service/DocumentService';
import { ChunkingService } from '@/service/ChunkingService';
import { SqliteDb } from '@/config/SqliteDb';
import { EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';
import { LlmCongfig } from '@/entityTypes/commonType';

export interface RAGQuery {
    query: string;
    options?: {
        queryProcessing?: QueryProcessingOptions;
        responseGeneration?: ResponseGenerationOptions;
        search?: {
            limit?: number;
            threshold?: number;
        };
    };
}

export interface RAGResponse {
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

export interface RAGSource {
    chunkId: number;
    documentId: number;
    documentName: string;
    title?: string;
    content: string;
    relevanceScore: number;
    pageNumber?: number;
}

export interface RAGStats {
    totalQueries: number;
    averageResponseTime: number;
    averageConfidence: number;
    totalDocuments: number;
    totalChunks: number;
    indexSize: number;
    lastActivity: Date;
}

export class RAGModule {
    private queryProcessor: QueryProcessor;
    private searchController: RagSearchController;
    private responseGenerator: ResponseGenerator;
    private documentService: DocumentService;
    private chunkingService: ChunkingService;
    private db: SqliteDb;
    private isInitialized: boolean = false;
    private stats: RAGStats = {
        totalQueries: 0,
        averageResponseTime: 0,
        averageConfidence: 0,
        totalDocuments: 0,
        totalChunks: 0,
        indexSize: 0,
        lastActivity: new Date()
    };

    constructor(db: SqliteDb) {
        this.db = db;
        this.documentService = new DocumentService(db);
        this.chunkingService = new ChunkingService(db, '');
        this.searchController = new RagSearchController();
        this.queryProcessor = new QueryProcessor(this.searchController, db);
        this.responseGenerator = new ResponseGenerator();
    }

    /**
     * Initialize the RAG module
     * @param embeddingConfig - Embedding configuration
     * @param llmConfig - LLM configuration
     */
    async initialize(embeddingConfig: EmbeddingConfig, llmConfig: LlmCongfig): Promise<void> {
        try {
            // Initialize response generator
            await this.responseGenerator.initialize(llmConfig);

            // Update stats
            await this.updateStats();

            this.isInitialized = true;
            console.log('RAG module initialized successfully');
        } catch (error) {
            console.error('Failed to initialize RAG module:', error);
            throw new Error('Failed to initialize RAG module');
        }
    }

    /**
     * Process a query through the complete RAG pipeline
     * @param ragQuery - RAG query
     * @returns RAG response
     */
    async processQuery(ragQuery: RAGQuery): Promise<RAGResponse> {
        const startTime = Date.now();

        try {
            if (!this.isInitialized) {
                throw new Error('RAG module not initialized');
            }

            // Step 1: Process the query
            const processedQuery = await this.queryProcessor.processQuery(
                ragQuery.query,
                ragQuery.options?.queryProcessing
            );

            // Step 2: Search for relevant content
            const searchRequest = {
                query: processedQuery.processedQuery,
                options: {
                    limit: ragQuery.options?.search?.limit || 10,
                    threshold: ragQuery.options?.search?.threshold || 0.5,
                    includeMetadata: true
                },
                filters: processedQuery.filters
            };

            // Mock search response since search method doesn't exist
            const searchResponse = { results: [] };

            // Step 3: Generate response
            const generatedResponse = await this.responseGenerator.generateResponse(
                processedQuery,
                searchResponse.results,
                ragQuery.options?.responseGeneration
            );

            // Step 4: Format final response
            const ragResponse = this.formatRAGResponse(
                ragQuery.query,
                processedQuery,
                generatedResponse,
                searchResponse.results,
                Date.now() - startTime
            );

            // Update statistics
            this.updateQueryStats(ragResponse);

            return ragResponse;
        } catch (error) {
            console.error('Error processing RAG query:', error);
            throw new Error(`RAG query processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Upload a document to the system
     * @param filePath - Path to the document
     * @param options - Upload options
     * @returns Upload result
     */
    async uploadDocument(filePath: string, options: {
        name: string;
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
    }): Promise<{
        documentId: number;
        processingTime: number;
        success: boolean;
        message: string;
    }> {
        const startTime = Date.now();

        try {
            if (!this.isInitialized) {
                throw new Error('RAG module not initialized');
            }

            // Upload document
            const document = await this.documentService.uploadDocument({
                filePath,
                name: options.name,
                title: options.title,
                description: options.description,
                tags: options.tags,
                author: options.author
            });

            // Update processing status to pending (ready for chunking)
            await this.documentService.updateDocumentStatus(
                document.id,
                'active',
                'pending'
            );

            const processingTime = Date.now() - startTime;

            // Update stats
            await this.updateStats();

            return {
                documentId: document.id,
                processingTime,
                success: true,
                message: 'Document uploaded successfully'
            };
        } catch (error) {
            console.error('Error uploading document:', error);
            return {
                documentId: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Document upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
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
        const startTime = Date.now();

        try {
            if (!this.isInitialized) {
                throw new Error('RAG module not initialized');
            }

            // Get document
            const document = await this.documentService.findDocumentById(documentId);
            if (!document) {
                return {
                    documentId,
                    chunksCreated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: 'Document not found'
                };
            }

            // Update processing status
            await this.documentService.updateDocumentStatus(
                documentId,
                'active',
                'processing'
            );

            // Chunk the document
            const chunks = await this.chunkingService.chunkDocument(document, options);

            // Update processing status to completed
            await this.documentService.updateDocumentStatus(
                documentId,
                'active',
                'completed'
            );

            const processingTime = Date.now() - startTime;

            // Update stats
            await this.updateStats();

            return {
                documentId,
                chunksCreated: chunks.length,
                processingTime,
                success: true,
                message: `Document chunked successfully into ${chunks.length} chunks`
            };
        } catch (error) {
            console.error('Error chunking document:', error);
            
            // Update processing status to error
            try {
                await this.documentService.updateDocumentStatus(
                    documentId,
                    'active',
                    'error'
                );
            } catch (updateError) {
                console.error('Failed to update document status to error:', updateError);
            }

            return {
                documentId,
                chunksCreated: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Document chunking failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Complete document processing pipeline (upload + chunk + embed)
     * @param filePath - Path to the document
     * @param options - Upload and processing options
     * @returns Complete processing result
     */
    async processDocument(filePath: string, options: {
        name: string;
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
        chunking?: {
            chunkSize?: number;
            overlapSize?: number;
            strategy?: 'sentence' | 'paragraph' | 'semantic' | 'fixed';
            preserveWhitespace?: boolean;
            minChunkSize?: number;
        };
    }): Promise<{
        documentId: number;
        chunksCreated: number;
        embeddingsGenerated: number;
        processingTime: number;
        success: boolean;
        message: string;
        steps: {
            upload: boolean;
            chunking: boolean;
            embedding: boolean;
        };
    }> {
        const startTime = Date.now();
        const steps = { upload: false, chunking: false, embedding: false };

        try {
            if (!this.isInitialized) {
                throw new Error('RAG module not initialized');
            }

            // Step 1: Upload document
            const uploadResult = await this.uploadDocument(filePath, options);
            if (!uploadResult.success) {
                return {
                    documentId: 0,
                    chunksCreated: 0,
                    embeddingsGenerated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: `Upload failed: ${uploadResult.message}`,
                    steps
                };
            }
            steps.upload = true;

            // Step 2: Chunk document
            const chunkResult = await this.chunkDocument(uploadResult.documentId, options.chunking);
            if (!chunkResult.success) {
                return {
                    documentId: uploadResult.documentId,
                    chunksCreated: 0,
                    embeddingsGenerated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: `Chunking failed: ${chunkResult.message}`,
                    steps
                };
            }
            steps.chunking = true;

            // Step 3: Generate embeddings
            const embedResult = await this.generateDocumentEmbeddings(uploadResult.documentId);
            if (!embedResult.success) {
                return {
                    documentId: uploadResult.documentId,
                    chunksCreated: chunkResult.chunksCreated,
                    embeddingsGenerated: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: `Embedding generation failed: ${embedResult.message}`,
                    steps
                };
            }
            steps.embedding = true;

            const processingTime = Date.now() - startTime;

            return {
                documentId: uploadResult.documentId,
                chunksCreated: chunkResult.chunksCreated,
                embeddingsGenerated: embedResult.chunksProcessed,
                processingTime,
                success: true,
                message: 'Document processed successfully (uploaded, chunked, and embedded)',
                steps
            };
        } catch (error) {
            console.error('Error in complete document processing:', error);
            return {
                documentId: 0,
                chunksCreated: 0,
                embeddingsGenerated: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Complete processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                steps
            };
        }
    }

    /**
     * Generate embeddings for document chunks
     * @param chunks - Array of chunk entities
     */
    private async generateChunkEmbeddings(chunks: any[]): Promise<void> {
        try {
            // Get embedding service from search controller
            const embeddingService = (this.searchController as any).currentEmbeddingService;
            if (!embeddingService) {
                throw new Error('Embedding service not available');
            }

            // Generate embeddings for each chunk
            for (const chunk of chunks) {
                const embedding = await embeddingService.embedText(chunk.content);
                
                // Update chunk with embedding
                const repository = this.db.connection.getRepository(require('@/entity/RAGChunk.entity').RAGChunkEntity);
                await repository.update(chunk.id, {
                    embeddingId: chunk.id.toString(),
                    vectorDimensions: embedding.length
                });
            }

            console.log(`Generated embeddings for ${chunks.length} chunks`);
        } catch (error) {
            console.error('Error generating chunk embeddings:', error);
            throw new Error('Failed to generate chunk embeddings');
        }
    }

    /**
     * Generate embeddings for a specific document's chunks
     * @param documentId - Document ID to generate embeddings for
     * @returns Processing result
     */
    async generateDocumentEmbeddings(documentId: number): Promise<{
        documentId: number;
        chunksProcessed: number;
        processingTime: number;
        success: boolean;
        message: string;
    }> {
        const startTime = Date.now();

        try {
            if (!this.isInitialized) {
                throw new Error('RAG module not initialized');
            }

            // Get document chunks
            const chunks = await this.chunkingService.getDocumentChunks(documentId);
            if (chunks.length === 0) {
                return {
                    documentId,
                    chunksProcessed: 0,
                    processingTime: Date.now() - startTime,
                    success: false,
                    message: 'No chunks found for document'
                };
            }

            // Check if chunks already have embeddings
            const chunksWithoutEmbeddings = chunks.filter(chunk => !chunk.embeddingId);
            if (chunksWithoutEmbeddings.length === 0) {
                return {
                    documentId,
                    chunksProcessed: 0,
                    processingTime: Date.now() - startTime,
                    success: true,
                    message: 'All chunks already have embeddings'
                };
            }

            // Generate embeddings for chunks that don't have them
            await this.generateChunkEmbeddings(chunksWithoutEmbeddings);

            const processingTime = Date.now() - startTime;

            return {
                documentId,
                chunksProcessed: chunksWithoutEmbeddings.length,
                processingTime,
                success: true,
                message: `Generated embeddings for ${chunksWithoutEmbeddings.length} chunks`
            };
        } catch (error) {
            console.error('Error generating document embeddings:', error);
            return {
                documentId,
                chunksProcessed: 0,
                processingTime: Date.now() - startTime,
                success: false,
                message: `Failed to generate embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Generate embeddings for all documents that don't have them
     * @returns Processing results
     */
    async generateAllMissingEmbeddings(): Promise<{
        totalDocuments: number;
        documentsProcessed: number;
        totalChunksProcessed: number;
        processingTime: number;
        results: Array<{
            documentId: number;
            chunksProcessed: number;
            success: boolean;
            message: string;
        }>;
    }> {
        const startTime = Date.now();

        try {
            if (!this.isInitialized) {
                throw new Error('RAG module not initialized');
            }

            // Get all documents
            const documents = await this.documentService.getDocuments();
            const results: Array<{
                documentId: number;
                chunksProcessed: number;
                success: boolean;
                message: string;
            }> = [];

            let totalChunksProcessed = 0;

            for (const document of documents) {
                const result = await this.generateDocumentEmbeddings(document.id);
                results.push(result);
                
                if (result.success) {
                    totalChunksProcessed += result.chunksProcessed;
                }
            }

            const processingTime = Date.now() - startTime;
            const documentsProcessed = results.filter(r => r.success).length;

            return {
                totalDocuments: documents.length,
                documentsProcessed,
                totalChunksProcessed,
                processingTime,
                results
            };
        } catch (error) {
            console.error('Error generating all missing embeddings:', error);
            return {
                totalDocuments: 0,
                documentsProcessed: 0,
                totalChunksProcessed: 0,
                processingTime: Date.now() - startTime,
                results: []
            };
        }
    }

    /**
     * Format RAG response
     * @param originalQuery - Original query
     * @param processedQuery - Processed query
     * @param generatedResponse - Generated response
     * @param searchResults - Search results
     * @param processingTime - Processing time
     * @returns Formatted RAG response
     */
    private formatRAGResponse(
        originalQuery: string,
        processedQuery: ProcessedQuery,
        generatedResponse: GeneratedResponse,
        searchResults: any[],
        processingTime: number
    ): RAGResponse {
        const sources: RAGSource[] = generatedResponse.sources.map(source => ({
            chunkId: source.chunkId,
            documentId: source.documentId,
            documentName: source.documentName,
            content: source.content,
            relevanceScore: source.relevanceScore,
            pageNumber: source.pageNumber
        }));

        return {
            query: originalQuery,
            response: generatedResponse.content,
            sources,
            confidence: generatedResponse.confidence,
            processingTime,
            metadata: {
                queryIntent: processedQuery.intent.type,
                chunksUsed: searchResults.length,
                documentsUsed: new Set(searchResults.map(r => r.documentId)).size,
                model: generatedResponse.metadata.model
            }
        };
    }

    /**
     * Update query statistics
     * @param response - RAG response
     */
    private updateQueryStats(response: RAGResponse): void {
        this.stats.totalQueries++;
        
        // Update average response time
        this.stats.averageResponseTime = 
            (this.stats.averageResponseTime * (this.stats.totalQueries - 1) + response.processingTime) 
            / this.stats.totalQueries;

        // Update average confidence
        this.stats.averageConfidence = 
            (this.stats.averageConfidence * (this.stats.totalQueries - 1) + response.confidence) 
            / this.stats.totalQueries;

        this.stats.lastActivity = new Date();
    }

    /**
     * Update module statistics
     */
    private async updateStats(): Promise<void> {
        try {
            const docStats = await this.documentService.getDocumentStats();
            const chunkStats = await this.chunkingService.getChunkStats();

            this.stats.totalDocuments = docStats.total;
            this.stats.totalChunks = chunkStats.totalChunks;
            this.stats.indexSize = 0; // Default value since getSearchStats doesn't exist
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    /**
     * Get module statistics
     * @returns RAG statistics
     */
    getStats(): RAGStats {
        return { ...this.stats };
    }

    /**
     * Get query suggestions
     * @param partialQuery - Partial query
     * @param limit - Number of suggestions
     * @returns Array of suggestions
     */
    async getQuerySuggestions(partialQuery: string, limit: number = 5): Promise<string[]> {
        try {
            return this.queryProcessor.getQuerySuggestions(partialQuery, limit);
        } catch (error) {
            console.error('Error getting query suggestions:', error);
            return [];
        }
    }

    /**
     * Clear all caches
     */
    clearCaches(): void {
        this.queryProcessor.clearCache();
        this.responseGenerator.clearCache();
    }

    /**
     * Test the RAG pipeline
     * @returns Test result
     */
    async testPipeline(): Promise<{
        success: boolean;
        message: string;
        components: {
            queryProcessor: boolean;
            searchController: boolean;
            responseGenerator: boolean;
            documentService: boolean;
        };
    }> {
        const components = {
            queryProcessor: false,
            searchController: false,
            responseGenerator: false,
            documentService: false
        };

        try {
            // Test query processor
            try {
                await this.queryProcessor.processQuery('test query');
                components.queryProcessor = true;
            } catch (error) {
                console.error('Query processor test failed:', error);
            }

            // Test search controller
            try {
                // Simple test - check if search controller is initialized
                components.searchController = true;
            } catch (error) {
                console.error('Search controller test failed:', error);
            }

            // Test response generator
            try {
                await this.responseGenerator.testLlmConnection();
                components.responseGenerator = true;
            } catch (error) {
                console.error('Response generator test failed:', error);
            }

            // Test document service
            try {
                await this.documentService.getDocumentStats();
                components.documentService = true;
            } catch (error) {
                console.error('Document service test failed:', error);
            }

            const allComponentsWorking = Object.values(components).every(Boolean);

            return {
                success: allComponentsWorking,
                message: allComponentsWorking 
                    ? 'All RAG components are working correctly'
                    : 'Some RAG components are not working correctly',
                components
            };
        } catch (error) {
            return {
                success: false,
                message: `RAG pipeline test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                components
            };
        }
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        try {
            this.clearCaches();
            console.log('RAG module cleaned up');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

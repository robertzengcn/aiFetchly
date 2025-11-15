import { VectorStoreService } from './VectorStoreService';
// import { SqliteDb } from '@/config/SqliteDb';
import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';
import { RAGDocumentModule } from '@/modules/RAGDocumentModule';
import { RAGChunkModule } from '@/modules/RAGChunkModule';
import { RagConfigApi } from '@/api/ragConfigApi';

export interface SearchResult {
    chunkId: number;
    documentId: number;
    content: string;
    score: number;
    document: {
        id: number;
        name: string;
        title?: string;
        fileType: string;
    };
    metadata: {
        chunkIndex: number;
        startPosition?: number;
        endPosition?: number;
        pageNumber?: number;
    };
}

export interface SearchOptions {
    limit?: number;
    threshold?: number;
    includeMetadata?: boolean;
    documentTypes?: string[];
    dateRange?: {
        start: Date;
        end: Date;
    };
}

export class VectorSearchService {
    private vectorStore: VectorStoreService;
    private embeddingService: EmbeddingImpl | null = null;
    private documentModule: RAGDocumentModule;
    private chunkModule: RAGChunkModule;
    private ragConfigApi: RagConfigApi;

    constructor(vectorStore: VectorStoreService) {
        this.vectorStore = vectorStore;
        this.documentModule = new RAGDocumentModule();
        this.chunkModule = new RAGChunkModule();
        this.ragConfigApi = new RagConfigApi();
    }

    /**
     * Set the embedding service for query processing
     * @param embeddingService - Embedding service instance
     */
    setEmbeddingService(embeddingService: EmbeddingImpl): void {
        this.embeddingService = embeddingService;
    }

    /**
     * Get the vector store service
     * @returns Vector store service instance
     */
    get vectorStoreService(): VectorStoreService {
        return this.vectorStore;
    }

    /**
     * Search for similar content across all documents
     * @param query - Search query
     * @param options - Search options
     * @returns Array of search results
     */
    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        try {
            // Get all documents with embeddings
            const documents = await this.getAllDocumentsWithEmbeddings();
            
            if (documents.length === 0) {
                return [];
            }

            // Group documents by their embedding model
            const documentsByModel = await this.groupDocumentsByModel(documents);
            
            if (documentsByModel.size === 0) {
                return [];
            }

            // Search across all document-specific indexes, using the appropriate model for each
            const allResults: Array<{
                chunkIds: number[];
                distances: number[];
                documentId: number;
            }> = [];

            // Process each unique model group
            for (const [modelKey, docs] of documentsByModel.entries()) {
                const [modelName, dimensions] = modelKey.split(':');
                
                // Generate query embedding for this specific model using remote API
                let queryVector: number[];
                try {
                    // Use remote API to generate embedding for the correct model
                    const response = await this.ragConfigApi.generateEmbedding([query], modelName);
                    
                    if (!response.status || !response.data || !response.data[0]) {
                        throw new Error(`Failed to generate embedding: ${response.msg || 'Unknown error'}`);
                    }
                    
                    queryVector = response.data[0].embedding;
                    
                    // Validate vector dimensions match
                    if (queryVector.length !== parseInt(dimensions)) {
                        console.warn(`Query vector dimensions (${queryVector.length}) don't match document dimensions (${dimensions}) for model ${modelName}`);
                        continue;
                    }
                } catch (error) {
                    console.error(`Failed to generate query embedding for model ${modelName}:`, error);
                    continue;
                }

                // Search in all documents using this model
                for (const doc of docs) {
                    try {
                        // Load document-specific index and search
                        await this.vectorStore.loadDocumentIndex(doc.id, {
                            name: modelName,
                            dimensions: parseInt(dimensions),
                            documentIndexPath: doc.vectorIndexPath || undefined
                        });
                        const distance = options.threshold || 0.5;
                        const documentResults = await this.vectorStore.search(queryVector, options.limit || 10, distance);
                        
                        allResults.push({
                            chunkIds: documentResults.chunkIds,
                            distances: documentResults.distances,
                            documentId: doc.id
                        });
                    } catch (error) {
                        console.warn(`Failed to search in document ${doc.id}:`, error);
                        // Log total number of chunks in the search index for this document
                        try {
                            const totalChunks = await this.vectorStore.getTotalVectors();
                            console.info(`Document ${doc.id} index contains ${totalChunks} chunks`);
                        } catch (countError) {
                            console.warn(`Failed to retrieve index size for document ${doc.id}:`, countError);
                        }
                        continue;
                    }
                }
            }

            // Combine and sort results from all documents
            const combinedResults = this.combineSearchResults(allResults, options.limit || 10);
            
            // Get detailed results from database
            const results = await this.getDetailedResults(combinedResults.chunkIds, combinedResults.distances, options);
            
            return results;
        } catch (error) {
            console.error('Error in vector search:', error);
            throw new Error(`Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Group documents by their embedding model
     * @param documents - Array of documents with IDs and vector index paths
     * @returns Map of model key to document data
     */
    private async groupDocumentsByModel(documents: Array<{ id: number; vectorIndexPath: string | null }>): Promise<Map<string, Array<{ id: number; vectorIndexPath: string | null }>>> {
        const documentsByModel = new Map<string, Array<{ id: number; vectorIndexPath: string | null }>>();
        
        for (const doc of documents) {
            const modelConfig = await this.getDocumentModelConfig(doc.id);
            if (!modelConfig) {
                console.warn(`No model configuration found for document ${doc.id}`);
                continue;
            }
            
            // Create a unique key for the model and dimensions
            const modelKey = `${modelConfig.modelName}:${modelConfig.dimensions}`;
            
            if (!documentsByModel.has(modelKey)) {
                documentsByModel.set(modelKey, []);
            }
            documentsByModel.get(modelKey)!.push(doc);
        }
        
        return documentsByModel;
    }

    /**
     * Search with filters
     * @param query - Search query
     * @param filters - Additional filters
     * @param options - Search options
     * @returns Array of filtered search results
     */
    async searchWithFilters(
        query: string, 
        filters: {
            documentTypes?: string[];
            dateRange?: { start: Date; end: Date };
            authors?: string[];
            tags?: string[];
        },
        options: SearchOptions = {}
    ): Promise<SearchResult[]> {
        const results = await this.search(query, options);
        
        // Apply filters
        let filteredResults = results;

        if (filters.documentTypes && filters.documentTypes.length > 0) {
            filteredResults = filteredResults.filter(result => 
                filters.documentTypes!.includes(result.document.fileType)
            );
        }

        if (filters.dateRange) {
            filteredResults = filteredResults.filter(result => {
                // This would require additional database queries to get document dates
                // For now, we'll skip date filtering
                return true;
            });
        }

        if (filters.authors && filters.authors.length > 0) {
            filteredResults = filteredResults.filter(result => {
                // This would require additional database queries to get document authors
                // For now, we'll skip author filtering
                return true;
            });
        }

        return filteredResults;
    }

    /**
     * Get detailed results from database
     * @param chunkIds - Array of chunk IDs
     * @param distances - Array of similarity distances
     * @param options - Search options
     * @returns Array of detailed search results
     */
    private async getDetailedResults(
        chunkIds: number[], 
        distances: number[], 
        options: SearchOptions
    ): Promise<SearchResult[]> {
        if (chunkIds.length === 0) {
            return [];
        }

        try {
            // Get chunks with their documents using module
            const chunks = await this.chunkModule.getChunksByIds(chunkIds);

            // Create results array
            const results: SearchResult[] = [];
            const threshold = options.threshold || 0;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const distance = distances[i];
                const score = this.distanceToScore(distance);

                // Apply threshold filter
                if (score < threshold) {
                    continue;
                }

                // Apply document type filter
                if (options.documentTypes && options.documentTypes.length > 0) {
                    if (!options.documentTypes.includes(chunk.document.fileType)) {
                        continue;
                    }
                }

                const result: SearchResult = {
                    chunkId: chunk.id,
                    documentId: chunk.documentId,
                    content: chunk.content,
                    score,
                    document: {
                        id: chunk.document.id,
                        name: chunk.document.name,
                        title: chunk.document.title,
                        fileType: chunk.document.fileType
                    },
                    metadata: {
                        chunkIndex: chunk.chunkIndex,
                        startPosition: chunk.startPosition,
                        endPosition: chunk.endPosition,
                        pageNumber: chunk.pageNumber
                    }
                };

                results.push(result);
            }

            // Sort by score (highest first)
            results.sort((a, b) => b.score - a.score);

            return results;
        } catch (error) {
            console.error('Error getting detailed results:', error);
            throw new Error('Failed to get detailed search results');
        }
    }

    /**
     * Convert distance to similarity score
     * @param distance - Distance value
     * @returns Similarity score (0-1)
     */
    private distanceToScore(distance: number): number {
        // Convert L2 distance to similarity score
        // This is a simple conversion - more sophisticated methods can be used
        return Math.max(0, 1 - (distance / 10));
    }

    /**
     * Get search suggestions based on query
     * @param query - Partial query
     * @param limit - Number of suggestions
     * @returns Array of suggestion strings
     */
    async getSearchSuggestions(query: string, limit: number = 5): Promise<string[]> {
        try {
            // Get chunks that contain the query text using module
            const chunks = await this.chunkModule.searchChunksByContent(query, limit * 2);

            // Extract unique phrases containing the query
            const suggestions = new Set<string>();
            
            for (const chunk of chunks) {
                const sentences = chunk.content.split(/[.!?]+/);
                for (const sentence of sentences) {
                    if (sentence.toLowerCase().includes(query.toLowerCase())) {
                        const suggestion = sentence.trim();
                        if (suggestion.length > query.length && suggestion.length < 100) {
                            suggestions.add(suggestion);
                        }
                    }
                }
            }

            return Array.from(suggestions).slice(0, limit);
        } catch (error) {
            console.error('Error getting search suggestions:', error);
            return [];
        }
    }

    /**
     * Get search analytics
     * @returns Search analytics data
     */
    async getSearchAnalytics(): Promise<{
        totalChunks: number;
        totalDocuments: number;
        averageChunkSize: number;
        indexStats: any;
    }> {
        try {
            // Use module methods for analytics
            const totalChunks = await this.chunkModule.getTotalChunkCount();
            const totalDocuments = await this.documentModule.countDocuments();
            const averageChunkSize = await this.chunkModule.getAverageTokenCount();
            const indexStats = this.vectorStore.getIndexStats();

            return {
                totalChunks,
                totalDocuments,
                averageChunkSize,
                indexStats
            };
        } catch (error) {
            console.error('Error getting search analytics:', error);
            throw new Error('Failed to get search analytics');
        }
    }

    /**
     * Clear search cache
     */
    clearCache(): void {
        // Implementation for search result caching would go here
        console.log('Search cache cleared');
    }

    /**
     * Get search performance metrics
     * @returns Performance metrics
     */
    getPerformanceMetrics(): {
        averageSearchTime: number;
        cacheHitRate: number;
        totalSearches: number;
    } {
        // This would track actual performance metrics
        return {
            averageSearchTime: 0,
            cacheHitRate: 0,
            totalSearches: 0
        };
    }

    /**
     * Get all documents that have embeddings
     * @returns Array of document IDs with embeddings and vector index paths
     */
    private async getAllDocumentsWithEmbeddings(): Promise<Array<{ id: number; vectorIndexPath: string | null }>> {
        try {
            // Use document module to get documents with embeddings
            return await this.documentModule.getDocumentsWithEmbeddings();
        } catch (error) {
            console.error('Error getting documents with embeddings:', error);
            return [];
        }
    }

    /**
     * Get model configuration for a document
     * @param documentId - Document ID
     * @returns Model configuration or null if not found
     */
    private async getDocumentModelConfig(documentId: number): Promise<{
        modelName: string;
        dimensions: number;
    } | null> {
        try {
            // Use RAGDocumentModule to get document by ID
            const document = await this.documentModule.findDocumentById(documentId);
            
            if (document && document.modelName) {
                // Get dimensions directly from document (default to 1536 if not set)
                if (!document.vectorDimensions) {
                    throw new Error(`No vector dimensions found for document ${documentId}`);
                }
                return {
                    modelName: document.modelName,
                    dimensions: document.vectorDimensions
                };
            }
            
            return null;
        } catch (error) {
            console.error(`Error getting model config for document ${documentId}:`, error);
            return null;
        }
    }

    /**
     * Combine search results from multiple documents
     * @param allResults - Results from all documents
     * @param limit - Maximum number of results to return
     * @returns Combined and sorted results
     */
    private combineSearchResults(
        allResults: Array<{
            chunkIds: number[];
            distances: number[];
            documentId: number;
        }>,
        limit: number
    ): {
        chunkIds: number[];
        distances: number[];
    } {
        // Combine all results with their distances
        const combinedResults: Array<{
            chunkId: number;
            distance: number;
        }> = [];

        for (const result of allResults) {
            for (let i = 0; i < result.chunkIds.length; i++) {
                combinedResults.push({
                    chunkId: result.chunkIds[i],
                    distance: result.distances[i]
                });
            }
        }

        // Sort by distance (lower is better) and take top results
        combinedResults.sort((a, b) => a.distance - b.distance);
        
        const topResults = combinedResults.slice(0, limit);
        
        return {
            chunkIds: topResults.map(r => r.chunkId),
            distances: topResults.map(r => r.distance)
        };
    }
}

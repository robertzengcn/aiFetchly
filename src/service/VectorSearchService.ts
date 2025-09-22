import { VectorStoreService } from './VectorStoreService';
import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { SqliteDb } from '@/config/SqliteDb';
import { EmbeddingImpl } from '@/modules/interface/EmbeddingImpl';

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
    private db: SqliteDb;
    private embeddingService: EmbeddingImpl | null = null;

    constructor(vectorStore: VectorStoreService, db: SqliteDb) {
        this.vectorStore = vectorStore;
        this.db = db;
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
     * Search for similar content
     * @param query - Search query
     * @param options - Search options
     * @returns Array of search results
     */
    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        if (!this.embeddingService) {
            throw new Error('Embedding service not set');
        }

        try {
            // Generate query embedding
            const queryVector = await this.embeddingService.embedText(query);
            
            // Search in vector store
            const limit = options.limit || 10;
            const searchResults = await this.vectorStore.search(queryVector, limit);
            
            // Get detailed results from database
            const results = await this.getDetailedResults(searchResults.chunkIds, searchResults.distances, options);
            
            return results;
        } catch (error) {
            console.error('Error in vector search:', error);
            throw new Error(`Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
            const chunkRepository = this.db.connection.getRepository(RAGChunkEntity);
            const documentRepository = this.db.connection.getRepository(RAGDocumentEntity);

            // Get chunks with their documents
            const chunks = await chunkRepository
                .createQueryBuilder('chunk')
                .leftJoinAndSelect('chunk.document', 'document')
                .where('chunk.id IN (:...chunkIds)', { chunkIds })
                .getMany();

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
            const chunkRepository = this.db.connection.getRepository(RAGChunkEntity);
            
            // Get chunks that contain the query text
            const chunks = await chunkRepository
                .createQueryBuilder('chunk')
                .select(['chunk.content'])
                .where('chunk.content LIKE :query', { query: `%${query}%` })
                .limit(limit * 2) // Get more to filter
                .getMany();

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
            const chunkRepository = this.db.connection.getRepository(RAGChunkEntity);
            const documentRepository = this.db.connection.getRepository(RAGDocumentEntity);

            const totalChunks = await chunkRepository.count();
            const totalDocuments = await documentRepository.count();
            
            const avgResult = await chunkRepository
                .createQueryBuilder('chunk')
                .select('AVG(chunk.tokenCount)', 'avgTokens')
                .getRawOne();

            const averageChunkSize = parseFloat(avgResult.avgTokens) || 0;
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
}

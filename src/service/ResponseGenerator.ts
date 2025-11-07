import { SearchResult } from '@/service/VectorSearchService';
import { ProcessedQuery } from '@/service/QueryProcessor';
import { LlmCongfig } from '@/entityTypes/commonType';

export interface GeneratedResponse {
    content: string;
    sources: ResponseSource[];
    confidence: number;
    processingTime: number;
    metadata: {
        model: string;
        tokensUsed: number;
        chunksUsed: number;
    };
}

export interface ResponseSource {
    chunkId: number;
    documentId: number;
    documentName: string;
    content: string;
    relevanceScore: number;
    pageNumber?: number;
}

export interface ResponseGenerationOptions {
    maxLength?: number;
    includeSources?: boolean;
    temperature?: number;
    systemPrompt?: string;
    contextWindow?: number;
}

/**
 * ResponseGenerator - Currently deprecated/unused
 * This class was previously used for LLM-based response generation
 * The RAG system now uses remote APIs instead
 * 
 * @deprecated Use remote API-based response generation instead
 */
export class ResponseGenerator {
    private responseHistory: Map<string, GeneratedResponse> = new Map();

    constructor() {
        // No longer using LlmFactory - now relies on remote APIs
        console.warn('ResponseGenerator is deprecated. Use remote API-based response generation instead.');
    }

    /**
     * Initialize the response generator with LLM configuration
     * @deprecated This method is no longer used. Response generation now handled by remote APIs.
     * @param llmConfig - LLM configuration
     */
    async initialize(llmConfig: LlmCongfig): Promise<void> {
        console.warn('ResponseGenerator.initialize() is deprecated and no longer functional');
        // No-op - this class is deprecated
    }

    /**
     * Generate a response based on search results
     * @deprecated This method is no longer functional. Use remote API-based response generation instead.
     * @param query - Processed query
     * @param searchResults - Search results
     * @param options - Generation options
     * @returns Generated response
     */
    async generateResponse(
        query: ProcessedQuery,
        searchResults: SearchResult[],
        options: ResponseGenerationOptions = {}
    ): Promise<GeneratedResponse> {
        throw new Error('ResponseGenerator is deprecated. LlmFactory has been removed. Use remote API-based response generation instead.');
    }

    /**
     * Prepare context from search results
     * @param searchResults - Search results
     * @param maxTokens - Maximum tokens for context
     * @returns Formatted context string
     */
    private prepareContext(searchResults: SearchResult[], maxTokens: number): string {
        let context = '';
        let currentTokens = 0;

        for (const result of searchResults) {
            const chunkText = `Document: ${result.document.name}\nContent: ${result.content}\n\n`;
            const chunkTokens = this.estimateTokens(chunkText);

            if (currentTokens + chunkTokens > maxTokens) {
                break;
            }

            context += chunkText;
            currentTokens += chunkTokens;
        }

        return context.trim();
    }

    /**
     * Prepare sources from search results
     * @param searchResults - Search results
     * @returns Array of response sources
     */
    private prepareSources(searchResults: SearchResult[]): ResponseSource[] {
        return searchResults.map(result => ({
            chunkId: result.chunkId,
            documentId: result.documentId,
            documentName: result.document.name,
            content: result.content,
            relevanceScore: result.score,
            pageNumber: result.metadata.pageNumber
        }));
    }

    /**
     * Create system prompt for LLM
     * @param query - Processed query
     * @param options - Generation options
     * @returns System prompt string
     */
    private createSystemPrompt(
        query: ProcessedQuery, 
        options: ResponseGenerationOptions
    ): string {
        const basePrompt = `You are a helpful AI assistant that answers questions based on provided context. 
        Use the following guidelines:
        1. Answer based only on the provided context
        2. If the context doesn't contain enough information, say so
        3. Cite sources when possible
        4. Be concise but comprehensive
        5. Maintain a helpful and professional tone`;

        const intentSpecificPrompt = this.getIntentSpecificPrompt(query.intent);
        const customPrompt = options.systemPrompt || '';

        return `${basePrompt}\n\n${intentSpecificPrompt}\n\n${customPrompt}`.trim();
    }

    /**
     * Get intent-specific prompt
     * @param intent - Query intent
     * @returns Intent-specific prompt
     */
    private getIntentSpecificPrompt(intent: ProcessedQuery['intent']): string {
        switch (intent.type) {
            case 'question':
                return 'Focus on providing a clear, informative answer to the question.';
            case 'command':
                return 'Focus on providing actionable information or steps.';
            case 'conversation':
                return 'Respond in a conversational, friendly manner.';
            default:
                return 'Provide relevant information based on the context.';
        }
    }

    /**
     * Generate response using LLM
     * @deprecated This method is no longer functional. LlmFactory has been removed.
     */
    private async generateLLMResponse(
        query: ProcessedQuery,
        context: string,
        systemPrompt: string,
        options: ResponseGenerationOptions
    ): Promise<string> {
        throw new Error('LlmFactory has been removed. Use remote API-based response generation instead.');
    }

    /**
     * Calculate response confidence
     * @param query - Processed query
     * @param searchResults - Search results
     * @param response - Generated response
     * @returns Confidence score
     */
    private calculateConfidence(
        query: ProcessedQuery,
        searchResults: SearchResult[],
        response: string
    ): number {
        let confidence = 0.5; // Base confidence

        // Boost confidence based on query confidence
        confidence += query.confidence * 0.2;

        // Boost confidence based on search result quality
        if (searchResults.length > 0) {
            const avgScore = searchResults.reduce((sum, result) => sum + result.score, 0) / searchResults.length;
            confidence += avgScore * 0.2;
        }

        // Boost confidence based on response length (more comprehensive responses)
        const responseLength = response.length;
        if (responseLength > 100) {
            confidence += 0.1;
        }

        // Penalize if response is too short
        if (responseLength < 20) {
            confidence -= 0.2;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Estimate token count for text
     * @param text - Text to estimate
     * @returns Estimated token count
     */
    private estimateTokens(text: string): number {
        // Rough estimation: 1 token ≈ 4 characters
        return Math.ceil(text.length / 4);
    }

    /**
     * Generate cache key for response
     * @param query - Processed query
     * @param searchResults - Search results
     * @param options - Generation options
     * @returns Cache key
     */
    private generateCacheKey(
        query: ProcessedQuery,
        searchResults: SearchResult[],
        options: ResponseGenerationOptions
    ): string {
        const queryKey = query.originalQuery.toLowerCase();
        const resultsKey = searchResults.map(r => r.chunkId).join(',');
        const optionsKey = JSON.stringify(options);
        return `${queryKey}:${resultsKey}:${optionsKey}`;
    }

    /**
     * Update LLM configuration
     * @deprecated This method is no longer functional. LlmFactory has been removed.
     */
    async updateLlmConfig(config: Partial<LlmCongfig>): Promise<void> {
        throw new Error('LlmFactory has been removed. Use remote API-based LLM instead.');
    }

    /**
     * Switch to a different LLM
     * @deprecated This method is no longer functional. LlmFactory has been removed.
     */
    async switchLlm(llmConfig: LlmCongfig): Promise<void> {
        throw new Error('LlmFactory has been removed. Use remote API-based LLM instead.');
    }

    /**
     * Get response generation statistics
     * @returns Generation statistics
     */
    getStats(): {
        totalResponses: number;
        averageProcessingTime: number;
        cacheHitRate: number;
        averageConfidence: number;
    } {
        const responses = Array.from(this.responseHistory.values());
        const totalResponses = responses.length;
        
        const averageProcessingTime = totalResponses > 0
            ? responses.reduce((sum, r) => sum + r.processingTime, 0) / totalResponses
            : 0;

        const averageConfidence = totalResponses > 0
            ? responses.reduce((sum, r) => sum + r.confidence, 0) / totalResponses
            : 0;

        return {
            totalResponses,
            averageProcessingTime,
            cacheHitRate: 0, // Would need to track cache hits
            averageConfidence
        };
    }

    /**
     * Clear response cache
     */
    clearCache(): void {
        this.responseHistory.clear();
    }

    /**
     * Get available LLM models
     * @deprecated This method is no longer functional. LlmFactory has been removed.
     * @returns Empty array
     */
    getAvailableModels(): string[] {
        console.warn('getAvailableModels() is deprecated. LlmFactory has been removed.');
        return [];
    }

    /**
     * Test LLM connection
     * @deprecated This method is no longer functional. LlmFactory has been removed.
     */
    async testLlmConnection(): Promise<{
        success: boolean;
        message: string;
        responseTime?: number;
    }> {
        return {
            success: false,
            message: 'LlmFactory has been removed. Use remote API-based LLM instead.'
        };
    }
}

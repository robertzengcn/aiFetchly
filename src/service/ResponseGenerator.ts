import { SearchResult } from '@/service/VectorSearchService';
import { ProcessedQuery } from '@/service/QueryProcessor';
import { LlmFactory } from '@/modules/llm/LlmFactory';
import { LlmImpl } from '@/modules/interface/LlmImpl';
import { LlmCongfig } from '@/entityTypes/commonType';
import { TranslateToolEnum } from '@/config/generate';

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

export class ResponseGenerator {
    private llmFactory: LlmFactory;
    private currentLlm: LlmImpl | null = null;
    private responseHistory: Map<string, GeneratedResponse> = new Map();

    constructor() {
        this.llmFactory = new LlmFactory();
    }

    /**
     * Initialize the response generator with LLM configuration
     * @param llmConfig - LLM configuration
     */
    async initialize(llmConfig: LlmCongfig): Promise<void> {
        try {
            // Use the first available LLM tool for now
            // In production, this could be configurable
            this.currentLlm = this.llmFactory.getLlmTool(TranslateToolEnum.OPENAI, llmConfig) || null;
            
            if (!this.currentLlm) {
                throw new Error('Failed to initialize LLM');
            }

            console.log('Response generator initialized successfully');
        } catch (error) {
            console.error('Failed to initialize response generator:', error);
            throw new Error('Failed to initialize response generator');
        }
    }

    /**
     * Generate a response based on search results
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
        const startTime = Date.now();

        try {
            if (!this.currentLlm) {
                throw new Error('LLM not initialized');
            }

            // Check cache first
            const cacheKey = this.generateCacheKey(query, searchResults, options);
            const cached = this.responseHistory.get(cacheKey);
            if (cached) {
                return cached;
            }

            // Prepare context from search results
            const context = this.prepareContext(searchResults, options.contextWindow || 4000);
            
            // Generate sources
            const sources = this.prepareSources(searchResults);

            // Create system prompt
            const systemPrompt = this.createSystemPrompt(query, options);

            // Generate response
            const response = await this.generateLLMResponse(
                query,
                context,
                systemPrompt,
                options
            );

            // Calculate confidence
            const confidence = this.calculateConfidence(query, searchResults, response);

            const generatedResponse: GeneratedResponse = {
                content: response,
                sources: options.includeSources !== false ? sources : [],
                confidence,
                processingTime: Date.now() - startTime,
                metadata: {
                    model: 'openai', // Default model name
                    tokensUsed: this.estimateTokens(context + response),
                    chunksUsed: searchResults.length
                }
            };

            // Cache the response
            this.responseHistory.set(cacheKey, generatedResponse);

            return generatedResponse;
        } catch (error) {
            console.error('Error generating response:', error);
            throw new Error(`Response generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
     * @param query - Processed query
     * @param context - Context from search results
     * @param systemPrompt - System prompt
     * @param options - Generation options
     * @returns Generated response text
     */
    private async generateLLMResponse(
        query: ProcessedQuery,
        context: string,
        systemPrompt: string,
        options: ResponseGenerationOptions
    ): Promise<string> {
        if (!this.currentLlm) {
            throw new Error('LLM not initialized');
        }

        const userPrompt = `Context:\n${context}\n\nQuestion: ${query.originalQuery}`;
        
        // Use the LLM's translate method as a general text generation method
        const response = await this.currentLlm.translate(
            'user', // input language
            'assistant', // output language
            userPrompt,
            systemPrompt
        );

        return response?.toString() || 'Unable to generate response';
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
     * @param llmConfig - New LLM configuration
     */
    async updateLlmConfig(llmConfig: LlmCongfig): Promise<void> {
        try {
            this.currentLlm = this.llmFactory.getLlmTool(TranslateToolEnum.OPENAI, llmConfig) || null;
            
            if (!this.currentLlm) {
                throw new Error('Failed to update LLM configuration');
            }

            // Clear cache when LLM changes
            this.responseHistory.clear();
            
            console.log('LLM configuration updated successfully');
        } catch (error) {
            console.error('Failed to update LLM configuration:', error);
            throw new Error('Failed to update LLM configuration');
        }
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
     * @returns Array of available models
     */
    getAvailableModels(): string[] {
        return Object.values(TranslateToolEnum);
    }

    /**
     * Test LLM connection
     * @returns Test result
     */
    async testLlmConnection(): Promise<{
        success: boolean;
        message: string;
        responseTime?: number;
    }> {
        try {
            if (!this.currentLlm) {
                return {
                    success: false,
                    message: 'LLM not initialized'
                };
            }

            const startTime = Date.now();
            const testResponse = await this.currentLlm.translate(
                'user',
                'assistant',
                'Hello, this is a test.',
                'Respond with "Test successful"'
            );
            const responseTime = Date.now() - startTime;

            return {
                success: true,
                message: 'LLM connection test successful',
                responseTime
            };
        } catch (error) {
            return {
                success: false,
                message: `LLM connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}

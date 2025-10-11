"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
import { CommonApiresp, ChatApiResponse, ChatMessage } from "@/entityTypes/commonType";

/**
 * Chat request interface
 */
export interface ChatRequest {
    message: string;
    conversationId?: string;
    model?: string;
    systemPrompt?: string;
}

/**
 * Internal request data format for API calls
 */
interface ChatApiRequestData {
    message: string;
    conversation_id?: string;
    model?: string;
    system_prompt?: string;
}

/**
 * Chat stream response interface
 */
export interface ChatStreamResponse {
    chunk: string;
    isComplete: boolean;
    messageId?: string;
    conversationId?: string;
}

/**
 * Available chat models response
 */
export interface AvailableChatModelsResponse {
    models: {
        [key: string]: {
            name: string;
            description: string;
            maxTokens: number;
            supportsStreaming: boolean;
        };
    };
    default_model: string;
    total_models: number;
}

/**
 * API client for AI Chat management
 * 
 * Handles communication with remote AI chat service to send messages,
 * receive responses, and manage conversations.
 * 
 * Follows the same pattern as RagConfigApi for consistency.
 * 
 * @example
 * ```typescript
 * const api = new AiChatApi();
 * const response = await api.sendMessage('Hello, how are you?');
 * if (response.status) {
 *   console.log('AI Response:', response.data.message);
 * }
 * ```
 */
export class AiChatApi {
    private _httpClient: HttpClient;

    /**
     * Creates a new AiChatApi instance
     * Initializes the HTTP client for remote communication
     */
    constructor() {
        this._httpClient = new HttpClient();
    }

    /**
     * Send a chat message to the remote AI service
     * 
     * @param request - Chat request containing message and optional parameters
     * @returns Promise resolving to chat response
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const response = await api.sendMessage({
     *   message: 'What is TypeScript?',
     *   conversationId: 'conv-123'
     * });
     * ```
     */
    async sendMessage(request: ChatRequest): Promise<CommonApiresp<ChatApiResponse>> {
        const data: ChatApiRequestData = {
            message: request.message,
            conversation_id: request.conversationId,
            system_prompt: request.systemPrompt
        };
        
        // Only include model if specified
        if (request.model) {
            data.model = request.model;
        }
        
        return this._httpClient.postJson('/api/ai/chat/message', data);
    }

    /**
     * Stream a chat message to the remote AI service
     * 
     * This endpoint returns streaming chunks of the response for better UX.
     * 
     * @param request - Chat request containing message and optional parameters
     * @returns Promise resolving to stream response
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const stream = await api.streamMessage({
     *   message: 'Explain quantum computing',
     *   conversationId: 'conv-123'
     * });
     * ```
     */
    async streamMessage(request: ChatRequest): Promise<CommonApiresp<ReadableStream>> {
        const data: ChatApiRequestData = {
            message: request.message,
            conversation_id: request.conversationId,
            system_prompt: request.systemPrompt
        };
        
        // Only include model if specified
        if (request.model) {
            data.model = request.model;
        }
        
        return this._httpClient.postJson('/api/ai/ask/stream', data);
    }

    /**
     * Get available chat models from remote server
     * 
     * @returns Promise resolving to available models response
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const models = await api.getAvailableModels();
     * if (models.status) {
     *   console.log('Available models:', models.data.models);
     *   console.log('Default model:', models.data.default_model);
     * }
     * ```
     */
    async getAvailableModels(): Promise<CommonApiresp<AvailableChatModelsResponse>> {
        return this._httpClient.get('/api/ai/chat/models');
    }

    /**
     * Test connection to remote AI chat service
     * 
     * @returns Promise resolving to boolean indicating service availability
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * const isOnline = await api.testConnection();
     * if (isOnline.status) {
     *   console.log('AI chat service is available');
     * }
     * ```
     */
    async testConnection(): Promise<CommonApiresp<boolean>> {
        return this._httpClient.get('/api/ai/chat/healthcheck');
    }
}



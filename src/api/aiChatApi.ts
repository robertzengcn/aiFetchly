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
 * Convert Python-style dict string to valid JSON string
 * Handles: single quotes -> double quotes, None -> null, True -> true, False -> false
 */
function pythonDictToJson(pythonStr: string): string {
    return pythonStr
        // Replace None with null
        .replace(/:\s*None\b/g, ': null')
        .replace(/\bNone\s*,/g, 'null,')
        // Replace True with true
        .replace(/:\s*True\b/g, ': true')
        .replace(/\bTrue\s*,/g, 'true,')
        // Replace False with false
        .replace(/:\s*False\b/g, ': false')
        .replace(/\bFalse\s*,/g, 'false,')
        // Replace single quotes with double quotes (simple approach)
        // This handles the common case but may not work for all edge cases with nested quotes
        .replace(/'/g, '"');
}

/**
 * Stream event types from AI server
 */
export enum StreamEventType {
    TOKEN = "token",                          // Individual response tokens
    TOOL_CALL = "tool_call",                  // Tool execution requests
    TOOL_RESULT = "tool_result",              // Tool execution results
    ERROR = "error",                          // Error conditions
    DONE = "done",                            // Response completion
    CONVERSATION_START = "conversation_start", // Session initialization
    CONVERSATION_END = "conversation_end",    // Conversation termination
    PONG = "pong"                             // Keep alive
}

/**
 * Stream event format from /api/ai/ask/stream
 */
export interface StreamEvent {
    event: StreamEventType | string;
    data: {
        content: Record<string, unknown> | string;
        timestamp: string;
        toolName?: string;
        toolParams?: Record<string, unknown>;
        errorMessage?: string;
        conversationId?: string;
    };
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
     * This endpoint returns streaming events in the format:
     * { event: string, data: { content: {}, timestamp: string } }
     * 
     * @param request - Chat request containing message and optional parameters
     * @param onEvent - Callback function to handle each stream event
     * @returns Promise resolving when stream completes
     * @throws {Error} When network request fails
     * 
     * @example
     * ```typescript
     * await api.streamMessage(
     *   {
     *     message: 'Explain quantum computing',
     *     conversationId: 'conv-123'
     *   },
     *   (event) => {
     *     console.log('Event:', event.event, 'Data:', event.data);
     *   }
     * );
     * ```
     */
    async streamMessage(
        request: ChatRequest,
        onEvent: (event: StreamEvent) => void
    ): Promise<void> {
        const data: ChatApiRequestData = {
            message: request.message,
            conversation_id: request.conversationId,
            system_prompt: request.systemPrompt
        };
        
        // Only include model if specified
        if (request.model) {
            data.model = request.model;
        }
        
        const response = await this._httpClient.postStream('/api/ai/ask/stream', data);
        
        if (!response.body) {
            throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent: Partial<StreamEvent> = {};

        try {
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                // Keep the last incomplete line in the buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    
                    if (!trimmedLine) {
                        // Empty line signals end of event in SSE format
                        if (currentEvent.event && currentEvent.data) {
                            onEvent(currentEvent as StreamEvent);
                            currentEvent = {};
                        }
                        continue;
                    }

                    // Try to parse as complete JSON object first (for backwards compatibility)
                    if (trimmedLine.startsWith('{')) {
                        try {
                            // Convert Python-style dict to JSON if needed
                            const jsonStr = trimmedLine.includes("'") 
                                ? pythonDictToJson(trimmedLine) 
                                : trimmedLine;
                            const event: StreamEvent = JSON.parse(jsonStr);
                            onEvent(event);
                            continue;
                        } catch (error) {
                            // Not a complete JSON object, continue to SSE parsing
                        }
                    }

                    // Parse SSE format: "event: type" or "data: json"
                    if (trimmedLine.startsWith('event:')) {
                        const eventType = trimmedLine.substring(6).trim();
                        currentEvent.event = eventType as StreamEventType;
                    } else if (trimmedLine.startsWith('data:')) {
                        const dataStr = trimmedLine.substring(5).trim();
                        
                        // Ignore simple string data like 'pong' (keep-alive messages)
                        if (dataStr === 'pong' || (!dataStr.startsWith('{') && !dataStr.startsWith('['))) {
                            continue;
                        }
                        
                        try {
                            // Convert Python-style dict to JSON if needed
                            // const jsonStr = dataStr.startsWith('{') && dataStr.includes("'") 
                            //     ? pythonDictToJson(dataStr) 
                            //     : dataStr;
                            currentEvent.data = JSON.parse(dataStr);
                        } catch (error) {
                            console.error('Error parsing event data:', error, 'Data:', dataStr);
                            try{
                            const jsonStr = dataStr.startsWith('{') && dataStr.includes("'") 
                            ? pythonDictToJson(dataStr) 
                            : dataStr;
                            currentEvent.data = JSON.parse(jsonStr);
                        } catch (error) {
                            console.error('Error parsing event data:', error, 'Data:', dataStr);
                        }
                        }
                    }
                }
            }

            // Process any remaining event in progress
            if (currentEvent.event && currentEvent.data) {
                onEvent(currentEvent as StreamEvent);
            }

            // Process any remaining complete JSON in the buffer
            if (buffer.trim() && buffer.trim().startsWith('{')) {
                try {
                    // Convert Python-style dict to JSON if needed
                    const bufferStr = buffer.trim();
                    const jsonStr = bufferStr.includes("'") 
                        ? pythonDictToJson(bufferStr) 
                        : bufferStr;
                    const event: StreamEvent = JSON.parse(jsonStr);
                    onEvent(event);
                } catch (error) {
                    console.error('Error parsing final stream event:', error);
                }
            }
        } finally {
            reader.releaseLock();
        }
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



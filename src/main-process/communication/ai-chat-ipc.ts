import { ipcMain } from 'electron';
import { AiChatApi, ChatRequest, StreamEvent, StreamEventType } from '@/api/aiChatApi';
import { CommonMessage, ChatMessage, ChatHistoryResponse, ChatStreamChunk } from '@/entityTypes/commonType';
import { AIChatModule } from '@/modules/AIChatModule';
import { RagSearchModule, SearchRequest, SearchResponse } from '@/modules/RagSearchModule';
// import { SearchResult } from '@/service/VectorSearchService';
import {
    AI_CHAT_MESSAGE,
    AI_CHAT_STREAM,
    AI_CHAT_STREAM_CHUNK,
    AI_CHAT_STREAM_COMPLETE,
    AI_CHAT_HISTORY,
    AI_CHAT_CLEAR
} from '@/config/channellist';
import { Token } from '@/modules/token';
import { USERID } from '@/config/usersetting';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique conversation ID in format: user_id:uuid
 */
function generateConversationId(): string {
    const tokenService = new Token();
    const userId = tokenService.getValue(USERID) || 'anonymous';
    return `${userId}:${uuidv4()}`;
}

/**
 * Register AI Chat IPC handlers
 */
export function registerAiChatIpcHandlers(): void {
    console.log("AI Chat IPC handlers registered");

    // Send chat message (non-streaming)
    ipcMain.handle(AI_CHAT_MESSAGE, async (event, data): Promise<CommonMessage<ChatMessage | null>> => {
        try {
            const requestData = JSON.parse(data) as {
                message: string;
                conversationId?: string;
                model?: string;
                useRAG?: boolean;
                ragLimit?: number;
            };

            const aiChatApi = new AiChatApi();
            const chatModule = new AIChatModule();
            const ragSearchModule = new RagSearchModule();
            await ragSearchModule.initialize();
            
            // Generate new conversationId if not provided
            const conversationId = requestData.conversationId || generateConversationId();

            // Save user message to database
            const userMessageId = `user-${Date.now()}`;
            await chatModule.saveMessage({
                messageId: userMessageId,
                conversationId,
                role: 'user',
                content: requestData.message,
                timestamp: new Date()
            });

            // If useRAG is true, perform local RAG search and append results to the message
            let enhancedMessage = requestData.message;
            if (requestData.useRAG) {
                try {
                    const searchRequest: SearchRequest = {
                        query: requestData.message,
                        options: {
                            limit: requestData.ragLimit || 5
                        }
                    };
                    
                    const searchResponse: SearchResponse = await ragSearchModule.search(searchRequest);
                    
                    if (searchResponse.results.length > 0) {
                        // Format RAG results as context
                        const ragContext = searchResponse.results
                            .map((result, index) => {
                                return `[Document ${index + 1}: ${result.document.name}]\n${result.content}`;
                            })
                            .join('\n\n');
                        
                        // Prepend RAG context to the message
                        enhancedMessage = `Based on the following context from knowledge base:\n\n${ragContext}\n\n---\n\nUser question: ${requestData.message}`;
                        
                        console.log(`RAG search found ${searchResponse.results.length} relevant documents`);
                    } else {
                        console.log('RAG search returned no results, proceeding with original message');
                    }
                } catch (ragError) {
                    console.error('RAG search failed, proceeding without RAG context:', ragError);
                    // Continue with original message if RAG fails
                }
            }

            // Send to remote API
            const chatRequest: ChatRequest = {
                message: enhancedMessage,
                conversationId,
                model: requestData.model,
                useRAG: requestData.useRAG,
                ragLimit: requestData.ragLimit
            };

            const apiResponse = await aiChatApi.sendMessage(chatRequest);

            if (apiResponse.status && apiResponse.data) {
                // Save assistant message to database
                await chatModule.saveMessage({
                    messageId: apiResponse.data.messageId,
                    conversationId,
                    role: 'assistant',
                    content: apiResponse.data.message,
                    timestamp: new Date(),
                    model: apiResponse.data.model,
                    tokensUsed: apiResponse.data.tokensUsed
                });

                const assistantMessage: ChatMessage = {
                    id: apiResponse.data.messageId,
                    role: 'assistant',
                    content: apiResponse.data.message,
                    timestamp: new Date(),
                    conversationId
                };

                const response: CommonMessage<ChatMessage> = {
                    status: true,
                    msg: "Message sent successfully",
                    data: assistantMessage
                };
                return response;
            } else {
                const errorResponse: CommonMessage<null> = {
                    status: false,
                    msg: apiResponse.msg || "Failed to send message",
                    data: null
                };
                return errorResponse;
            }
        } catch (error) {
            console.error('AI Chat message error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Stream chat message
    ipcMain.on(AI_CHAT_STREAM, async (event, data): Promise<void> => {
        try {
            const requestData = JSON.parse(data) as {
                message: string;
                conversationId?: string;
                model?: string;
                useRAG?: boolean;
                ragLimit?: number;
            };

            const aiChatApi = new AiChatApi();
            const chatModule = new AIChatModule();
            const ragSearchModule = new RagSearchModule();
            await ragSearchModule.initialize();
            
            // Generate new conversationId if not provided
            const conversationId = requestData.conversationId || generateConversationId();

            // Save user message to database
            const userMessageId = `user-${Date.now()}`;
            await chatModule.saveMessage({
                messageId: userMessageId,
                conversationId,
                role: 'user',
                content: requestData.message,
                timestamp: new Date()
            });

            // If useRAG is true, perform local RAG search and append results to the message
            let enhancedMessage = requestData.message;
            if (requestData.useRAG) {
                try {
                    const searchRequest: SearchRequest = {
                        query: requestData.message,
                        options: {
                            limit: requestData.ragLimit || 5
                        }
                    };
                    
                    const searchResponse: SearchResponse = await ragSearchModule.search(searchRequest);
                    
                    if (searchResponse.results.length > 0) {
                        // Format RAG results as context
                        const ragContext = searchResponse.results
                            .map((result, index) => {
                                return `[Document ${index + 1}: ${result.document.name}]\n${result.content}`;
                            })
                            .join('\n\n');
                        
                        // Prepend RAG context to the message
                        enhancedMessage = `Based on the following context from knowledge base:\n\n${ragContext}\n\n---\n\nUser question: ${requestData.message}`;
                        
                        console.log(`RAG search found ${searchResponse.results.length} relevant documents`);
                    } else {
                        console.log('RAG search returned no results, proceeding with original message');
                    }
                } catch (ragError) {
                    console.error('RAG search failed, proceeding without RAG context:', ragError);
                    // Continue with original message if RAG fails
                }
            }

            // Send to remote API for streaming
            const chatRequest: ChatRequest = {
                message: enhancedMessage,
                conversationId:conversationId,
                model: requestData.model,
                useRAG: requestData.useRAG,
                ragLimit: requestData.ragLimit
            };

            const assistantMessageId = `assistant-${Date.now()}`;
            let fullContent = '';
            let streamConversationId = conversationId;
            let hasStartedConversation = false;

            // Stream message with event handler
            await aiChatApi.streamMessage(chatRequest, (streamEvent: StreamEvent) => {
                const eventType = streamEvent.event;
                
                // Extract content from the event data
                const extractContent = (): string => {
                    if (typeof streamEvent.data.content === 'string') {
                        return streamEvent.data.content;
                    }
                    return JSON.stringify(streamEvent.data.content);
                };

                switch (eventType) {
                    case StreamEventType.TOKEN:
                        // Individual response tokens - append to message and stream to UI
                        {
                            // Send conversation_start event on first token if not already sent
                            if (!hasStartedConversation) {
                                const startChunk: ChatStreamChunk = {
                                    content: '',
                                    isComplete: false,
                                    messageId: assistantMessageId,
                                    eventType: StreamEventType.CONVERSATION_START,
                                    conversationId: streamConversationId
                                };
                                event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(startChunk));
                                hasStartedConversation = true;
                            }

                            const content = extractContent();
                            fullContent += content;

                            const chunk: ChatStreamChunk = {
                                content: content,
                                isComplete: false,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.TOKEN
                            };
                            event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
                        }
                        break;

                    case StreamEventType.TOOL_CALL:
                        // Tool execution request - notify UI to show tool execution indicator
                        {
                            const toolName = streamEvent.data.toolName || 'Unknown Tool';
                            const toolParams = streamEvent.data.toolParams;

                            const chunk: ChatStreamChunk = {
                                content: `Executing tool: ${toolName}`,
                                isComplete: false,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.TOOL_CALL,
                                toolName: toolName,
                                toolParams: toolParams
                            };
                            event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
                        }
                        break;

                    case StreamEventType.TOOL_RESULT:
                        // Tool execution result - notify UI and continue streaming
                        {
                            const toolResult = streamEvent.data.content;

                            const chunk: ChatStreamChunk = {
                                content: '',
                                isComplete: false,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.TOOL_RESULT,
                                toolResult: typeof toolResult === 'object' ? toolResult as Record<string, unknown> : { result: toolResult }
                            };
                            event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
                        }
                        break;

                    case StreamEventType.ERROR:
                        // Error occurred - notify UI and stop streaming
                        {
                            const errorMessage = streamEvent.data.errorMessage || extractContent() || 'An error occurred during streaming';

                            const errorChunk: ChatStreamChunk = {
                                content: '',
                                isComplete: true,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.ERROR,
                                errorMessage: errorMessage
                            };
                            event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
                        }
                        break;

                    case StreamEventType.DONE:
                        // Streaming complete - finalize message
                        {
                            const completeChunk: ChatStreamChunk = {
                                content: '',
                                isComplete: true,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.DONE
                            };
                            event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(completeChunk));
                        }
                        break;

                    case StreamEventType.CONVERSATION_START:
                        // Conversation initialization
                        {
                            if (streamEvent.data.conversationId) {
                                streamConversationId = streamEvent.data.conversationId;
                            }

                            const chunk: ChatStreamChunk = {
                                content: '',
                                isComplete: false,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.CONVERSATION_START,
                                conversationId: streamConversationId
                            };
                            event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
                        }
                        break;

                    case StreamEventType.CONVERSATION_END:
                        // Conversation termination
                        {
                            const chunk: ChatStreamChunk = {
                                content: '',
                                isComplete: true,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.CONVERSATION_END
                            };
                            event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(chunk));
                        }
                        break;

                    case StreamEventType.PONG:
                        // Keep-alive - no action needed, just log
                        console.log('Received keep-alive pong');
                        break;

                    default:
                        // Unknown event type - log and potentially handle as token
                        console.warn('Unknown stream event type:', eventType);
                        break;
                }
            });

            // Save assistant message to database if we have content
            if (fullContent.trim()) {
                await chatModule.saveMessage({
                    messageId: assistantMessageId,
                    conversationId: streamConversationId,
                    role: 'assistant',
                    content: fullContent,
                    timestamp: new Date()
                });
            }
        } catch (error) {
            console.error('AI Chat stream error:', error);
            const errorChunk: ChatStreamChunk = {
                content: '',
                isComplete: true,
                eventType: StreamEventType.ERROR,
                errorMessage: error instanceof Error ? error.message : 'Unknown error occurred'
            };
            event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
        }
    });

    // Get chat history
    ipcMain.handle(AI_CHAT_HISTORY, async (event, data): Promise<CommonMessage<ChatHistoryResponse | null>> => {
        try {
            const requestData = data ? JSON.parse(data) : {};
            const conversationId = requestData.conversationId;

            const chatModule = new AIChatModule();
            const messageEntities = await chatModule.getConversationMessages(conversationId);

            // Convert entities to ChatMessage format
            const messages: ChatMessage[] = messageEntities.map(entity => ({
                id: entity.messageId,
                role: entity.role as 'user' | 'assistant' | 'system',
                content: entity.content,
                timestamp: entity.timestamp,
                conversationId: entity.conversationId
            }));

            const response: CommonMessage<ChatHistoryResponse> = {
                status: true,
                msg: "Chat history retrieved successfully",
                data: {
                    messages,
                    totalMessages: messages.length,
                    conversationId
                }
            };
            return response;
        } catch (error) {
            console.error('AI Chat history error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Clear chat history
    ipcMain.handle(AI_CHAT_CLEAR, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const requestData = data ? JSON.parse(data) : {};
            const conversationId = requestData.conversationId;

            const chatModule = new AIChatModule();
            console.log('conversationId', conversationId);
            if (conversationId === 'all') {
                // Clear all conversations from database
                await chatModule.clearAllHistory();
            } else {
                // Clear specific conversation from database
                await chatModule.clearConversation(conversationId);
            }

            const response: CommonMessage<void> = {
                status: true,
                msg: "Chat history cleared successfully"
            };
            return response;
        } catch (error) {
            console.error('AI Chat clear error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });
}


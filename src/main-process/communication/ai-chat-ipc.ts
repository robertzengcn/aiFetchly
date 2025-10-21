import { ipcMain } from 'electron';
import { AiChatApi, ChatRequest, StreamEvent } from '@/api/aiChatApi';
import { CommonMessage, ChatMessage, ChatHistoryResponse, ChatStreamChunk } from '@/entityTypes/commonType';
import { AIChatModule } from '@/modules/AIChatModule';
import {
    AI_CHAT_MESSAGE,
    AI_CHAT_STREAM,
    AI_CHAT_STREAM_CHUNK,
    AI_CHAT_STREAM_COMPLETE,
    AI_CHAT_HISTORY,
    AI_CHAT_CLEAR
} from '@/config/channellist';

const currentConversationId = 'default';

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
            };

            const aiChatApi = new AiChatApi();
            const chatModule = new AIChatModule();
            const conversationId = requestData.conversationId || currentConversationId;

            // Save user message to database
            const userMessageId = `user-${Date.now()}`;
            await chatModule.saveMessage({
                messageId: userMessageId,
                conversationId,
                role: 'user',
                content: requestData.message,
                timestamp: new Date()
            });

            // Send to remote API
            const chatRequest: ChatRequest = {
                message: requestData.message,
                conversationId,
                model: requestData.model
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
            };

            const aiChatApi = new AiChatApi();
            const chatModule = new AIChatModule();
            const conversationId = requestData.conversationId || currentConversationId;

            // Save user message to database
            const userMessageId = `user-${Date.now()}`;
            await chatModule.saveMessage({
                messageId: userMessageId,
                conversationId,
                role: 'user',
                content: requestData.message,
                timestamp: new Date()
            });

            // Send to remote API for streaming
            const chatRequest: ChatRequest = {
                message: requestData.message,
                conversationId,
                model: requestData.model
            };

            const assistantMessageId = `assistant-${Date.now()}`;
            let fullContent = '';
            let isStreamComplete = false;

            // Stream message with event handler
            await aiChatApi.streamMessage(chatRequest, (streamEvent: StreamEvent) => {
                // Handle stream event based on event type
                if (streamEvent.event === 'message' || streamEvent.event === 'chunk') {
                    // Extract content from the event data
                    const content = typeof streamEvent.data.content === 'string' 
                        ? streamEvent.data.content 
                        : JSON.stringify(streamEvent.data.content);
                    
                    fullContent += content;

                    // Send chunk to renderer
                    const chunk: ChatStreamChunk = {
                        content: content,
                        isComplete: false,
                        messageId: assistantMessageId
                    };
                    event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
                } else if (streamEvent.event === 'done' || streamEvent.event === 'complete') {
                    isStreamComplete = true;
                }
            });

            // Send completion
            const completeChunk: ChatStreamChunk = {
                content: '',
                isComplete: true,
                messageId: assistantMessageId
            };
            event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(completeChunk));

            // Save assistant message to database
            await chatModule.saveMessage({
                messageId: assistantMessageId,
                conversationId,
                role: 'assistant',
                content: fullContent,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('AI Chat stream error:', error);
            const errorChunk: ChatStreamChunk = {
                content: error instanceof Error ? error.message : 'Unknown error occurred',
                isComplete: true
            };
            event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
        }
    });

    // Get chat history
    ipcMain.handle(AI_CHAT_HISTORY, async (event, data): Promise<CommonMessage<ChatHistoryResponse | null>> => {
        try {
            const requestData = data ? JSON.parse(data) : {};
            const conversationId = requestData.conversationId || currentConversationId;

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
            const conversationId = requestData.conversationId || currentConversationId;

            const chatModule = new AIChatModule();

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


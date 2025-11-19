import { ipcMain } from 'electron';
import { AiChatApi, ChatRequest, StreamEvent, StreamEventType } from '@/api/aiChatApi';
import { AVAILABLE_TOOL_FUNCTIONS } from '@/config/aiTools.config';
import { CommonMessage, ChatMessage, ChatHistoryResponse, ChatStreamChunk } from '@/entityTypes/commonType';
import { AIChatModule } from '@/modules/AIChatModule';
import { RagSearchModule, SearchRequest, SearchResponse } from '@/modules/RagSearchModule';
import { SearchModule } from '@/modules/SearchModule';
import { SearchTaskStatus } from '@/model/SearchTask.model';
// import { SearchResult } from '@/service/VectorSearchService';
import {
    AI_CHAT_MESSAGE,
    AI_CHAT_STREAM,
    AI_CHAT_STREAM_CHUNK,
    AI_CHAT_STREAM_COMPLETE,
    AI_CHAT_HISTORY,
    AI_CHAT_CLEAR,
    AI_CHAT_CONVERSATIONS
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
                ragLimit: requestData.ragLimit,
                functions: AVAILABLE_TOOL_FUNCTIONS
            };

            const assistantMessageId = `assistant-${Date.now()}`;
            let fullContent = '';
            let streamConversationId = conversationId;
            let hasStartedConversation = false;
            // Track pending tool calls by tool ID
            const pendingToolCalls = new Set<string>();
            // Store deferred completion chunks to send when all tools are done
            let deferredCompletionChunk: ChatStreamChunk | null = null;

            // Helper function to check if we can send completion
            const canSendCompletion = (): boolean => {
                return pendingToolCalls.size === 0;
            };

            // Common handler for processing a single stream event and forwarding to UI
            const processStreamEvent = (streamEvent: StreamEvent): void => {
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
                        // Tool execution request - execute locally and send result to UI
                        // Handle nested data structure: data.data contains {name, id, arguments}
                        {
                            const toolCallData = streamEvent.data.data;
                            const toolName = toolCallData?.name || undefined;
                            if(!toolName){
                                throw new Error('tool name is required');
                            }
                            const toolParams = toolCallData?.arguments || {};
                            const toolId = toolCallData?.id || `tool-${Date.now()}`;
                            const content = typeof streamEvent.data.content === 'string' 
                                ? streamEvent.data.content 
                                : `Executing tool: ${toolName}`;

                            // Add tool to pending set
                            if (toolId) {
                                pendingToolCalls.add(toolId);
                                console.log(`Tool call started: ${toolName} (ID: ${toolId}), pending: ${pendingToolCalls.size}`);
                            }

                            // Notify UI that tool is being executed
                            const chunk: ChatStreamChunk = {
                                content: content,
                                isComplete: false,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.TOOL_CALL,
                                toolName: toolName,
                                toolParams: toolParams,
                                toolId: toolId
                            };
                            event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
                            
                            // Execute the tool locally (async, don't block)
                            (async () => {
                                const toolStartMs = Date.now();
                                try {
                                    let toolResult: Record<string, unknown> = {};
                                    
                                    // Check which function is being called and execute it
                                    switch (toolName) {
                                        case 'scrape_urls_from_google':
                                        case 'scrape_urls_from_bing': {
                                            const searchModule = new SearchModule();
                                            const query = typeof toolParams.query === 'string' ? toolParams.query : '';
                                            const numResults = typeof toolParams.num_results === 'number' ? toolParams.num_results : 10;
                                            if(!query){
                                                throw new Error('parameter of Query is required');
                                            }
                                            // Map tool name to engine name
                                            const engineName = toolName === 'scrape_urls_from_google' ? 'Google' : 'Bing';
                                            
                                            // Calculate num_pages based on num_results (assuming ~10 results per page)
                                            const numPages = Math.ceil(numResults / 10);
                                            
                                            // Execute search
                                            const taskId = await searchModule.searchByKeywordAndEngine(
                                                [query],
                                                engineName,
                                                {
                                                    num_pages: numPages,
                                                    concurrency: 1,
                                                    notShowBrowser: false
                                                }
                                            );
                                            
                                            // Poll task status until complete or error (max 60 seconds)
                                            let taskStatus: SearchTaskStatus | null = null;
                                            const maxWaitTime = 60000; // 60 seconds
                                            const pollInterval = 1000; // 1 second
                                            const startTime = Date.now();
                                            
                                            while (Date.now() - startTime < maxWaitTime) {
                                                taskStatus = await searchModule.getTaskStatus(taskId);
                                                if (taskStatus === null) {
                                                    throw new Error(`Task ${taskId} not found`);
                                                }
                                                if (taskStatus === SearchTaskStatus.Complete || taskStatus === SearchTaskStatus.Error) {
                                                    break;
                                                }
                                                await new Promise(resolve => setTimeout(resolve, pollInterval));
                                            }
                                            
                                            // Check if task completed successfully
                                            if (taskStatus !== SearchTaskStatus.Complete) {
                                                throw new Error(`Search task ${taskId} did not complete successfully. Status: ${taskStatus}`);
                                            }
                                            
                                            // Get search results
                                            const results = await searchModule.listSearchResult(taskId, 1, numResults);
                                            
                                            toolResult = {
                                                success: true,
                                                taskId: taskId,
                                                query: query,
                                                engine: engineName,
                                                results: results.map(r => ({
                                                    title: r.title,
                                                    link: r.link,
                                                    snippet: r.snippet,
                                                    visible_link: r.visible_link
                                                })),
                                                totalResults: results.length
                                            };
                                            break;
                                        }
                                        
                                        case 'search_yellow_pages': {
                                            // TODO: Implement Yellow Pages search when module is available
                                            toolResult = {
                                                success: false,
                                                error: 'Yellow Pages search not yet implemented'
                                            };
                                            break;
                                        }
                                        
                                        case 'extract_emails_from_results': {
                                            // TODO: Implement email extraction when module is available
                                            toolResult = {
                                                success: false,
                                                error: 'Email extraction not yet implemented'
                                            };
                                            break;
                                        }
                                        
                                        default:
                                            toolResult = {
                                                success: false,
                                                error: `Unknown tool: ${toolName}`
                                            };
                                    }
                                    
                                    // Send tool result to UI
                                    const resultChunk: ChatStreamChunk = {
                                        content: '',
                                        isComplete: false,
                                        messageId: assistantMessageId,
                                        eventType: StreamEventType.TOOL_RESULT,
                                        toolResult: toolResult
                                    };
                                    event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(resultChunk));

                                    // Also send tool result back to AI server to continue the stream
                                    try {
                                        const { success: _s, ...resultWithoutSuccess } = toolResult as Record<string, unknown> & { success?: unknown };
                                        const successFlag = typeof (toolResult as { success?: unknown }).success === 'boolean'
                                            ? (toolResult as { success?: boolean }).success as boolean
                                            : true;
                                        const execMs = Date.now() - toolStartMs;

                                        const aiToolResult = [{
                                            tool_call_id: toolId,
                                            tool_name: toolName,
                                            success: successFlag,
                                            result: resultWithoutSuccess,
                                            execution_time_ms: execMs
                                        }];

                                        // Reuse the same event processor for the continue stream
                                        await aiChatApi.streamContinueWithToolResults(
                                            streamConversationId,
                                            aiToolResult,
                                            processStreamEvent,
                                            AVAILABLE_TOOL_FUNCTIONS
                                        );
                                    } catch (sendErr) {
                                        console.error('Failed to send tool result to AI server:', sendErr);
                                    }
                                    
                                    // Remove tool from pending set
                                    if (toolId) {
                                        pendingToolCalls.delete(toolId);
                                        console.log(`Tool call completed: ${toolName} (ID: ${toolId}), pending: ${pendingToolCalls.size}`);
                                        // Check if we can send deferred completion
                                        sendDeferredCompletionIfReady();
                                    }
                                    
                                } catch (error) {
                                    console.error(`Error executing tool ${toolName}:`, error);
                                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                                    
                                    const errorResult: ChatStreamChunk = {
                                        content: '',
                                        isComplete: false,
                                        messageId: assistantMessageId,
                                        eventType: StreamEventType.TOOL_RESULT,
                                        toolResult: {
                                            success: false,
                                            error: errorMessage
                                        }
                                    };
                                    event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(errorResult));
                                    
                                    // Remove tool from pending set even on error
                                    if (toolId) {
                                        pendingToolCalls.delete(toolId);
                                        console.log(`Tool call failed: ${toolName} (ID: ${toolId}), pending: ${pendingToolCalls.size}`);
                                        
                                        // Send completion message to AI_CHAT_STREAM_COMPLETE on error
                                        const errorCompletionChunk: ChatStreamChunk = {
                                            content: '',
                                            isComplete: true,
                                            messageId: assistantMessageId,
                                            eventType: StreamEventType.ERROR,
                                            errorMessage: `Tool execution failed: ${errorMessage}`,
                                            toolName: toolName,
                                            toolId: toolId
                                        };
                                        
                                        // Check if we can send completion (no other pending tools)
                                        if (canSendCompletion()) {
                                            event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorCompletionChunk));
                                            console.log(`Sent error completion for tool ${toolName} (ID: ${toolId})`);
                                        } else {
                                            // Store as deferred completion if other tools are pending
                                            console.log(`Deferring error completion due to ${pendingToolCalls.size} pending tool calls`);
                                            deferredCompletionChunk = errorCompletionChunk;
                                            // Still check if we can send deferred completion
                                            sendDeferredCompletionIfReady();
                                        }
                                    }
                                }
                            })();
                        }
                        break;

                    case StreamEventType.TOOL_RESULT:
                        // Tool execution result from server - notify UI and continue streaming
                        {
                            const toolResult = streamEvent.data.content;
                            const toolCallData = streamEvent.data.data;
                            const toolId = toolCallData?.id;

                            // Remove tool from pending set if this is a server result
                            if (toolId && pendingToolCalls.has(toolId)) {
                                pendingToolCalls.delete(toolId);
                                console.log(`Tool result received from server (ID: ${toolId}), pending: ${pendingToolCalls.size}`);
                                // Check if we can send deferred completion
                                sendDeferredCompletionIfReady();
                            }

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
                            const errorMessage =  extractContent() || 'An error occurred during streaming';

                            const errorChunk: ChatStreamChunk = {
                                content: '',
                                isComplete: true,
                                messageId: assistantMessageId,
                                eventType: StreamEventType.ERROR,
                                errorMessage: errorMessage
                            };
                            
                            // Only send completion if no pending tool calls
                            if (canSendCompletion()) {
                                event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
                            } else {
                                console.log(`Deferring ERROR completion due to ${pendingToolCalls.size} pending tool calls`);
                                // Store error and wait for tool calls to complete
                                deferredCompletionChunk = errorChunk;
                            }
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
                            
                            // Only send completion if no pending tool calls
                            if (canSendCompletion()) {
                                event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(completeChunk));
                            } else {
                                console.log(`Deferring DONE completion due to ${pendingToolCalls.size} pending tool calls`);
                                // Store completion and wait for tool calls to complete
                                deferredCompletionChunk = completeChunk;
                            }
                        }
                        break;

                    case StreamEventType.CONVERSATION_START:
                        // Conversation initialization
                        {
                            // if (streamEvent.data?.data?.conversationId) {
                            //     streamConversationId = streamEvent.data.conversationId;
                            // }

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
                            
                            // Only send completion if no pending tool calls
                            if (canSendCompletion()) {
                                event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(chunk));
                            } else {
                                console.log(`Deferring CONVERSATION_END completion due to ${pendingToolCalls.size} pending tool calls`);
                                // Store completion and wait for tool calls to complete
                                deferredCompletionChunk = chunk;
                            }
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
            };

            // Helper function to send deferred completion if ready
            const sendDeferredCompletionIfReady = (): void => {
                if (canSendCompletion() && deferredCompletionChunk) {
                    event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(deferredCompletionChunk));
                    deferredCompletionChunk = null;
                    console.log('Sent deferred completion message');
                }
            };

            // Stream message with event handler
            await aiChatApi.streamMessage(chatRequest, (streamEvent: StreamEvent) => {
                processStreamEvent(streamEvent);
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
            if(error instanceof Error && error.message.includes('tool name is required')){
                return;
            }
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
            const requestConversationId = requestData.conversationId;

            const chatModule = new AIChatModule();
            const messageEntities = await chatModule.getConversationMessages(requestConversationId);

            // Convert entities to ChatMessage format
            const messages: ChatMessage[] = messageEntities.map(entity => ({
                id: entity.messageId,
                role: entity.role as 'user' | 'assistant' | 'system',
                content: entity.content,
                timestamp: entity.timestamp,
                conversationId: entity.conversationId
            }));

            // Extract conversationId from messages if not provided in request
            // Use the conversationId from the first message if available, otherwise use the request ID
            const resolvedConversationId = messages.length > 0 
                ? messages[0].conversationId 
                : requestConversationId;

            const response: CommonMessage<ChatHistoryResponse> = {
                status: true,
                msg: "Chat history retrieved successfully",
                data: {
                    messages,
                    totalMessages: messages.length,
                    conversationId: resolvedConversationId
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

    // Get all conversations with metadata
    ipcMain.handle(AI_CHAT_CONVERSATIONS, async (event, data): Promise<CommonMessage<Array<{
        conversationId: string;
        lastMessage: string;
        lastMessageTimestamp: Date;
        messageCount: number;
        createdAt: Date;
    }> | null>> => {
        try {
            const chatModule = new AIChatModule();
            const conversations = await chatModule.getConversationsWithMetadata();

            const response: CommonMessage<Array<{
                conversationId: string;
                lastMessage: string;
                lastMessageTimestamp: Date;
                messageCount: number;
                createdAt: Date;
            }>> = {
                status: true,
                msg: "Conversations retrieved successfully",
                data: conversations
            };
            return response;
        } catch (error) {
            console.error('AI Chat conversations error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });
}


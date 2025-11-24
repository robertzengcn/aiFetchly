import { IpcMainEvent } from 'electron';
import { StreamEvent, StreamEventType } from '@/api/aiChatApi';
import { ChatStreamChunk } from '@/entityTypes/commonType';
import {
    AI_CHAT_STREAM_CHUNK,
    AI_CHAT_STREAM_COMPLETE
} from '@/config/channellist';
import { AIChatModule } from '@/modules/AIChatModule';
import { AiChatApi } from '@/api/aiChatApi';
import { AVAILABLE_TOOL_FUNCTIONS } from '@/config/aiTools.config';
import { ToolExecutionService } from './ToolExecutionService';
import { ToolExecutor } from './ToolExecutor';
import { MessageType } from '@/entityTypes/commonType';

/**
 * Interface for stream processing state
 */
export interface StreamState {
    assistantMessageId: string;
    fullContent: string;
    streamConversationId: string;
    hasStartedConversation: boolean;
    pendingToolCalls: Set<string>;
    deferredCompletionChunk: ChatStreamChunk | null;
    messageSaved: boolean;
    chatModule: AIChatModule;
    aiChatApi: AiChatApi;
}

/**
 * Handles processing of stream events from AI chat API
 */
export class StreamEventProcessor {
    private event: IpcMainEvent;
    private state: StreamState;

    constructor(event: IpcMainEvent, state: StreamState) {
        this.event = event;
        this.state = state;
    }

    /**
     * Process a single stream event
     */
    processEvent(streamEvent: StreamEvent): void {
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
                this.handleTokenEvent(streamEvent, extractContent);
                break;

            case StreamEventType.TOOL_CALL:
                this.handleToolCallEvent(streamEvent);
                break;

            case StreamEventType.TOOL_RESULT:
                this.handleToolResultEvent(streamEvent);
                break;

            case StreamEventType.ERROR:
                this.handleErrorEvent(extractContent);
                break;

            case StreamEventType.DONE:
                this.handleDoneEvent();
                break;

            case StreamEventType.CONVERSATION_START:
                this.handleConversationStartEvent();
                break;

            case StreamEventType.CONVERSATION_END:
                this.handleConversationEndEvent();
                break;

            case StreamEventType.PONG:
                console.log('Received keep-alive pong');
                break;

            default:
                console.warn('Unknown stream event type:', eventType);
                break;
        }
    }

    /**
     * Handle TOKEN event - append content to message
     */
    private handleTokenEvent(streamEvent: StreamEvent, extractContent: () => string): void {
        // Send conversation_start event on first token if not already sent
        if (!this.state.hasStartedConversation) {
            const startChunk: ChatStreamChunk = {
                content: '',
                isComplete: false,
                messageId: this.state.assistantMessageId,
                eventType: StreamEventType.CONVERSATION_START,
                conversationId: this.state.streamConversationId
            };
            this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(startChunk));
            this.state.hasStartedConversation = true;
        }

        const content = extractContent();
        this.state.fullContent += content;

        const chunk: ChatStreamChunk = {
            content: content,
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.TOKEN
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
    }

    /**
     * Handle TOOL_CALL event - execute tool and send result
     */
    private handleToolCallEvent(streamEvent: StreamEvent): void {
        const toolCallData = streamEvent.data.data;
        const toolName = toolCallData?.name || undefined;
        if (!toolName) {
            throw new Error('tool name is required');
        }
        const toolParams = toolCallData?.arguments || {};
        const toolId = toolCallData?.id || `tool-${Date.now()}`;
        const content = typeof streamEvent.data.content === 'string' 
            ? streamEvent.data.content 
            : `Executing tool: ${toolName}`;

        // Add tool to pending set
        if (toolId) {
            this.state.pendingToolCalls.add(toolId);
            console.log(`Tool call started: ${toolName} (ID: ${toolId}), pending: ${this.state.pendingToolCalls.size}`);
        }

        // Save tool call to database
        ToolExecutionService.saveToolCall(
            this.state.chatModule,
            this.state.streamConversationId,
            toolId,
            toolName,
            toolParams
        ).catch(saveError => {
            console.error('Failed to save tool call to database:', saveError);
        });

        // Notify UI that tool is being executed
        const chunk: ChatStreamChunk = {
            content: content,
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.TOOL_CALL,
            toolName: toolName,
            toolParams: toolParams,
            toolId: toolId
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));

        // Execute the tool asynchronously
        this.executeTool(toolId, toolName, toolParams);
    }

    /**
     * Execute a tool and handle the result
     */
    private async executeTool(toolId: string, toolName: string, toolParams: Record<string, unknown>): Promise<void> {
        const toolStartMs = Date.now();
        try {
            // Use ToolExecutor to execute the tool
            const toolResult = await ToolExecutor.execute(
                toolName,
                toolParams,
                this.state.streamConversationId
            );

            // Save tool result to database
            await this.saveToolResult(toolId, toolName, toolResult, toolStartMs);

            // Send tool result to UI
            const resultChunk: ChatStreamChunk = {
                content: '',
                isComplete: false,
                messageId: this.state.assistantMessageId,
                eventType: StreamEventType.TOOL_RESULT,
                toolResult: toolResult
            };
            this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(resultChunk));

            // Send tool result back to AI server to continue the stream
            await this.sendToolResultToAI(toolId, toolName, toolResult, toolStartMs);

            // Remove tool from pending set
            if (toolId) {
                this.state.pendingToolCalls.delete(toolId);
                console.log(`Tool call completed: ${toolName} (ID: ${toolId}), pending: ${this.state.pendingToolCalls.size}`);
                this.sendDeferredCompletionIfReady();
            }

        } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            
            await this.handleToolError(toolId, toolName, errorMessage, toolStartMs);
        }
    }

    /**
     * Save tool result to database
     */
    private async saveToolResult(
        toolId: string,
        toolName: string,
        toolResult: Record<string, unknown>,
        toolStartMs: number
    ): Promise<void> {
        try {
            const successFlag = typeof (toolResult as { success?: unknown }).success === 'boolean'
                ? (toolResult as { success?: boolean }).success as boolean
                : true;
            const execMs = Date.now() - toolStartMs;

            const metadata = ToolExecutionService.prepareToolMetadata(
                toolName,
                toolId,
                successFlag,
                execMs,
                toolResult
            );

            await ToolExecutionService.saveToolResult(
                this.state.chatModule,
                this.state.streamConversationId,
                toolId,
                toolName,
                toolResult,
                metadata
            );
        } catch (saveError) {
            console.error('Failed to save tool result to database:', saveError);
        }
    }

    /**
     * Send tool result back to AI server
     */
    private async sendToolResultToAI(
        toolId: string,
        toolName: string,
        toolResult: Record<string, unknown>,
        toolStartMs: number
    ): Promise<void> {
        try {
            const successFlag = typeof (toolResult as { success?: unknown }).success === 'boolean'
                ? (toolResult as { success?: boolean }).success as boolean
                : true;
            const execMs = Date.now() - toolStartMs;

            const formattedResultForLLM = ToolExecutionService.formatToolResultForLLM(
                toolName,
                toolResult,
                successFlag
            );

            const aiToolResult = [{
                tool_call_id: toolId,
                tool_name: toolName,
                success: successFlag,
                result: formattedResultForLLM,
                execution_time_ms: execMs
            }];

            // Continue the stream with tool results
            await this.state.aiChatApi.streamContinueWithToolResults(
                this.state.streamConversationId,
                aiToolResult,
                (streamEvent: StreamEvent) => this.processEvent(streamEvent),
                AVAILABLE_TOOL_FUNCTIONS
            );
        } catch (sendErr) {
            console.error('Failed to send tool result to AI server:', sendErr);
        }
    }

    /**
     * Handle tool execution error
     */
    private async handleToolError(
        toolId: string,
        toolName: string,
        errorMessage: string,
        toolStartMs: number
    ): Promise<void> {
        const errorResult: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.TOOL_RESULT,
            toolResult: {
                success: false,
                error: errorMessage
            }
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(errorResult));

        // Save error tool result to database
        try {
            const errorToolResult = {
                success: false,
                error: errorMessage
            };

            const errorMetadata = ToolExecutionService.prepareToolMetadata(
                toolName,
                toolId,
                false,
                Date.now() - toolStartMs,
                errorToolResult,
                errorMessage
            );

            await ToolExecutionService.saveToolResult(
                this.state.chatModule,
                this.state.streamConversationId,
                toolId,
                toolName,
                errorToolResult,
                errorMetadata
            );
        } catch (saveError) {
            console.error('Failed to save error tool result to database:', saveError);
        }

        // Remove tool from pending set even on error
        if (toolId) {
            this.state.pendingToolCalls.delete(toolId);
            console.log(`Tool call failed: ${toolName} (ID: ${toolId}), pending: ${this.state.pendingToolCalls.size}`);
            
            // Handle completion on error
            if (this.canSendCompletion()) {
                await this.saveMessageToDatabase();
                const errorCompletionChunk: ChatStreamChunk = {
                    content: '',
                    isComplete: true,
                    messageId: this.state.assistantMessageId,
                    eventType: StreamEventType.ERROR,
                    errorMessage: `Tool execution failed: ${errorMessage}`,
                    toolName: toolName,
                    toolId: toolId
                };
                this.event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorCompletionChunk));
                console.log(`Sent error completion for tool ${toolName} (ID: ${toolId})`);
            } else {
                console.log(`Deferring error completion due to ${this.state.pendingToolCalls.size} pending tool calls`);
                this.state.deferredCompletionChunk = {
                    content: '',
                    isComplete: true,
                    messageId: this.state.assistantMessageId,
                    eventType: StreamEventType.ERROR,
                    errorMessage: `Tool execution failed: ${errorMessage}`,
                    toolName: toolName,
                    toolId: toolId
                };
                this.sendDeferredCompletionIfReady();
            }
        }
    }

    /**
     * Handle TOOL_RESULT event from server
     */
    private handleToolResultEvent(streamEvent: StreamEvent): void {
        const toolResult = streamEvent.data.content;
        const toolCallData = streamEvent.data.data;
        const toolId = toolCallData?.id;
        const toolName = toolCallData?.name;

        // Save tool result from server to database
        if (toolId && toolName) {
            (async () => {
                try {
                    const serverMetadata = ToolExecutionService.prepareToolMetadata(
                        toolName,
                        toolId,
                        true,
                        0,
                        toolResult
                    );

                    const extendedMetadata = {
                        ...serverMetadata,
                        source: 'server'
                    };

                    await ToolExecutionService.saveToolResult(
                        this.state.chatModule,
                        this.state.streamConversationId,
                        toolId,
                        toolName,
                        toolResult,
                        extendedMetadata
                    );
                } catch (saveError) {
                    console.error('Failed to save server tool result to database:', saveError);
                }
            })();
        }

        // Remove tool from pending set if this is a server result
        if (toolId && this.state.pendingToolCalls.has(toolId)) {
            this.state.pendingToolCalls.delete(toolId);
            console.log(`Tool result received from server (ID: ${toolId}), pending: ${this.state.pendingToolCalls.size}`);
            this.sendDeferredCompletionIfReady();
        }

        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.TOOL_RESULT,
            toolResult: typeof toolResult === 'object' ? toolResult as Record<string, unknown> : { result: toolResult }
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
    }

    /**
     * Handle ERROR event
     */
    private handleErrorEvent(extractContent: () => string): void {
        const errorMessage = extractContent() || 'An error occurred during streaming';

        const errorChunk: ChatStreamChunk = {
            content: '',
            isComplete: true,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.ERROR,
            errorMessage: errorMessage
        };

        if (this.canSendCompletion()) {
            this.saveMessageToDatabase().catch(err => {
                console.error('Error saving message on ERROR event:', err);
            });
            this.event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
        } else {
            console.log(`Deferring ERROR completion due to ${this.state.pendingToolCalls.size} pending tool calls`);
            this.state.deferredCompletionChunk = errorChunk;
        }
    }

    /**
     * Handle DONE event
     */
    private handleDoneEvent(): void {
        const completeChunk: ChatStreamChunk = {
            content: '',
            isComplete: true,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.DONE
        };

        if (this.canSendCompletion()) {
            this.saveMessageToDatabase().catch(err => {
                console.error('Error saving message on DONE:', err);
            });
            this.event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(completeChunk));
        } else {
            console.log(`Deferring DONE completion due to ${this.state.pendingToolCalls.size} pending tool calls`);
            this.state.deferredCompletionChunk = completeChunk;
        }
    }

    /**
     * Handle CONVERSATION_START event
     */
    private handleConversationStartEvent(): void {
        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.CONVERSATION_START,
            conversationId: this.state.streamConversationId
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
    }

    /**
     * Handle CONVERSATION_END event
     */
    private handleConversationEndEvent(): void {
        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: true,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.CONVERSATION_END
        };

        if (this.canSendCompletion()) {
            this.saveMessageToDatabase().catch(err => {
                console.error('Error saving message on CONVERSATION_END:', err);
            });
            this.event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(chunk));
        } else {
            console.log(`Deferring CONVERSATION_END completion due to ${this.state.pendingToolCalls.size} pending tool calls`);
            this.state.deferredCompletionChunk = chunk;
        }
    }

    /**
     * Check if we can send completion
     */
    private canSendCompletion(): boolean {
        return this.state.pendingToolCalls.size === 0;
    }

    /**
     * Send deferred completion if ready
     */
    private sendDeferredCompletionIfReady(): void {
        if (this.canSendCompletion() && this.state.deferredCompletionChunk) {
            this.saveMessageToDatabase().catch(err => {
                console.error('Error saving message on deferred completion:', err);
            });
            this.event.sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(this.state.deferredCompletionChunk));
            this.state.deferredCompletionChunk = null;
            console.log('Sent deferred completion message');
        }
    }

    /**
     * Save message to database
     */
    private async saveMessageToDatabase(): Promise<void> {
        if (!this.state.messageSaved && this.state.fullContent.trim()) {
            try {
                await this.state.chatModule.saveMessage({
                    messageId: this.state.assistantMessageId,
                    conversationId: this.state.streamConversationId,
                    role: 'assistant',
                    content: this.state.fullContent,
                    timestamp: new Date(),
                    messageType: MessageType.MESSAGE
                });
                this.state.messageSaved = true;
                console.log('Saved assistant message to database');
            } catch (saveError) {
                console.error('Failed to save assistant message to database:', saveError);
            }
        }
    }
}


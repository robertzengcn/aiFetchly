import { IpcMainEvent } from 'electron';
import { StreamEvent, StreamEventType } from '@/api/aiChatApi';
import {
    ChatStreamChunk,
    Plan,
    PlanStep,
    PlanStepStatus,
    PlanCreatedEventData,
    PlanStepEventData,
    PlanControlEventData
} from '@/entityTypes/commonType';
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
import { PlanValidator } from './ValidationUtils';
import { ErrorClassifier, ClassifiedError, RecoveryStrategy } from './ErrorClassification';

/**
 * Configuration constants for plan execution
 */
export const PLAN_CONFIG = {
    MAX_PLAN_STEPS: 50,
    MAX_STEP_TITLE_LENGTH: 200,
    MAX_STEP_DESCRIPTION_LENGTH: 1000,
    MAX_PLAN_TITLE_LENGTH: 300,
    MAX_PLAN_DESCRIPTION_LENGTH: 2000
} as const;

/**
 * Configuration constants for timeouts and limits
 */
const EXECUTION_CONFIG = {
    // Tool execution timeouts
    TOOL_EXECUTION_TIMEOUT: 300000, // 5 minutes
    CHILD_PROCESS_TIMEOUT: 600000,  // 10 minutes

    // Batch processing limits
    MAX_BATCH_SIZE: 100,
    BATCH_COMPLETION_TIMEOUT: 600000, // 10 minutes
    BATCH_POLL_INTERVAL: 2000,        // 2 seconds

    // Error recovery thresholds
    MAX_FAILED_STEP_PERCENTAGE: 0.5,  // 50%

    // Rate limiting
    MAX_CONCURRENT_TOOLS: 5
} as const;

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
    // Plan execute agent state
    currentPlan: Plan | null;
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

            // Plan execute agent events
            case StreamEventType.PLAN_CREATED:
                this.handlePlanCreatedEvent(streamEvent);
                break;

            case StreamEventType.PLAN_STEP_START:
                this.handlePlanStepStartEvent(streamEvent);
                break;

            case StreamEventType.PLAN_STEP_COMPLETE:
                this.handlePlanStepCompleteEvent(streamEvent);
                break;

            case StreamEventType.PLAN_EXECUTE_PAUSE:
                this.handlePlanExecutePauseEvent(streamEvent);
                break;

            case StreamEventType.PLAN_EXECUTE_RESUME:
                this.handlePlanExecuteResumeEvent(streamEvent);
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
            eventType: StreamEventType.TOKEN,
            conversationId: this.state.streamConversationId
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
            toolId: toolId,
            conversationId: this.state.streamConversationId
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
                toolResult: toolResult,
                conversationId: this.state.streamConversationId
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
        const errorToolResult = {
            success: false,
            error: errorMessage
        };

        // Send error result to UI
        const errorResult: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.TOOL_RESULT,
            toolResult: errorToolResult,
            conversationId: this.state.streamConversationId
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(errorResult));

        // Save error tool result to database
        try {
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

        // Send error tool result back to AI server to continue the stream
        // This allows the AI to respond appropriately to the failure
        try {
            await this.sendToolResultToAI(toolId, toolName, errorToolResult, toolStartMs);
        } catch (sendErr) {
            console.error('Failed to send error tool result to AI server:', sendErr);
        }

        // Remove tool from pending set even on error
        if (toolId) {
            this.state.pendingToolCalls.delete(toolId);
            console.log(`Tool call failed: ${toolName} (ID: ${toolId}), pending: ${this.state.pendingToolCalls.size}`);
            
            // Check if we can send completion (deferred completion will be handled when stream ends)
            this.sendDeferredCompletionIfReady();
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
            toolResult: typeof toolResult === 'object' ? toolResult as Record<string, unknown> : { result: toolResult },
            conversationId: this.state.streamConversationId
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
            errorMessage: errorMessage,
            conversationId: this.state.streamConversationId
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
            eventType: StreamEventType.DONE,
            conversationId: this.state.streamConversationId
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
     * Clean up plan data to prevent memory leaks
     */
    private cleanupPlanData(): void {
        if (this.state.currentPlan) {
            console.log(`Cleaning up plan: ${this.state.currentPlan.planId}`);
            this.state.currentPlan = null;
        }
    }

    /**
     * Recover plan state from inconsistency using error classification
     */
    private recoverPlanState(error: Error, context: string): void {
        const classifiedError = ErrorClassifier.classify(error, context);
        console.error(`Plan state inconsistency detected in ${context}:`, classifiedError);

        if (!this.state.currentPlan) return;

        this.applyRecoveryStrategy(classifiedError);
    }

    /**
     * Apply appropriate recovery strategy based on error classification
     */
    private applyRecoveryStrategy(classifiedError: ClassifiedError): void {
        switch (classifiedError.recoveryStrategy) {
            case RecoveryStrategy.RETRY:
                this.handleRetryableError(classifiedError);
                break;

            case RecoveryStrategy.SKIP:
                this.handleSkippableError(classifiedError);
                break;

            case RecoveryStrategy.ABORT:
                this.handleAbortError(classifiedError);
                break;

            case RecoveryStrategy.FALLBACK:
                this.handleFallbackError(classifiedError);
                break;

            case RecoveryStrategy.CONTINUE:
            default:
                this.handleContinueError(classifiedError);
                break;
        }
    }

    /**
     * Handle retryable errors (network, timeout)
     */
    private handleRetryableError(classifiedError: ClassifiedError): void {
        console.log(`Retryable error detected: ${ErrorClassifier.getErrorDescription(classifiedError)}`);
        // Mark current step as failed but don't abort the plan
        this.failCurrentStep(classifiedError.originalError);
        this.checkPlanFailureThreshold();
    }

    /**
     * Handle skippable errors (execution failures)
     */
    private handleSkippableError(classifiedError: ClassifiedError): void {
        console.log(`Skippable error detected: ${ErrorClassifier.getErrorDescription(classifiedError)}`);
        // Mark current step as failed but continue with plan
        this.failCurrentStep(classifiedError.originalError);
        // Don't check failure threshold for skippable errors
    }

    /**
     * Handle abort errors (validation, permission)
     */
    private handleAbortError(classifiedError: ClassifiedError): void {
        console.error(`Abort error detected: ${ErrorClassifier.getErrorDescription(classifiedError)}`);

        if (this.state.currentPlan) {
            // Mark entire plan as failed
            this.state.currentPlan.status = 'failed';
            this.state.currentPlan.steps.forEach(step => {
                if (step.status === PlanStepStatus.IN_PROGRESS) {
                    step.status = PlanStepStatus.FAILED;
                    step.endTime = new Date();
                    step.error = `Plan aborted: ${classifiedError.originalError.message}`;
                }
            });

            // Send plan failure notification
            this.sendPlanAbortNotification(classifiedError);
        }
    }

    /**
     * Handle fallback errors (resource issues)
     */
    private handleFallbackError(classifiedError: ClassifiedError): void {
        console.warn(`Fallback error detected: ${ErrorClassifier.getErrorDescription(classifiedError)}`);
        // Try to continue but mark current step as failed
        this.failCurrentStep(classifiedError.originalError);
        this.checkPlanFailureThreshold();
    }

    /**
     * Handle continue errors (unknown)
     */
    private handleContinueError(classifiedError: ClassifiedError): void {
        console.log(`Continue error detected: ${ErrorClassifier.getErrorDescription(classifiedError)}`);
        // Try to continue without marking step as failed
        // Just log the error and proceed
    }

    /**
     * Send plan abort notification to UI
     */
    private sendPlanAbortNotification(classifiedError: ClassifiedError): void {
        if (!this.state.currentPlan) return;

        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.ERROR,
            conversationId: this.state.streamConversationId,
            errorMessage: `Plan aborted: ${ErrorClassifier.getErrorDescription(classifiedError)}`
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
    }

    /**
     * Mark the current step as failed
     */
    private failCurrentStep(error: Error): void {
        if (!this.state.currentPlan) return;

        const { currentStepIndex, steps } = this.state.currentPlan;

        if (currentStepIndex < 0 || currentStepIndex >= steps.length) return;

        const currentStep = steps[currentStepIndex];
        if (currentStep.status !== PlanStepStatus.IN_PROGRESS) return;

        currentStep.status = PlanStepStatus.FAILED;
        currentStep.endTime = new Date();
        currentStep.error = `State recovery: ${error.message}`;

        this.sendStepFailureNotification(currentStep);
    }

    /**
     * Send step failure notification to UI
     */
    private sendStepFailureNotification(step: PlanStep): void {
        if (!this.state.currentPlan) return;

        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.PLAN_STEP_COMPLETE,
            conversationId: this.state.streamConversationId,
            planId: this.state.currentPlan.planId,
            stepId: step.stepId
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
    }

    /**
     * Check if plan should be marked as failed due to too many step failures
     */
    private checkPlanFailureThreshold(): void {
        if (!this.state.currentPlan) return;

        const failedSteps = this.state.currentPlan.steps.filter(s => s.status === PlanStepStatus.FAILED).length;
        const failureThreshold = Math.ceil(this.state.currentPlan.steps.length * EXECUTION_CONFIG.MAX_FAILED_STEP_PERCENTAGE);

        if (failedSteps > failureThreshold) {
            this.state.currentPlan.status = 'failed';
            console.warn(`Plan ${this.state.currentPlan.planId} marked as failed due to too many step failures`);
        }
    }

    /**
     * Handle CONVERSATION_END event
     */
    private handleConversationEndEvent(): void {
        // Clean up plan data when conversation ends
        this.cleanupPlanData();

        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: true,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.CONVERSATION_END,
            conversationId: this.state.streamConversationId
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

    // ==================== Plan Execute Agent Event Handlers ====================

    /**
     * Handle PLAN_CREATED event - a new plan has been created
     */
    private handlePlanCreatedEvent(streamEvent: StreamEvent): void {
        try {
            const planDataInput = this.extractPlanDataFromEvent(streamEvent);
            const planData = this.validatePlanCreatedData(planDataInput);

            if (!planData) {
                console.error('Invalid plan creation data received');
                return;
            }

            const plan = this.buildPlanFromData(planData);
            this.storePlanInState(plan);

            console.log(`Plan created: ${plan.title} with ${plan.steps.length} steps`);

            this.savePlanCreatedMessage(plan);
            this.sendPlanCreatedChunk(plan);
        } catch (error) {
            console.error('Error handling plan created event:', error);
        }
    }

    /**
     * Extract plan data from stream event
     */
    private extractPlanDataFromEvent(streamEvent: StreamEvent): Record<string, unknown> {
        const eventData = streamEvent.data;

        // Check if data.data exists and is an object (new format)
        if (eventData.data && typeof eventData.data === 'object' && !('name' in eventData.data) && !('id' in eventData.data)) {
            // This is plan data, not ToolCallData
            return { ...eventData, ...(eventData.data as unknown as Record<string, unknown>) };
        } else if (typeof eventData.content === 'object' && eventData.content !== null) {
            // Content is an object (might be plan data)
            return eventData.content as Record<string, unknown>;
        } else {
            // Fallback to eventData itself
            return eventData as unknown as Record<string, unknown>;
        }
    }

    /**
     * Build plan object from validated plan data
     */
    private buildPlanFromData(planData: PlanCreatedEventData): Plan {
        return {
            planId: planData.plan_id || `plan-${Date.now()}`,
            title: planData.title || 'Execution Plan',
            description: planData.description,
            steps: this.parseStepsFromPlanData(planData),
            status: 'created',
            createdAt: new Date(),
            currentStepIndex: 0
        };
    }

    /**
     * Store plan in component state
     */
    private storePlanInState(plan: Plan): void {
        this.state.currentPlan = plan;
    }

    /**
     * Save plan created message to database
     */
    private savePlanCreatedMessage(plan: Plan): void {
        this.savePlanMessage(plan.planId, MessageType.PLAN_CREATED, {
            planId: plan.planId,
            title: plan.title,
            description: plan.description,
            reasoning: plan.description, // Reasoning is stored as description
            totalSteps: plan.steps.length,
            steps: plan.steps.map(s => ({ stepId: s.stepId, stepNumber: s.stepNumber, title: s.title }))
        }).catch(err => console.error('Failed to save plan created message:', err));
    }

    /**
     * Send plan created chunk to UI
     */
    private sendPlanCreatedChunk(plan: Plan): void {
        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.PLAN_CREATED,
            conversationId: this.state.streamConversationId,
            planId: plan.planId,
            // Only send essential plan data - UI can reconstruct full plan if needed
            plan: {
                planId: plan.planId,
                title: plan.title,
                description: plan.description,
                status: plan.status,
                createdAt: plan.createdAt,
                currentStepIndex: plan.currentStepIndex,
                // Only include step summaries to reduce payload size
                steps: plan.steps.map(s => ({
                    stepId: s.stepId,
                    stepNumber: s.stepNumber,
                    title: s.title,
                    status: s.status
                }))
            } as Plan
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
    }

    /**
     * Handle PLAN_STEP_START event - a plan step has started
     */
    private handlePlanStepStartEvent(streamEvent: StreamEvent): void {
        try {
            const stepData = this.validatePlanStepData(streamEvent.data.content);
            if (!stepData || !stepData.step_id) {
                throw new Error('Invalid plan step start data - missing step_id');
            }

            const stepId = stepData.step_id;
            const stepNumber = stepData.step_number || 1;
            const title = stepData.title || `Step ${stepNumber}`;
            const description = stepData.description;

            // Update step in current plan
            if (this.state.currentPlan) {
                const stepIndex = this.state.currentPlan.steps.findIndex(s => s.stepId === stepId);
                if (stepIndex >= 0) {
                    this.state.currentPlan.steps[stepIndex].status = PlanStepStatus.IN_PROGRESS;
                    this.state.currentPlan.steps[stepIndex].startTime = new Date();
                }
                this.state.currentPlan.status = 'in_progress';
                this.state.currentPlan.currentStepIndex = stepNumber - 1;
            }

            console.log(`Plan step started: ${title} (Step ${stepNumber})`);

            // Send chunk to UI with optimized payload
            const chunk: ChatStreamChunk = {
                content: '',
                isComplete: false,
                messageId: this.state.assistantMessageId,
                eventType: StreamEventType.PLAN_STEP_START,
                conversationId: this.state.streamConversationId,
                planId: this.state.currentPlan?.planId,
                stepId: stepId,
                // Only send essential step data
                stepNumber: stepNumber,
                stepTitle: title,
                stepDescription: description
            };
            this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
        } catch (error) {
            this.recoverPlanState(error instanceof Error ? error : new Error(String(error)), 'plan step start');
        }
    }

    /**
     * Handle PLAN_STEP_COMPLETE event - a plan step has completed
     */
    private handlePlanStepCompleteEvent(streamEvent: StreamEvent): void {
        try {
            const stepData = this.validatePlanStepData(streamEvent.data.content);
            if (!stepData || !stepData.step_id) {
                throw new Error('Invalid plan step complete data - missing step_id');
            }

            const stepInfo = this.extractStepInfo(stepData);
            this.updatePlanStepState(stepInfo);
            this.updatePlanCompletionStatus();

            console.log(`Plan step completed: ${stepInfo.title} (Step ${stepInfo.stepNumber}) - ${stepInfo.success ? 'Success' : 'Failed'}`);

            this.saveStepCompletionMessage(stepInfo);
            this.sendStepCompleteChunk(stepInfo);
        } catch (error) {
            this.recoverPlanState(error instanceof Error ? error : new Error(String(error)), 'plan step complete');
        }
    }

    /**
     * Extract step information from validated step data
     */
    private extractStepInfo(stepData: PlanStepEventData) {
        const stepId = stepData.step_id!;
        const stepNumber = stepData.step_number || 1;
        const title = stepData.title || `Step ${stepNumber}`;
        const result = stepData.result;
        const error = stepData.error;
        const success = stepData.success !== false;

        return {
            stepId,
            stepNumber,
            title,
            result,
            error,
            success
        };
    }

    /**
     * Update step state in current plan
     */
    private updatePlanStepState(stepInfo: ReturnType<typeof this.extractStepInfo>): void {
        if (!this.state.currentPlan) return;

        const stepIndex = this.state.currentPlan.steps.findIndex(s => s.stepId === stepInfo.stepId);
        if (stepIndex >= 0) {
            this.state.currentPlan.steps[stepIndex].status = stepInfo.success ? PlanStepStatus.COMPLETED : PlanStepStatus.FAILED;
            this.state.currentPlan.steps[stepIndex].endTime = new Date();
            this.state.currentPlan.steps[stepIndex].result = stepInfo.result;
            this.state.currentPlan.steps[stepIndex].error = stepInfo.error;
        }
    }

    /**
     * Update overall plan completion status
     */
    private updatePlanCompletionStatus(): void {
        if (!this.state.currentPlan) return;

        const allCompleted = this.state.currentPlan.steps.every(
            s => s.status === PlanStepStatus.COMPLETED || s.status === PlanStepStatus.FAILED || s.status === PlanStepStatus.SKIPPED
        );
        if (allCompleted) {
            this.state.currentPlan.status = 'completed';
        }
    }

    /**
     * Save step completion message to database
     */
    private saveStepCompletionMessage(stepInfo: ReturnType<typeof this.extractStepInfo>): void {
        this.savePlanMessage(stepInfo.stepId, MessageType.PLAN_STEP_COMPLETE, {
            stepId: stepInfo.stepId,
            stepNumber: stepInfo.stepNumber,
            title: stepInfo.title,
            success: stepInfo.success,
            result: stepInfo.result,
            error: stepInfo.error,
            planId: this.state.currentPlan?.planId
        }).catch(err => console.error('Failed to save plan step completion:', err));
    }

    /**
     * Send step complete chunk to UI
     */
    private sendStepCompleteChunk(stepInfo: ReturnType<typeof this.extractStepInfo>): void {
        const chunk: ChatStreamChunk = {
            content: '',
            isComplete: false,
            messageId: this.state.assistantMessageId,
            eventType: StreamEventType.PLAN_STEP_COMPLETE,
            conversationId: this.state.streamConversationId,
            planId: this.state.currentPlan?.planId,
            stepId: stepInfo.stepId,
            stepNumber: stepInfo.stepNumber,
            stepTitle: stepInfo.title,
            stepSuccess: stepInfo.success,
            stepResult: stepInfo.success ? stepInfo.result : undefined,
            stepError: stepInfo.success ? undefined : stepInfo.error,
            // Only include plan status update, not full plan object
            planStatus: this.state.currentPlan?.status,
            planProgress: this.state.currentPlan ? {
                completed: this.state.currentPlan.steps.filter(s =>
                    s.status === PlanStepStatus.COMPLETED || s.status === PlanStepStatus.FAILED
                ).length,
                total: this.state.currentPlan.steps.length
            } : undefined
        };
        this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
    }

    /**
     * Handle PLAN_EXECUTE_PAUSE event - plan execution has been paused
     */
    private handlePlanExecutePauseEvent(streamEvent: StreamEvent): void {
        try {
            const pauseData = this.validatePlanControlData(streamEvent.data.content);

            const planId = pauseData?.plan_id || this.state.currentPlan?.planId;
            const pauseReason = pauseData?.reason || 'Execution paused';

            // Update plan status
            if (this.state.currentPlan) {
                this.state.currentPlan.status = 'paused';
            }

            console.log(`Plan execution paused: ${pauseReason}`);

            // Send chunk to UI with optimized payload
            const chunk: ChatStreamChunk = {
                content: '',
                isComplete: false,
                messageId: this.state.assistantMessageId,
                eventType: StreamEventType.PLAN_EXECUTE_PAUSE,
                conversationId: this.state.streamConversationId,
                planId: planId,
                pauseReason: pauseReason
                // Don't send full plan object on pause/resume to save bandwidth
            };
            this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
        } catch (error) {
            console.error('Error handling plan execute pause event:', error);
        }
    }

    /**
     * Handle PLAN_EXECUTE_RESUME event - plan execution has resumed
     */
    private handlePlanExecuteResumeEvent(streamEvent: StreamEvent): void {
        try {
            const resumeData = this.validatePlanControlData(streamEvent.data.content);

            const planId = resumeData?.plan_id || this.state.currentPlan?.planId;
            const resumeReason = resumeData?.reason || 'Execution resumed';

            // Update plan status
            if (this.state.currentPlan) {
                this.state.currentPlan.status = 'in_progress';
            }

            console.log(`Plan execution resumed: ${resumeReason}`);

            // Send chunk to UI with optimized payload
            const chunk: ChatStreamChunk = {
                content: '',
                isComplete: false,
                messageId: this.state.assistantMessageId,
                eventType: StreamEventType.PLAN_EXECUTE_RESUME,
                conversationId: this.state.streamConversationId,
                planId: planId,
                resumeReason: resumeReason
                // Don't send full plan object on pause/resume to save bandwidth
            };
            this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(chunk));
        } catch (error) {
            console.error('Error handling plan execute resume event:', error);
        }
    }

    /**
     * Validate plan control event data (pause/resume) using validation utilities
     */
    private validatePlanControlData(data: unknown): PlanControlEventData | null {
        const validation = PlanValidator.validatePlanControlData(data);

        if (!validation.isValid) {
            console.warn('Plan control validation failed:', validation.errors.join(', '));
            return null;
        }

        return validation.data || null;
    }

    /**
     * Parse steps from plan data with validation
     * Supports both formats:
     * 1. Old format: steps array with step objects
     * 2. New format: plan array with step strings
     */
    private parseStepsFromPlanData(planData: PlanCreatedEventData): PlanStep[] {
        // Check if this is the new format with plan array (string array)
        if (planData.plan && Array.isArray(planData.plan)) {
            return planData.plan
                .filter((stepStr): stepStr is string => typeof stepStr === 'string' && stepStr.trim().length > 0)
                .map((stepStr, index) => {
                    // Extract step number and title from string like "Step 1: Use the 'scrape_urls_from_google' tool..."
                    const stepMatch = stepStr.match(/^Step\s+(\d+):\s*(.+)$/i);
                    let stepNumber = index + 1;
                    let title = stepStr;
                    
                    if (stepMatch) {
                        stepNumber = parseInt(stepMatch[1], 10) || index + 1;
                        title = stepMatch[2].trim();
                    } else {
                        // If no "Step X:" prefix, try to extract from beginning
                        const colonIndex = stepStr.indexOf(':');
                        if (colonIndex > 0) {
                            title = stepStr.substring(colonIndex + 1).trim();
                        }
                    }
                    
                    return {
                        stepId: `step-${stepNumber}`,
                        stepNumber: stepNumber,
                        title: title.length > PLAN_CONFIG.MAX_STEP_TITLE_LENGTH 
                            ? title.substring(0, PLAN_CONFIG.MAX_STEP_TITLE_LENGTH - 3) + '...'
                            : title,
                        description: stepStr, // Full step string as description
                        status: PlanStepStatus.PENDING
                    };
                });
        }
        
        // Old format: steps array with step objects
        if (planData.steps && Array.isArray(planData.steps)) {
            return planData.steps
                .filter((step): step is NonNullable<typeof step> => step != null)
                .map((step, index) => ({
                    stepId: step.step_id || `step-${index + 1}`,
                    stepNumber: step.step_number || index + 1,
                    title: step.title || `Step ${index + 1}`,
                    description: step.description,
                    status: PlanStepStatus.PENDING
                }));
        }

        console.warn('No valid steps array found in plan data');
        return [];
    }

    /**
     * Validate plan created event data using validation utilities
     */
    private validatePlanCreatedData(data: unknown): PlanCreatedEventData | null {
        const validation = PlanValidator.validatePlanCreatedData(data);

        if (!validation.isValid) {
            console.warn('Plan creation validation failed:', validation.errors.join(', '));
            return null;
        }

        return validation.data || null;
    }

    /**
     * Validate plan step event data using validation utilities
     */
    private validatePlanStepData(data: unknown): PlanStepEventData | null {
        const validation = PlanValidator.validatePlanStepData(data);

        if (!validation.isValid) {
            console.warn('Plan step validation failed:', validation.errors.join(', '));
            return null;
        }

        return validation.data || null;
    }

    /**
     * Save plan-related message to database with improved error handling
     */
    private async savePlanMessage(
        messageId: string,
        messageType: MessageType,
        metadata: Record<string, unknown>
    ): Promise<void> {
        if (!this.state.streamConversationId) {
            console.warn('Cannot save plan message: no conversation ID available');
            return;
        }

        try {
            const messageData = {
                messageId: `plan-${messageId}-${Date.now()}`,
                conversationId: this.state.streamConversationId,
                role: 'assistant' as const,
                content: JSON.stringify(metadata),
                timestamp: new Date(),
                messageType: messageType,
                metadata: JSON.stringify(metadata)
            };

            await this.state.chatModule.saveMessage(messageData);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.error(`Failed to save plan message (${messageType}):`, errorMessage);

            // Optionally emit an error event to the UI
            try {
                const errorChunk: ChatStreamChunk = {
                    content: '',
                    isComplete: false,
                    messageId: this.state.assistantMessageId,
                    eventType: StreamEventType.ERROR,
                    conversationId: this.state.streamConversationId,
                    errorMessage: `Failed to save plan message: ${errorMessage}`
                };
                this.event.sender.send(AI_CHAT_STREAM_CHUNK, JSON.stringify(errorChunk));
            } catch (emitError) {
                console.error('Failed to emit error chunk:', emitError);
            }
        }
    }
}


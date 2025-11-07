import { MessageType } from '@/modules/interface/IPCMessageProtocol';
import { TaskStatus } from '@/modules/interface/ITaskManager';
import { BaseModule } from '@/modules/baseModule';
import { YellowPagesTaskModel, YellowPagesTaskStatus } from '@/model/YellowPagesTask.model';
import { YellowPagesResultModel } from '@/model/YellowPagesResult.model';

// Define missing interfaces based on usage
interface IPCMessage {
    type: MessageType;
    taskId: string;
}

interface ProgressUpdateMessage extends IPCMessage {
    progress: number;
    currentPage: number;
    totalPages: number;
    businessesFound: number;
    details?: {
        currentUrl?: string;
        timeElapsed?: number;
        timeRemaining?: number;
        successRate?: number;
        errorCount?: number;
    };
}

interface StatusUpdateMessage extends IPCMessage {
    status: TaskStatus;
    message: string;
    data?: any;
}

interface ResultDataMessage extends IPCMessage {
    pageNumber: number;
    results: Array<{
        businessName: string;
        email?: string;
        phone?: string;
        website?: string;
        address?: any;
        socialMedia?: any;
        categories?: any;
        businessHours?: any;
        rating?: {
            score?: number;
            reviewCount?: number;
        };
        rawData?: any;
    }>;
}

interface ErrorMessage extends IPCMessage {
    message: string;
    severity: 'WARNING' | 'ERROR' | 'CRITICAL';
    stack?: string;
    context?: any;
}

interface LogMessage extends IPCMessage {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: any;
}

/**
 * Status reporting manager for handling child-to-main process communication
 * Manages progress updates, error handling, and status tracking
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class StatusReportingManager extends BaseModule {
    private taskModel: YellowPagesTaskModel;
    private resultModel: YellowPagesResultModel;
    private messageHandlers: Map<MessageType, ((message: IPCMessage) => Promise<void>)[]> = new Map();
    private taskProgress: Map<string, {
        currentPage: number;
        totalPages: number;
        resultsCount: number;
        percentage: number;
        startTime: number;
        lastUpdate: number;
        errors: Error[];
    }> = new Map();

    constructor() {
        super();
        this.taskModel = new YellowPagesTaskModel(this.dbpath);
        this.resultModel = new YellowPagesResultModel(this.dbpath);
        this.setupDefaultHandlers();
    }

    /**
     * Initialize the status reporting manager
     */
    async initialize(): Promise<void> {
        console.log('Initializing StatusReportingManager...');
        console.log('StatusReportingManager initialized successfully');
    }

    /**
     * Handle incoming message from child process
     */
    async handleMessage(message: IPCMessage): Promise<void> {
        try {
            console.log(`Handling message type: ${message.type}`);

            // Call registered handlers
            const handlers = this.messageHandlers.get(message.type);
            if (handlers) {
                for (const handler of handlers) {
                    await handler(message);
                }
            }

            // Handle specific message types
            switch (message.type) {
                case MessageType.PROGRESS_UPDATE:
                    await this.handleProgressUpdate(message as ProgressUpdateMessage);
                    break;

                case MessageType.STATUS_UPDATE:
                    await this.handleStatusUpdate(message as StatusUpdateMessage);
                    break;

                case MessageType.RESULT_DATA:
                    await this.handleResultData(message as ResultDataMessage);
                    break;

                case MessageType.TASK_ERROR:
                    await this.handleTaskError(message as ErrorMessage);
                    break;

                case MessageType.LOG_MESSAGE:
                    await this.handleLogMessage(message as LogMessage);
                    break;

                default:
                    console.log(`Unhandled message type: ${message.type}`);
            }

        } catch (error) {
            console.error('Error handling message:', error);
            await this.handleError('StatusReportingManager', 'Message handling failed', error);
        }
    }

    /**
     * Handle progress update from child process
     */
    private async handleProgressUpdate(message: ProgressUpdateMessage): Promise<void> {
        try {
            const taskId = message.taskId;
            console.log(`Progress update for task ${taskId}: ${message.progress}% (${message.currentPage}/${message.totalPages})`);

            // Update progress tracking
            this.taskProgress.set(taskId, {
                currentPage: message.currentPage,
                totalPages: message.totalPages,
                resultsCount: message.businessesFound,
                percentage: message.progress,
                startTime: this.taskProgress.get(taskId)?.startTime || Date.now(),
                lastUpdate: Date.now(),
                errors: this.taskProgress.get(taskId)?.errors || []
            });

            // Progress tracking is handled in memory only
            // Task status updates are handled separately via status messages

            // Log progress details
            if (message.details) {
                console.log(`Task ${taskId} details:`, {
                    currentUrl: message.details.currentUrl,
                    timeElapsed: message.details.timeElapsed,
                    timeRemaining: message.details.timeRemaining,
                    successRate: message.details.successRate,
                    errorCount: message.details.errorCount
                });
            }

        } catch (error) {
            console.error('Error handling progress update:', error);
            await this.handleError(message.taskId, 'Progress update failed', error);
        }
    }

    /**
     * Handle status update from child process
     */
    private async handleStatusUpdate(message: StatusUpdateMessage): Promise<void> {
        try {
            const taskId = message.taskId;
            console.log(`Status update for task ${taskId}: ${message.status} - ${message.message}`);

            // Update task status in database
            const dbStatus = this.mapTaskStatus(message.status);
            await this.taskModel.updateTaskStatus(parseInt(taskId), dbStatus);

            // Handle specific status changes
            switch (message.status) {
                case TaskStatus.Completed:
                    await this.handleTaskCompleted(taskId, message.data);
                    break;

                case TaskStatus.Failed:
                    await this.handleTaskFailed(taskId, message.data);
                    break;

                default:
                    // Handle other statuses or unknown status
                    break;
            }

        } catch (error) {
            console.error('Error handling status update:', error);
            await this.handleError(message.taskId, 'Status update failed', error);
        }
    }

    /**
     * Handle result data from child process
     */
    private async handleResultData(message: ResultDataMessage): Promise<void> {
        try {
            const taskId = message.taskId;
            console.log(`Result data for task ${taskId}: ${message.results.length} results from page ${message.pageNumber}`);

            // Save results to database
            for (const result of message.results) {
                await this.resultModel.saveYellowPagesResult({
                    task_id: parseInt(taskId),
                    business_name: result.businessName,
                    email: result.email,
                    phone: result.phone,
                    website: result.website,
                    address: result.address,
                    social_media: result.socialMedia,
                    categories: result.categories,
                    business_hours: result.businessHours,
                    rating: result.rating?.score,
                    review_count: result.rating?.reviewCount,
                    platform: 'YellowPages',
                    raw_data: result.rawData
                });
            }

            console.log(`Saved ${message.results.length} results for task ${taskId}`);

        } catch (error) {
            console.error('Error handling result data:', error);
            await this.handleError(message.taskId, 'Result data handling failed', error);
        }
    }

    /**
     * Handle task error from child process
     */
    private async handleTaskError(message: ErrorMessage): Promise<void> {
        try {
            const taskId = message.taskId;
            console.error(`Task error for ${taskId}: ${message.message} (${message.severity})`);

            // Log error details
            if (message.stack) {
                console.error('Error stack:', message.stack);
            }
            if (message.context) {
                console.error('Error context:', message.context);
            }

            // Update task status based on error severity
            let dbStatus = YellowPagesTaskStatus.Failed;
            if (message.severity === 'WARNING') {
                dbStatus = YellowPagesTaskStatus.InProgress; // Continue with warnings
            }

            await this.taskModel.updateTaskStatus(parseInt(taskId), dbStatus);

            // Add error to progress tracking
            const progress = this.taskProgress.get(taskId);
            if (progress) {
                progress.errors.push(new Error(message.message));
            }

            // Handle critical errors
            if (message.severity === 'CRITICAL') {
                await this.handleCriticalError(taskId, message);
            }

        } catch (error) {
            console.error('Error handling task error:', error);
            await this.handleError(message.taskId, 'Error handling failed', error);
        }
    }

    /**
     * Handle log message from child process
     */
    private async handleLogMessage(message: LogMessage): Promise<void> {
        try {
            const logLevel = message.level.toUpperCase();
            const logMessage = `[${message.taskId || 'SYSTEM'}] ${message.message}`;

            switch (message.level) {
                case 'debug':
                    console.debug(logMessage);
                    break;
                case 'info':
                    console.info(logMessage);
                    break;
                case 'warn':
                    console.warn(logMessage);
                    break;
                case 'error':
                    console.error(logMessage);
                    break;
                default:
                    console.log(logMessage);
            }

            // Log additional data if present
            if (message.data) {
                console.log('Log data:', message.data);
            }

        } catch (error) {
            console.error('Error handling log message:', error);
        }
    }

    /**
     * Handle task completion
     */
    private async handleTaskCompleted(taskId: string, data?: any): Promise<void> {
        try {
            console.log(`Task ${taskId} completed successfully`);
            
            // Update task completion time
            await this.taskModel.updateTaskCompletion(parseInt(taskId));

            // Clean up progress tracking
            this.taskProgress.delete(taskId);

            // Log completion statistics
            const results = await this.resultModel.getResultsByTaskId(parseInt(taskId));
            console.log(`Task ${taskId} completed with ${results.length} results`);

        } catch (error) {
            console.error('Error handling task completion:', error);
            await this.handleError(taskId, 'Task completion handling failed', error);
        }
    }

    /**
     * Handle task failure
     */
    private async handleTaskFailed(taskId: string, data?: any): Promise<void> {
        try {
            console.error(`Task ${taskId} failed`);
            
            // Log failure details
            if (data) {
                console.error('Failure details:', data);
            }

            // Clean up progress tracking
            this.taskProgress.delete(taskId);

        } catch (error) {
            console.error('Error handling task failure:', error);
            await this.handleError(taskId, 'Task failure handling failed', error);
        }
    }

    /**
     * Handle task stopped
     */
    private async handleTaskStopped(taskId: string, data?: any): Promise<void> {
        try {
            console.log(`Task ${taskId} stopped`);
            
            // Clean up progress tracking
            this.taskProgress.delete(taskId);

        } catch (error) {
            console.error('Error handling task stopped:', error);
            await this.handleError(taskId, 'Task stopped handling failed', error);
        }
    }

    /**
     * Handle critical error
     */
    private async handleCriticalError(taskId: string, errorMessage: ErrorMessage): Promise<void> {
        try {
            console.error(`Critical error for task ${taskId}:`, errorMessage.message);
            
            // Update task status to failed
            await this.taskModel.updateTaskStatus(parseInt(taskId), YellowPagesTaskStatus.Failed);
            
            // Clean up progress tracking
            this.taskProgress.delete(taskId);

            // Could implement additional critical error handling here
            // e.g., notify administrators, restart process, etc.

        } catch (error) {
            console.error('Error handling critical error:', error);
        }
    }

    /**
     * Handle general error
     */
    private async handleError(taskId: string, message: string, error: any): Promise<void> {
        try {
            console.error(`Error for task ${taskId}: ${message}`, error);
            
            // Log error details
            const errorDetails = {
                taskId,
                message,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date()
            };

            console.error('Error details:', errorDetails);

        } catch (logError) {
            console.error('Error logging error:', logError);
        }
    }

    /**
     * Map IPC task status to database status
     */
    private mapTaskStatus(ipcStatus: TaskStatus): YellowPagesTaskStatus {
        switch (ipcStatus) {
            case TaskStatus.Pending:
                return YellowPagesTaskStatus.Pending;
            case TaskStatus.InProgress:
                return YellowPagesTaskStatus.InProgress;
            case TaskStatus.Paused:
                return YellowPagesTaskStatus.Paused;
            case TaskStatus.Completed:
                return YellowPagesTaskStatus.Completed;
            case TaskStatus.Failed:
                return YellowPagesTaskStatus.Failed;
            default:
                return YellowPagesTaskStatus.Pending;
        }
    }

    /**
     * Register message handler
     */
    registerMessageHandler(type: MessageType, handler: (message: IPCMessage) => Promise<void>): void {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, []);
        }
        this.messageHandlers.get(type)!.push(handler);
    }

    /**
     * Unregister message handler
     */
    unregisterMessageHandler(type: MessageType, handler: (message: IPCMessage) => Promise<void>): void {
        const handlers = this.messageHandlers.get(type);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    /**
     * Get task progress
     */
    getTaskProgress(taskId: string): any {
        return this.taskProgress.get(taskId);
    }

    /**
     * Get all task progress
     */
    getAllTaskProgress(): Map<string, any> {
        return new Map(this.taskProgress);
    }

    /**
     * Setup default message handlers
     */
    private setupDefaultHandlers(): void {
        // Default handler for all messages
        this.registerMessageHandler(MessageType.PROGRESS_UPDATE, async (message) => {
            console.log('Progress update received:', message);
        });

        this.registerMessageHandler(MessageType.STATUS_UPDATE, async (message) => {
            console.log('Status update received:', message);
        });

        this.registerMessageHandler(MessageType.RESULT_DATA, async (message) => {
            console.log('Result data received:', message);
        });

        this.registerMessageHandler(MessageType.TASK_ERROR, async (message) => {
            console.error('Task error received:', message);
        });

        this.registerMessageHandler(MessageType.LOG_MESSAGE, async (message) => {
            console.log('Log message received:', message);
        });
    }
} 
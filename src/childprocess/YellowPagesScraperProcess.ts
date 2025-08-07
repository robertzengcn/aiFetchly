import { MessageType, TaskStatus, ErrorSeverity, IPCMessage, TaskControlMessage, TaskDataMessage, ProgressUpdateMessage, ErrorMessage, IPCMessageFactory } from '@/interfaces/IPCMessageProtocol';
import { YellowPagesScraper } from './yellowPagesScraper';
import { BaseModule } from '@/modules/baseModule';

/**
 * Child process entry point for Yellow Pages scraping
 * Handles IPC communication with the main process and manages scraping tasks
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class YellowPagesScraperProcess extends BaseModule {
    private scraper: YellowPagesScraper;
    private currentTaskId: string | null = null;
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private processId: string;

    constructor() {
        super();
        this.processId = `child_${process.pid}_${Date.now()}`;
        this.scraper = new YellowPagesScraper();
        this.setupIPC();
    }

    /**
     * Initialize the child process
     */
    async initialize(): Promise<void> {
        try {
            console.log(`YellowPagesScraperProcess initialized with PID: ${process.pid}`);
            
            // Initialize the scraper
            await this.scraper.initialize();
            
            // Send ready message to main process
            this.sendReadyMessage();
            
            console.log('Child process ready to receive tasks');
        } catch (error) {
            console.error('Failed to initialize child process:', error);
            this.sendErrorMessage('Initialization failed', ErrorSeverity.CRITICAL, error);
            process.exit(1);
        }
    }

    /**
     * Setup IPC message handling
     */
    private setupIPC(): void {
        if (!process.send) {
            console.error('Process.send is not available');
            return;
        }

        process.on('message', async (message: any) => {
            try {
                await this.handleMessage(message);
            } catch (error) {
                console.error('Error handling message:', error);
                this.sendErrorMessage('Message handling failed', ErrorSeverity.ERROR, error);
            }
        });

        // Handle process termination
        process.on('SIGTERM', () => {
            console.log('Received SIGTERM, shutting down gracefully');
            this.shutdown();
        });

        process.on('SIGINT', () => {
            console.log('Received SIGINT, shutting down gracefully');
            this.shutdown();
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught exception:', error);
            this.sendErrorMessage('Uncaught exception', ErrorSeverity.CRITICAL, error);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled rejection:', reason);
            this.sendErrorMessage('Unhandled rejection', ErrorSeverity.CRITICAL, reason);
        });
    }

    /**
     * Handle incoming IPC messages
     */
    private async handleMessage(message: any): Promise<void> {
        try {
            console.log(`Received message: ${message.type}`);

            switch (message.type) {
                case MessageType.START_TASK:
                    await this.handleStartTask(message);
                    break;

                case MessageType.STOP_TASK:
                    await this.handleStopTask(message);
                    break;

                case MessageType.PAUSE_TASK:
                    await this.handlePauseTask(message);
                    break;

                case MessageType.RESUME_TASK:
                    await this.handleResumeTask(message);
                    break;

                case MessageType.TASK_DATA:
                    await this.handleTaskData(message);
                    break;

                case MessageType.HEALTH_CHECK:
                    await this.handleHealthCheck(message);
                    break;

                default:
                    console.warn(`Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            this.sendErrorMessage('Message handling failed', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Handle start task command
     */
    private async handleStartTask(message: TaskControlMessage): Promise<void> {
        try {
            if (this.isRunning) {
                this.sendErrorMessage('Task already running', ErrorSeverity.WARNING);
                return;
            }

            this.currentTaskId = message.taskId;
            this.isRunning = true;
            this.isPaused = false;

            console.log(`Starting task: ${message.taskId}`);
            
            // Send task started message
            this.sendStatusUpdate(message.taskId, TaskStatus.RUNNING, 'Task started');

            // Start the scraping process
            await this.startScraping(message.taskId);

        } catch (error) {
            console.error('Error starting task:', error);
            this.sendErrorMessage('Failed to start task', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Handle stop task command
     */
    private async handleStopTask(message: TaskControlMessage): Promise<void> {
        try {
            if (!this.isRunning) {
                console.log('No task running to stop');
                return;
            }

            console.log(`Stopping task: ${message.taskId}`);
            
            this.isRunning = false;
            this.isPaused = false;

            // Stop the scraper
            await this.scraper.stop();

            // Send task stopped message
            this.sendStatusUpdate(message.taskId, TaskStatus.STOPPED, 'Task stopped');

        } catch (error) {
            console.error('Error stopping task:', error);
            this.sendErrorMessage('Failed to stop task', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Handle pause task command
     */
    private async handlePauseTask(message: TaskControlMessage): Promise<void> {
        try {
            if (!this.isRunning || this.isPaused) {
                console.log('No task running or already paused');
                return;
            }

            console.log(`Pausing task: ${message.taskId}`);
            
            this.isPaused = true;

            // Pause the scraper
            await this.scraper.pause();

            // Send task paused message
            this.sendStatusUpdate(message.taskId, TaskStatus.PAUSED, 'Task paused');

        } catch (error) {
            console.error('Error pausing task:', error);
            this.sendErrorMessage('Failed to pause task', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Handle resume task command
     */
    private async handleResumeTask(message: TaskControlMessage): Promise<void> {
        try {
            if (!this.isRunning || !this.isPaused) {
                console.log('No task running or not paused');
                return;
            }

            console.log(`Resuming task: ${message.taskId}`);
            
            this.isPaused = false;

            // Resume the scraper
            await this.scraper.resume();

            // Send task resumed message
            this.sendStatusUpdate(message.taskId, TaskStatus.RUNNING, 'Task resumed');

        } catch (error) {
            console.error('Error resuming task:', error);
            this.sendErrorMessage('Failed to resume task', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Handle task data message
     */
    private async handleTaskData(message: TaskDataMessage): Promise<void> {
        try {
            console.log(`Received task data for task: ${message.taskId}`);
            
            // Store task data in the scraper
            await this.scraper.setTaskData(message.taskData);

        } catch (error) {
            console.error('Error handling task data:', error);
            this.sendErrorMessage('Failed to process task data', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Handle health check message
     */
    private async handleHealthCheck(message: any): Promise<void> {
        try {
            const healthy = this.isHealthy();
            const details = this.getHealthDetails();

            const healthResponse = {
                id: `health_${Date.now()}`,
                type: MessageType.HEALTH_RESPONSE,
                timestamp: Date.now(),
                sourceProcessId: this.processId,
                targetProcessId: message.sourceProcessId,
                healthy,
                details,
                error: healthy ? undefined : 'Process is not healthy'
            };

            this.sendMessage(healthResponse);

        } catch (error) {
            console.error('Error handling health check:', error);
            this.sendErrorMessage('Health check failed', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Start the scraping process
     */
    private async startScraping(taskId: string): Promise<void> {
        try {
            // Set up progress callback
            this.scraper.onProgress((progress) => {
                this.sendProgressUpdate(taskId, progress);
            });

            // Set up completion callback
            this.scraper.onComplete((results) => {
                this.sendTaskCompleted(taskId, results);
            });

            // Set up error callback
            this.scraper.onError((error) => {
                this.sendErrorMessage('Scraping error', ErrorSeverity.ERROR, error);
            });

            // Start scraping
            await this.scraper.start();

        } catch (error) {
            console.error('Error starting scraping:', error);
            this.sendErrorMessage('Failed to start scraping', ErrorSeverity.ERROR, error);
        }
    }

    /**
     * Send ready message to main process
     */
    private sendReadyMessage(): void {
        const readyMessage = {
            id: `ready_${Date.now()}`,
            type: MessageType.STATUS_UPDATE,
            timestamp: Date.now(),
            sourceProcessId: this.processId,
            targetProcessId: 'main',
            taskId: '',
            status: TaskStatus.PENDING,
            message: 'Child process ready',
            data: {
                processId: this.processId,
                pid: process.pid,
                ready: true
            }
        };

        this.sendMessage(readyMessage);
    }

    /**
     * Send status update message
     */
    private sendStatusUpdate(taskId: string, status: TaskStatus, message: string, data?: any): void {
        const statusMessage = {
            id: `status_${Date.now()}`,
            type: MessageType.STATUS_UPDATE,
            timestamp: Date.now(),
            sourceProcessId: this.processId,
            targetProcessId: 'main',
            taskId,
            status,
            message,
            data
        };

        this.sendMessage(statusMessage);
    }

    /**
     * Send progress update message
     */
    private sendProgressUpdate(taskId: string, progress: any): void {
        const progressMessage = IPCMessageFactory.createProgressUpdateMessage(
            taskId,
            progress.percentage || 0,
            progress.currentPage || 0,
            progress.totalPages || 0,
            progress.businessesFound || 0,
            progress.status || TaskStatus.RUNNING,
            this.processId,
            'main',
            progress.details
        );

        this.sendMessage(progressMessage);
    }

    /**
     * Send task completed message
     */
    private sendTaskCompleted(taskId: string, results: any): void {
        const completedMessage = {
            id: `completed_${Date.now()}`,
            type: MessageType.TASK_COMPLETED,
            timestamp: Date.now(),
            sourceProcessId: this.processId,
            targetProcessId: 'main',
            taskId,
            results
        };

        this.sendMessage(completedMessage);
    }

    /**
     * Send error message
     */
    private sendErrorMessage(message: string, severity: ErrorSeverity, error?: any): void {
        const errorMessage = IPCMessageFactory.createErrorMessage(
            this.currentTaskId || '',
            message,
            severity,
            this.processId,
            'main',
            error?.stack,
            error?.code,
            { error: error?.message || String(error) }
        );

        this.sendMessage(errorMessage);
    }

    /**
     * Send message to main process
     */
    private sendMessage(message: any): void {
        if (process.send) {
            process.send(message);
        } else {
            console.error('Cannot send message: process.send is not available');
        }
    }

    /**
     * Check if process is healthy
     */
    private isHealthy(): boolean {
        return this.isRunning || !this.isPaused;
    }

    /**
     * Get health details
     */
    private getHealthDetails(): any {
        return {
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            activeTasks: this.isRunning ? 1 : 0,
            uptime: process.uptime(),
            lastActivity: Date.now()
        };
    }

    /**
     * Shutdown the child process
     */
    private async shutdown(): Promise<void> {
        try {
            console.log('Shutting down child process...');

            // Stop any running tasks
            if (this.isRunning) {
                await this.scraper.stop();
            }

            // Send shutdown message
            this.sendStatusUpdate(this.currentTaskId || '', TaskStatus.STOPPED, 'Process shutting down');

            console.log('Child process shutdown complete');
            process.exit(0);

        } catch (error) {
            console.error('Error during shutdown:', error);
            process.exit(1);
        }
    }
}

// Start the child process if this file is executed directly
if (require.main === module) {
    const process = new YellowPagesScraperProcess();
    process.initialize().catch((error) => {
        console.error('Failed to initialize child process:', error);
        process.exit(1);
    });
} 
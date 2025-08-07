import { spawn, ChildProcess } from 'child_process';
import { MessageType, TaskStatus, IPCMessage, TaskControlMessage, TaskDataMessage, ProgressUpdateMessage, StatusUpdateMessage, ResultDataMessage, ErrorMessage, IPCMessageFactory } from '@/interfaces/IPCMessageProtocol';
import { BaseModule } from '@/modules/baseModule';
import path from 'path';

/**
 * Process information interface
 */
interface ProcessInfo {
    processId: string;
    childProcess: ChildProcess;
    taskId: string | null;
    status: TaskStatus;
    startTime: number;
    lastActivity: number;
    isHealthy: boolean;
}

/**
 * Main process ChildProcessManager
 * Manages child processes for Yellow Pages scraping tasks
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class ChildProcessManager extends BaseModule {
    private processes: Map<string, ProcessInfo> = new Map();
    private messageHandlers: Map<MessageType, ((message: IPCMessage) => Promise<void>)[]> = new Map();
    private isInitialized: boolean = false;

    constructor() {
        super();
    }

    /**
     * Initialize the process manager
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('Initializing ChildProcessManager...');
            
            // Setup default message handlers
            this.setupDefaultHandlers();
            
            this.isInitialized = true;
            console.log('ChildProcessManager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize ChildProcessManager:', error);
            throw error;
        }
    }

    /**
     * Spawn a new child process
     */
    async spawnChildProcess(taskId: string): Promise<string> {
        try {
            const processId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            console.log(`Spawning child process for task: ${taskId}`);

            // Spawn the child process
            const childProcess = spawn('node', [
                path.join(__dirname, '../childprocess/YellowPagesScraperProcess.js')
            ], {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc']
            });

            // Setup process event handlers
            this.setupProcessEventHandlers(childProcess, processId, taskId);

            // Create process info
            const processInfo: ProcessInfo = {
                processId,
                childProcess,
                taskId,
                status: TaskStatus.PENDING,
                startTime: Date.now(),
                lastActivity: Date.now(),
                isHealthy: true
            };

            // Add to processes map
            this.processes.set(processId, processInfo);

            console.log(`Child process spawned with ID: ${processId}`);

            return processId;

        } catch (error) {
            console.error('Failed to spawn child process:', error);
            throw error;
        }
    }

    /**
     * Send task control message to child process
     */
    async sendTaskControl(processId: string, type: MessageType, taskId: string, parameters?: any): Promise<void> {
        try {
            const processInfo = this.processes.get(processId);
            if (!processInfo) {
                throw new Error(`Process not found: ${processId}`);
            }

            const message = IPCMessageFactory.createTaskControlMessage(
                type,
                taskId,
                'main',
                processId,
                parameters
            );

            processInfo.childProcess.send(message);
            processInfo.lastActivity = Date.now();

            console.log(`Sent ${type} message to process ${processId}`);

        } catch (error) {
            console.error('Failed to send task control message:', error);
            throw error;
        }
    }

    /**
     * Send task data to child process
     */
    async sendTaskData(processId: string, taskId: string, taskData: any): Promise<void> {
        try {
            const processInfo = this.processes.get(processId);
            if (!processInfo) {
                throw new Error(`Process not found: ${processId}`);
            }

            const message: TaskDataMessage = {
                id: `task_data_${Date.now()}`,
                type: MessageType.TASK_DATA,
                timestamp: Date.now(),
                sourceProcessId: 'main',
                targetProcessId: processId,
                taskId,
                taskData
            };

            processInfo.childProcess.send(message);
            processInfo.lastActivity = Date.now();

            console.log(`Sent task data to process ${processId}`);

        } catch (error) {
            console.error('Failed to send task data:', error);
            throw error;
        }
    }

    /**
     * Start a task in a child process
     */
    async startTask(taskId: string, taskData: any): Promise<string> {
        try {
            // Spawn child process
            const processId = await this.spawnChildProcess(taskId);

            // Wait for process to be ready
            await this.waitForProcessReady(processId);

            // Send task data
            await this.sendTaskData(processId, taskId, taskData);

            // Send start command
            await this.sendTaskControl(processId, MessageType.START_TASK, taskId);

            console.log(`Task ${taskId} started in process ${processId}`);

            return processId;

        } catch (error) {
            console.error('Failed to start task:', error);
            throw error;
        }
    }

    /**
     * Stop a task
     */
    async stopTask(processId: string, taskId: string): Promise<void> {
        try {
            await this.sendTaskControl(processId, MessageType.STOP_TASK, taskId);
            console.log(`Task ${taskId} stopped in process ${processId}`);

        } catch (error) {
            console.error('Failed to stop task:', error);
            throw error;
        }
    }

    /**
     * Pause a task
     */
    async pauseTask(processId: string, taskId: string): Promise<void> {
        try {
            await this.sendTaskControl(processId, MessageType.PAUSE_TASK, taskId);
            console.log(`Task ${taskId} paused in process ${processId}`);

        } catch (error) {
            console.error('Failed to pause task:', error);
            throw error;
        }
    }

    /**
     * Resume a task
     */
    async resumeTask(processId: string, taskId: string): Promise<void> {
        try {
            await this.sendTaskControl(processId, MessageType.RESUME_TASK, taskId);
            console.log(`Task ${taskId} resumed in process ${processId}`);

        } catch (error) {
            console.error('Failed to resume task:', error);
            throw error;
        }
    }

    /**
     * Kill a child process
     */
    async killProcess(processId: string): Promise<void> {
        try {
            const processInfo = this.processes.get(processId);
            if (!processInfo) {
                console.warn(`Process not found: ${processId}`);
                return;
            }

            console.log(`Killing process: ${processId}`);

            // Kill the child process
            processInfo.childProcess.kill('SIGTERM');

            // Remove from processes map
            this.processes.delete(processId);

            console.log(`Process ${processId} killed successfully`);

        } catch (error) {
            console.error('Failed to kill process:', error);
            throw error;
        }
    }

    /**
     * Get process information
     */
    getProcessInfo(processId: string): ProcessInfo | null {
        return this.processes.get(processId) || null;
    }

    /**
     * Get all active processes
     */
    getActiveProcesses(): ProcessInfo[] {
        return Array.from(this.processes.values());
    }

    /**
     * Get process count
     */
    getProcessCount(): number {
        return this.processes.size;
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
     * Setup process event handlers
     */
    private setupProcessEventHandlers(childProcess: ChildProcess, processId: string, taskId: string): void {
        // Handle messages from child process
        childProcess.on('message', async (message: any) => {
            try {
                await this.handleChildMessage(message, processId);
            } catch (error) {
                console.error('Error handling child message:', error);
            }
        });

        // Handle process exit
        childProcess.on('exit', (code, signal) => {
            console.log(`Child process ${processId} exited with code ${code} and signal ${signal}`);
            this.handleProcessExit(processId, code, signal);
        });

        // Handle process error
        childProcess.on('error', (error) => {
            console.error(`Child process ${processId} error:`, error);
            this.handleProcessError(processId, error);
        });

        // Handle stdout
        childProcess.stdout?.on('data', (data) => {
            console.log(`[${processId}] ${data.toString().trim()}`);
        });

        // Handle stderr
        childProcess.stderr?.on('data', (data) => {
            console.error(`[${processId}] ${data.toString().trim()}`);
        });
    }

    /**
     * Handle message from child process
     */
    private async handleChildMessage(message: any, processId: string): Promise<void> {
        try {
            // Update process activity
            const processInfo = this.processes.get(processId);
            if (processInfo) {
                processInfo.lastActivity = Date.now();
            }

            // Call registered handlers
            const handlers = this.messageHandlers.get(message.type);
            if (handlers) {
                for (const handler of handlers) {
                    await handler(message);
                }
            }

            // Handle specific message types
            switch (message.type) {
                case MessageType.STATUS_UPDATE:
                    await this.handleStatusUpdate(message, processId);
                    break;

                case MessageType.PROGRESS_UPDATE:
                    await this.handleProgressUpdate(message, processId);
                    break;

                case MessageType.TASK_COMPLETED:
                    await this.handleTaskCompleted(message, processId);
                    break;

                case MessageType.TASK_ERROR:
                    await this.handleTaskError(message, processId);
                    break;
            }

        } catch (error) {
            console.error('Error handling child message:', error);
        }
    }

    /**
     * Handle status update from child process
     */
    private async handleStatusUpdate(message: StatusUpdateMessage, processId: string): Promise<void> {
        const processInfo = this.processes.get(processId);
        if (processInfo) {
            processInfo.status = message.status;
            console.log(`Process ${processId} status: ${message.status} - ${message.message}`);
        }
    }

    /**
     * Handle progress update from child process
     */
    private async handleProgressUpdate(message: ProgressUpdateMessage, processId: string): Promise<void> {
        console.log(`Process ${processId} progress: ${message.progress}% (${message.currentPage}/${message.totalPages})`);
    }

    /**
     * Handle task completed from child process
     */
    private async handleTaskCompleted(message: any, processId: string): Promise<void> {
        console.log(`Task completed in process ${processId}:`, message.results?.length || 0, 'results');
    }

    /**
     * Handle task error from child process
     */
    private async handleTaskError(message: ErrorMessage, processId: string): Promise<void> {
        console.error(`Task error in process ${processId}:`, message.message);
    }

    /**
     * Handle process exit
     */
    private handleProcessExit(processId: string, code: number | null, signal: string | null): void {
        const processInfo = this.processes.get(processId);
        if (processInfo) {
            console.log(`Process ${processId} exited with code ${code} and signal ${signal}`);
            this.processes.delete(processId);
        }
    }

    /**
     * Handle process error
     */
    private handleProcessError(processId: string, error: Error): void {
        console.error(`Process ${processId} error:`, error);
        const processInfo = this.processes.get(processId);
        if (processInfo) {
            processInfo.isHealthy = false;
        }
    }

    /**
     * Wait for process to be ready
     */
    private async waitForProcessReady(processId: string, timeout: number = 30000): Promise<void> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkReady = () => {
                const processInfo = this.processes.get(processId);
                if (processInfo && processInfo.status !== TaskStatus.PENDING) {
                    resolve();
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    reject(new Error(`Process ${processId} not ready within ${timeout}ms`));
                    return;
                }

                setTimeout(checkReady, 100);
            };

            checkReady();
        });
    }

    /**
     * Setup default message handlers
     */
    private setupDefaultHandlers(): void {
        // Default handler for all messages
        this.registerMessageHandler(MessageType.STATUS_UPDATE, async (message) => {
            console.log('Status update received:', message);
        });

        this.registerMessageHandler(MessageType.PROGRESS_UPDATE, async (message) => {
            console.log('Progress update received:', message);
        });

        this.registerMessageHandler(MessageType.TASK_COMPLETED, async (message) => {
            console.log('Task completed:', message);
        });

        this.registerMessageHandler(MessageType.TASK_ERROR, async (message) => {
            console.error('Task error:', message);
        });
    }

    /**
     * Get process statistics
     */
    getStatistics(): {
        totalProcesses: number;
        activeProcesses: number;
        healthyProcesses: number;
        totalTasks: number;
    } {
        const processes = Array.from(this.processes.values());
        
        return {
            totalProcesses: processes.length,
            activeProcesses: processes.filter(p => p.status === TaskStatus.RUNNING).length,
            healthyProcesses: processes.filter(p => p.isHealthy).length,
            totalTasks: processes.filter(p => p.taskId).length
        };
    }
} 
import { spawn, ChildProcess } from 'child_process';
import { YellowPagesTaskModel, YellowPagesTaskStatus } from "@/model/YellowPagesTask.model";
import { BaseModule } from "@/modules/baseModule";
import { IPCMessage, ScrapingProgress } from "@/interfaces/IPCMessage";

interface ProcessInfo {
    taskId: number;
    process: ChildProcess;
    startTime: Date;
    status: 'running' | 'completed' | 'failed' | 'stopped';
    progress?: ScrapingProgress;
}

export class YellowPagesProcessManager extends BaseModule {
    private activeProcesses: Map<number, ProcessInfo> = new Map();
    private taskModel: YellowPagesTaskModel;

    constructor() {
        super();
        this.taskModel = new YellowPagesTaskModel(this.dbpath);
    }

    /**
     * Spawn a child process for Yellow Pages scraping
     */
    async spawnScraperProcess(taskId: number): Promise<ChildProcess> {
        try {
            console.log(`Spawning Yellow Pages scraper process for task ${taskId}`);

            // Check if process already exists
            if (this.activeProcesses.has(taskId)) {
                throw new Error(`Process for task ${taskId} already exists`);
            }
            //const childPath = path.join(__dirname, 'yellowPagesScraper.js')
            // Spawn the child process
            const childProcess = spawn('node', [
                'dist/childprocess/yellowPagesScraper.js'
            ], {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc']
            });

            // Set up process info
            const processInfo: ProcessInfo = {
                taskId,
                process: childProcess,
                startTime: new Date(),
                status: 'running'
            };

            this.activeProcesses.set(taskId, processInfo);

            // Set up IPC handlers
            this.setupIPCHandlers(childProcess, taskId);

            // Set up error handlers
            this.setupErrorHandlers(childProcess, taskId);

            // Send start message to child process
            childProcess.send({ type: 'START', taskId });

            console.log(`Successfully spawned process for task ${taskId}`);
            return childProcess;

        } catch (error) {
            console.error(`Failed to spawn process for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Set up IPC message handlers
     */
    private setupIPCHandlers(childProcess: ChildProcess, taskId: number): void {
        childProcess.on('message', (message: IPCMessage) => {
            console.log(`Received message from task ${taskId}:`, message);

            switch (message.type) {
                case 'PROGRESS':
                    if (message.progress) {
                        this.handleProgressMessage(taskId, message.progress);
                    }
                    break;
                case 'COMPLETED':
                    this.handleCompletionMessage(taskId);
                    break;
                case 'ERROR':
                    this.handleErrorMessage(taskId, message.error || 'Unknown error');
                    break;
                default:
                    console.log(`Unknown message type from task ${taskId}:`, message.type);
            }
        });
    }

    /**
     * Set up error handlers
     */
    private setupErrorHandlers(childProcess: ChildProcess, taskId: number): void {
        childProcess.on('error', (error) => {
            console.error(`Process error for task ${taskId}:`, error);
            this.handleProcessError(taskId, error);
        });

        childProcess.on('exit', (code, signal) => {
            console.log(`Process exited for task ${taskId}: code=${code}, signal=${signal}`);
            this.handleProcessExit(taskId, code, signal);
        });

        childProcess.on('close', (code) => {
            console.log(`Process closed for task ${taskId}: code=${code}`);
            this.handleProcessClose(taskId, code);
        });
    }

    /**
     * Handle progress messages from child process
     */
    private handleProgressMessage(taskId: number, progress: ScrapingProgress): void {
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            processInfo.progress = progress;
            console.log(`Progress for task ${taskId}:`, progress);
        }
    }

    /**
     * Handle completion messages from child process
     */
    private async handleCompletionMessage(taskId: number): Promise<void> {
        console.log(`Task ${taskId} completed successfully`);
        
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            processInfo.status = 'completed';
        }

        // Update task status in database
        try {
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Completed);
            await this.taskModel.updateTaskCompletion(taskId);
        } catch (error) {
            console.error(`Failed to update task ${taskId} status:`, error);
        }

        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Handle error messages from child process
     */
    private async handleErrorMessage(taskId: number, error: string): Promise<void> {
        console.error(`Task ${taskId} failed:`, error);
        
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            processInfo.status = 'failed';
        }

        // Update task status in database
        try {
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Failed);
            await this.taskModel.updateTaskErrorLog(taskId, error);
        } catch (dbError) {
            console.error(`Failed to update task ${taskId} error status:`, dbError);
        }

        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Handle process errors
     */
    private async handleProcessError(taskId: number, error: Error): Promise<void> {
        console.error(`Process error for task ${taskId}:`, error);
        
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            processInfo.status = 'failed';
        }

        // Update task status in database
        try {
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Failed);
            await this.taskModel.updateTaskErrorLog(taskId, error.message);
        } catch (dbError) {
            console.error(`Failed to update task ${taskId} error status:`, dbError);
        }

        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Handle process exit
     */
    private handleProcessExit(taskId: number, code: number | null, signal: string | null): void {
        console.log(`Process exit for task ${taskId}: code=${code}, signal=${signal}`);
        
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            if (code === 0) {
                processInfo.status = 'completed';
            } else {
                processInfo.status = 'failed';
            }
        }

        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Handle process close
     */
    private handleProcessClose(taskId: number, code: number | null): void {
        console.log(`Process close for task ${taskId}: code=${code}`);
        
        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Terminate a specific process
     */
    async terminateProcess(taskId: number): Promise<void> {
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            console.log(`Terminating process for task ${taskId}`);
            
            try {
                processInfo.process.kill('SIGTERM');
                processInfo.status = 'stopped';
                
                // Update task status
                await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Paused);
                
                // Clean up after a short delay
                setTimeout(() => {
                    this.cleanupProcess(taskId);
                }, 1000);
                
            } catch (error) {
                console.error(`Failed to terminate process for task ${taskId}:`, error);
            }
        } else {
            console.log(`No active process found for task ${taskId}`);
        }
    }

    /**
     * Get all active processes
     */
    getActiveProcesses(): Map<number, ProcessInfo> {
        return this.activeProcesses;
    }

    /**
     * Get process info for a specific task
     */
    getProcessInfo(taskId: number): ProcessInfo | undefined {
        return this.activeProcesses.get(taskId);
    }

    /**
     * Check if a process is running
     */
    isProcessRunning(taskId: number): boolean {
        const processInfo = this.activeProcesses.get(taskId);
        return processInfo?.status === 'running';
    }

    /**
     * Get process count
     */
    getProcessCount(): number {
        return this.activeProcesses.size;
    }

    /**
     * Clean up process resources
     */
    private cleanupProcess(taskId: number): void {
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            // Remove from active processes
            this.activeProcesses.delete(taskId);
            console.log(`Cleaned up process for task ${taskId}`);
        }
    }

    /**
     * Terminate all active processes
     */
    async terminateAllProcesses(): Promise<void> {
        console.log('Terminating all active processes...');
        
        const promises = Array.from(this.activeProcesses.keys()).map(taskId =>
            this.terminateProcess(taskId)
        );
        
        await Promise.all(promises);
        console.log('All processes terminated');
    }

    /**
     * Health check for process isolation
     */
    async healthCheck(): Promise<{
        totalProcesses: number;
        runningProcesses: number;
        completedProcesses: number;
        failedProcesses: number;
        processIsolation: boolean;
    }> {
        const processes = Array.from(this.activeProcesses.values());
        const running = processes.filter(p => p.status === 'running').length;
        const completed = processes.filter(p => p.status === 'completed').length;
        const failed = processes.filter(p => p.status === 'failed').length;

        // Check process isolation by verifying each process has its own PID
        const pids = processes.map(p => p.process.pid);
        const uniquePids = new Set(pids);
        const processIsolation = uniquePids.size === pids.length;

        return {
            totalProcesses: processes.length,
            runningProcesses: running,
            completedProcesses: completed,
            failedProcesses: failed,
            processIsolation
        };
    }
} 
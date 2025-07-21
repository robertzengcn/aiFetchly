import { BaseDb } from "@/model/Basedb";
import { ScheduleManager } from "./ScheduleManager";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { ScheduleExecutionLogModel } from "@/model/ScheduleExecutionLog.model";
import { ScheduleTaskEntity, TaskType, ScheduleStatus, TriggerType } from "@/entity/ScheduleTask.entity";
import { ExecutionStatus, TriggerType as LogTriggerType } from "@/entity/ScheduleExecutionLog.entity";
import { TaskExecutorService } from "./TaskExecutorService";
import { ScheduleTaskModuleInterface } from "@/modules/interface/ScheduleTaskModuleInterface";
import { ScheduleTaskModule } from "@/modules/ScheduleTaskModule";

export interface SchedulerStatus {
    isRunning: boolean;
    activeSchedules: number;
    totalSchedules: number;
    lastCheckTime: Date;
    nextCheckTime: Date;
    queueSize: number;
    runningExecutions: number;
    lastExecutionTime: Date | null;
}

export interface ExecutionQueueItem {
    scheduleId: number;
    priority: number;
    retryCount: number;
    maxRetries: number;
    parentExecutionId?: number;
    triggeredBy: LogTriggerType;
    scheduledTime: Date;
}

export interface DetailedStats {
    scheduler: SchedulerStatus;
    taskTypeStats: Record<string, {
        total: number;
        active: number;
        successful: number;
        failed: number;
        averageExecutionTime: number;
    }>;
    recentExecutions: Array<{
        scheduleId: number;
        scheduleName: string;
        status: ExecutionStatus;
        duration: number;
        executionTime: Date;
    }>;
    dependencyStats: {
        totalDependencies: number;
        activeDependencies: number;
        circularDependencies: number;
    };
}

export class BackgroundScheduler extends BaseDb {
    private scheduleManager: ScheduleManager;
    private scheduleTaskModel: ScheduleTaskModuleInterface;
    private scheduleExecutionLogModel: ScheduleExecutionLogModel;
    private taskExecutorService: TaskExecutorService;
    
    private isInitialized: boolean = false;
    private isRunning: boolean = false;
    private executionQueue: ExecutionQueueItem[] = [];
    private runningExecutions: Set<number> = new Set();
    private maxConcurrentExecutions: number = 5;
    private maxRetries: number = 3;
    private retryDelayMs: number = 60000; // 1 minute
    
    // Timers and intervals
    private cronCheckInterval: NodeJS.Timeout | null = null;
    private dependencyCheckInterval: NodeJS.Timeout | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;
    private queueProcessInterval: NodeJS.Timeout | null = null;
    
    // Statistics
    private lastCheckTime: Date = new Date();
    private lastExecutionTime: Date | null = null;
    private totalExecutions: number = 0;
    private successfulExecutions: number = 0;
    private failedExecutions: number = 0;

    constructor(filepath: string) {
        super(filepath);
        this.scheduleManager = ScheduleManager.getInstance();
        this.scheduleTaskModel = new ScheduleTaskModule();
        this.scheduleExecutionLogModel = new ScheduleExecutionLogModel(filepath);
        this.taskExecutorService = new TaskExecutorService();
    }

    /**
     * Initialize the background scheduler
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('Initializing BackgroundScheduler...');
            
            // Initialize the schedule manager
            await this.scheduleManager.initializeSchedules();
            
            // Load any pending executions from database
            await this.loadPendingExecutions();
            
            this.isInitialized = true;
            console.log('BackgroundScheduler initialized successfully');
        } catch (error) {
            console.error('Failed to initialize BackgroundScheduler:', error);
            throw error;
        }
    }

    /**
     * Start the background scheduler
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log('BackgroundScheduler is already running');
            return;
        }

        try {
            console.log('Starting BackgroundScheduler...');
            
            // Ensure initialization
            if (!this.isInitialized) {
                await this.initialize();
            }

            this.isRunning = true;

            // Start cron-based schedule checking (every minute)
            this.cronCheckInterval = setInterval(async () => {
                await this.processScheduledTasks();
            }, 60000);

            // Start dependency-based schedule checking (every 30 seconds)
            this.dependencyCheckInterval = setInterval(async () => {
                await this.processDependencyQueue();
            }, 30000);

            // Start execution queue processing (every 10 seconds)
            this.queueProcessInterval = setInterval(async () => {
                await this.processExecutionQueue();
            }, 10000);

            // Start cleanup tasks (every hour)
            this.cleanupInterval = setInterval(async () => {
                await this.performCleanup();
            }, 3600000);

            // Process initial tasks
            await this.processScheduledTasks();
            await this.processDependencyQueue();

            console.log('BackgroundScheduler started successfully');
        } catch (error) {
            console.error('Failed to start BackgroundScheduler:', error);
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Stop the background scheduler
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            console.log('BackgroundScheduler is not running');
            return;
        }

        try {
            console.log('Stopping BackgroundScheduler...');
            
            this.isRunning = false;

            // Clear all intervals
            if (this.cronCheckInterval) {
                clearInterval(this.cronCheckInterval);
                this.cronCheckInterval = null;
            }

            if (this.dependencyCheckInterval) {
                clearInterval(this.dependencyCheckInterval);
                this.dependencyCheckInterval = null;
            }

            if (this.queueProcessInterval) {
                clearInterval(this.queueProcessInterval);
                this.queueProcessInterval = null;
            }

            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }

            // Wait for running executions to complete (with timeout)
            const maxWaitTime = 30000; // 30 seconds
            const startTime = Date.now();
            
            while (this.runningExecutions.size > 0 && (Date.now() - startTime) < maxWaitTime) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Force stop remaining executions
            if (this.runningExecutions.size > 0) {
                console.warn(`Force stopping ${this.runningExecutions.size} remaining executions`);
                this.runningExecutions.clear();
            }

            console.log('BackgroundScheduler stopped successfully');
        } catch (error) {
            console.error('Error stopping BackgroundScheduler:', error);
            throw error;
        }
    }

    /**
     * Reload schedules from database
     */
    async reloadSchedules(): Promise<void> {
        try {
            console.log('Reloading schedules...');
            
            // Stop the schedule manager
            await this.scheduleManager.stop();
            
            // Reinitialize the schedule manager
            await this.scheduleManager.initializeSchedules();
            
            // Restart if we were running
            if (this.isRunning) {
                await this.scheduleManager.start();
            }
            
            console.log('Schedules reloaded successfully');
        } catch (error) {
            console.error('Failed to reload schedules:', error);
            throw error;
        }
    }

    /**
     * Get current scheduler status
     */
    getSchedulerStatus(): SchedulerStatus {
        const now = new Date();
        const nextCheck = new Date(now.getTime() + 60000); // 1 minute from now

        return {
            isRunning: this.isRunning,
            activeSchedules: this.scheduleManager.getSchedulerStatus().activeSchedules,
            totalSchedules: this.scheduleManager.getSchedulerStatus().totalSchedules,
            lastCheckTime: this.lastCheckTime,
            nextCheckTime: nextCheck,
            queueSize: this.executionQueue.length,
            runningExecutions: this.runningExecutions.size,
            lastExecutionTime: this.lastExecutionTime
        };
    }

    /**
     * Handle application shutdown
     */
    async handleAppShutdown(): Promise<void> {
        console.log('Handling application shutdown...');
        
        try {
            // Stop the background scheduler
            await this.stop();
            
            // Stop the schedule manager
            await this.scheduleManager.handleAppShutdown();
            
            console.log('Application shutdown handled successfully');
        } catch (error) {
            console.error('Error during application shutdown:', error);
        }
    }

    /**
     * Process cron-based scheduled tasks
     */
    private async processScheduledTasks(): Promise<void> {
        try {
            this.lastCheckTime = new Date();
            
            // Get schedules ready to execute
            const readySchedules = await this.scheduleTaskModel.getSchedulesReadyToExecute();
            
            for (const schedule of readySchedules) {
                if (!this.isRunning) break;
                
                // Add to execution queue
                this.addToExecutionQueue({
                    scheduleId: schedule.id,
                    priority: 1, // Normal priority
                    retryCount: 0,
                    maxRetries: this.maxRetries,
                    triggeredBy: LogTriggerType.CRON,
                    scheduledTime: new Date()
                });
            }
            
            if (readySchedules.length > 0) {
                console.log(`Found ${readySchedules.length} schedules ready to execute`);
            }
        } catch (error) {
            console.error('Error processing scheduled tasks:', error);
        }
    }

    /**
     * Process dependency-based schedules
     */
    private async processDependencyQueue(): Promise<void> {
        try {
            // This is handled by the ScheduleManager
            // We just need to check for any dependency-triggered schedules
            const dependencySchedules = await this.scheduleTaskModel.getSchedulesByTriggerType(TriggerType.DEPENDENCY);
            
            for (const schedule of dependencySchedules) {
                if (!schedule.is_active) continue;
                
                // Check if parent schedules have completed
                const parentSchedule = await this.scheduleTaskModel.getParentSchedule(schedule.id);
                if (parentSchedule && parentSchedule.status === ScheduleStatus.ACTIVE) {
                    this.addToExecutionQueue({
                        scheduleId: schedule.id,
                        priority: 2, // Higher priority for dependencies
                        retryCount: 0,
                        maxRetries: this.maxRetries,
                        triggeredBy: LogTriggerType.DEPENDENCY,
                        scheduledTime: new Date()
                    });
                }
            }
        } catch (error) {
            console.error('Error processing dependency queue:', error);
        }
    }

    /**
     * Process the execution queue
     */
    private async processExecutionQueue(): Promise<void> {
        if (!this.isRunning || this.runningExecutions.size >= this.maxConcurrentExecutions) {
            return;
        }

        // Sort queue by priority and scheduled time
        this.executionQueue.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority; // Higher priority first
            }
            return a.scheduledTime.getTime() - b.scheduledTime.getTime();
        });

        while (this.executionQueue.length > 0 && 
               this.runningExecutions.size < this.maxConcurrentExecutions) {
            
            const queueItem = this.executionQueue.shift();
            if (!queueItem) break;

            // Check if schedule is still active
            const schedule = await this.scheduleTaskModel.getScheduleById(queueItem.scheduleId);
            if (!schedule || !schedule.is_active) {
                continue;
            }

            // Execute the schedule
            this.runningExecutions.add(queueItem.scheduleId);
            this.executeScheduleWithRetry(queueItem).finally(() => {
                this.runningExecutions.delete(queueItem.scheduleId);
            });
        }
    }

    /**
     * Execute a schedule with retry logic
     */
    private async executeScheduleWithRetry(queueItem: ExecutionQueueItem): Promise<void> {
        try {
            this.lastExecutionTime = new Date();
            this.totalExecutions++;

            console.log(`Executing schedule ${queueItem.scheduleId} (attempt ${queueItem.retryCount + 1})`);

            // Log execution start
            const executionId = await this.scheduleExecutionLogModel.logExecution(
                queueItem.scheduleId,
                ExecutionStatus.RUNNING,
                'Execution started',
                0,
                queueItem.parentExecutionId,
                queueItem.triggeredBy
            );

            const startTime = Date.now();

            try {
                // Execute the task
                const schedule = await this.scheduleTaskModel.getScheduleById(queueItem.scheduleId);
                if (!schedule) {
                    throw new Error('Schedule not found');
                }

                const taskOutputId = await this.taskExecutorService.executeScheduledTask(schedule, executionId);

                // Calculate duration
                const duration = Date.now() - startTime;

                // Update execution log with success
                await this.scheduleExecutionLogModel.updateExecutionStatus(
                    executionId,
                    ExecutionStatus.SUCCESS,
                    'Task executed successfully',
                    duration
                );

                // Update schedule statistics
                await this.scheduleTaskModel.incrementExecutionCount(queueItem.scheduleId, true);
                await this.scheduleTaskModel.updateLastRunTime(queueItem.scheduleId, new Date());

                // Calculate and update next run time for cron schedules
                if (schedule.trigger_type === TriggerType.CRON) {
                    const nextRunTime = this.scheduleManager.calculateNextRunTime(schedule.cron_expression);
                    await this.scheduleTaskModel.updateNextRunTime(queueItem.scheduleId, nextRunTime);
                }

                this.successfulExecutions++;
                console.log(`Schedule ${queueItem.scheduleId} executed successfully in ${duration}ms`);

                // Handle job completion
                await this.handleJobCompletion(executionId, ExecutionStatus.SUCCESS);

            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // Update execution log with failure
                await this.scheduleExecutionLogModel.updateExecutionStatus(
                    executionId,
                    ExecutionStatus.FAILED,
                    errorMessage,
                    duration
                );

                // Update schedule statistics
                await this.scheduleTaskModel.incrementExecutionCount(queueItem.scheduleId, false);
                await this.scheduleTaskModel.updateLastErrorMessage(queueItem.scheduleId, errorMessage);

                this.failedExecutions++;
                console.error(`Schedule ${queueItem.scheduleId} execution failed:`, error);

                // Handle retry logic
                if (queueItem.retryCount < queueItem.maxRetries) {
                    console.log(`Retrying schedule ${queueItem.scheduleId} in ${this.retryDelayMs}ms`);
                    
                    setTimeout(() => {
                        this.addToExecutionQueue({
                            ...queueItem,
                            retryCount: queueItem.retryCount + 1,
                            scheduledTime: new Date()
                        });
                    }, this.retryDelayMs);
                } else {
                    console.error(`Schedule ${queueItem.scheduleId} failed after ${queueItem.maxRetries} retries`);
                    
                    // Handle job completion for failed execution
                    await this.handleJobCompletion(executionId, ExecutionStatus.FAILED);
                }
            }

        } catch (error) {
            console.error(`Error in executeScheduleWithRetry for schedule ${queueItem.scheduleId}:`, error);
        }
    }

    /**
     * Handle job completion and trigger dependent jobs
     */
    private async handleJobCompletion(executionId: number, status: ExecutionStatus): Promise<void> {
        try {
            // Get the execution to find the schedule
            const execution = await this.scheduleExecutionLogModel.getExecutionById(executionId);
            if (!execution) {
                return;
            }

            const schedule = await this.scheduleTaskModel.getScheduleById(execution.schedule_id);
            if (!schedule) {
                return;
            }

            // Execute dependent jobs
            await this.scheduleManager.executeDependentJobs(executionId, status);

        } catch (error) {
            console.error('Error handling job completion:', error);
        }
    }

    /**
     * Add item to execution queue
     */
    private addToExecutionQueue(queueItem: ExecutionQueueItem): void {
        // Check if already in queue
        const existingIndex = this.executionQueue.findIndex(item => item.scheduleId === queueItem.scheduleId);
        if (existingIndex !== -1) {
            // Update existing item if new one has higher priority
            if (queueItem.priority > this.executionQueue[existingIndex].priority) {
                this.executionQueue[existingIndex] = queueItem;
            }
            return;
        }

        this.executionQueue.push(queueItem);
    }

    /**
     * Load pending executions from database
     */
    private async loadPendingExecutions(): Promise<void> {
        try {
            const runningExecutions = await this.scheduleExecutionLogModel.getRunningExecutions();
            
            for (const execution of runningExecutions) {
                // Mark as failed if it's been running too long (e.g., > 1 hour)
                const executionAge = Date.now() - execution.execution_time.getTime();
                if (executionAge > 3600000) { // 1 hour
                    await this.scheduleExecutionLogModel.updateExecutionStatus(
                        execution.id,
                        ExecutionStatus.FAILED,
                        'Execution timed out',
                        executionAge
                    );
                } else {
                    // Add back to queue for retry
                    this.addToExecutionQueue({
                        scheduleId: execution.schedule_id,
                        priority: 1,
                        retryCount: 0,
                        maxRetries: this.maxRetries,
                        triggeredBy: execution.triggered_by as LogTriggerType,
                        scheduledTime: new Date()
                    });
                }
            }
        } catch (error) {
            console.error('Error loading pending executions:', error);
        }
    }

    /**
     * Perform periodic cleanup tasks
     */
    private async performCleanup(): Promise<void> {
        try {
            console.log('Performing cleanup tasks...');
            
            // Clean up old execution logs (keep last 30 days)
            const deletedCount = await this.scheduleExecutionLogModel.cleanupOldExecutions(30);
            if (deletedCount > 0) {
                console.log(`Cleaned up ${deletedCount} old execution logs`);
            }
            
            // Clean up inactive dependencies
            const deletedDependencies = await (this.scheduleManager as any).scheduleDependencyModel.cleanupInactiveDependencies();
            if (deletedDependencies > 0) {
                console.log(`Cleaned up ${deletedDependencies} inactive dependencies`);
            }
            
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    /**
     * Manually trigger a schedule execution
     */
    async triggerSchedule(scheduleId: number): Promise<void> {
        try {
            const schedule = await this.scheduleTaskModel.getScheduleById(scheduleId);
            if (!schedule) {
                throw new Error(`Schedule ${scheduleId} not found`);
            }

            if (!schedule.is_active) {
                throw new Error(`Schedule ${scheduleId} is not active`);
            }

            this.addToExecutionQueue({
                scheduleId: scheduleId,
                priority: 3, // Highest priority for manual triggers
                retryCount: 0,
                maxRetries: this.maxRetries,
                triggeredBy: LogTriggerType.MANUAL,
                scheduledTime: new Date()
            });

            console.log(`Manually triggered schedule ${scheduleId}`);
        } catch (error) {
            console.error(`Error triggering schedule ${scheduleId}:`, error);
            throw error;
        }
    }

    /**
     * Get detailed scheduler statistics
     */
    async getDetailedStats(): Promise<DetailedStats> {
        try {
            const schedulerStatus = this.getSchedulerStatus();
            
            // Get task type statistics
            const taskTypeStats: Record<string, any> = {};
            const taskTypes = Object.values(TaskType);
            
            for (const taskType of taskTypes) {
                const schedules = await this.scheduleTaskModel.getSchedulesByTaskType(taskType);
                const activeSchedules = schedules.filter(s => s.is_active);
                
                const stats = await this.taskExecutorService.getTaskExecutionStatistics(taskType);
                
                taskTypeStats[taskType] = {
                    total: schedules.length,
                    active: activeSchedules.length,
                    successful: stats.completed,
                    failed: stats.failed,
                    averageExecutionTime: stats.averageExecutionTime
                };
            }

            // Get recent executions
            const recentExecutions = await this.scheduleExecutionLogModel.getRecentExecutions(10);
            const recentExecutionsWithNames = await Promise.all(
                recentExecutions.map(async (execution) => {
                    const schedule = await this.scheduleTaskModel.getScheduleById(execution.schedule_id);
                    return {
                        scheduleId: execution.schedule_id,
                        scheduleName: schedule?.name || 'Unknown',
                        status: execution.status as ExecutionStatus,
                        duration: execution.execution_duration || 0,
                        executionTime: execution.execution_time
                    };
                })
            );

            // Get dependency statistics
            const dependencyStats = await (this.scheduleManager as any).scheduleDependencyModel.getDependencyStatistics();

            return {
                scheduler: schedulerStatus,
                taskTypeStats,
                recentExecutions: recentExecutionsWithNames,
                dependencyStats: {
                    totalDependencies: dependencyStats.total,
                    activeDependencies: dependencyStats.active,
                    circularDependencies: 0 // This would need to be calculated
                }
            };
        } catch (error) {
            console.error('Error getting detailed stats:', error);
            throw error;
        }
    }

    /**
     * Set maximum concurrent executions
     */
    setMaxConcurrentExecutions(max: number): void {
        this.maxConcurrentExecutions = Math.max(1, Math.min(max, 20)); // Limit between 1 and 20
    }

    /**
     * Set retry configuration
     */
    setRetryConfig(maxRetries: number, retryDelayMs: number): void {
        this.maxRetries = Math.max(0, Math.min(maxRetries, 10)); // Limit between 0 and 10
        this.retryDelayMs = Math.max(1000, Math.min(retryDelayMs, 300000)); // Limit between 1s and 5m
    }
} 
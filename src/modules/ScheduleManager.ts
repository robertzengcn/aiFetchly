import { BaseDb } from "@/model/Basedb";
//import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { ScheduleTaskModule } from "@/modules/ScheduleTaskModule";
import {ScheduleTaskModuleInterface} from "@/modules/interface/ScheduleTaskModuleInterface"
import { ScheduleExecutionLogModel } from "@/model/ScheduleExecutionLog.model";
//import { ScheduleDependencyModel } from "@/model/ScheduleDependency.model";
import { ScheduleTaskEntity, TaskType, ScheduleStatus, TriggerType, DependencyCondition } from "@/entity/ScheduleTask.entity";
import { ExecutionStatus, TriggerType as LogTriggerType } from "@/entity/ScheduleExecutionLog.entity";
import { TaskExecutorService } from "./TaskExecutorService";
import { CronJob } from 'cron';
import {ScheduleExecutionLogInterface} from "@/modules/interface/ScheduleExecutionLogInterface"
import { ScheduleExecutionLogModule } from "./ScheduleExecutionLogModule";
import { ScheduleDependencyModule } from "./ScheduleDependencyModule";
import { ScheduleDependencyInterface } from "./interface/ScheduleDependencyInterface";
import { SchedulerStatusModel } from "@/model/SchedulerStatus.model";
import { Token } from "@/modules/token";
import { USERSDBPATH } from '@/config/usersetting';
export interface SchedulerStatus {
    isRunning: boolean;
    activeSchedules: number;
    totalSchedules: number;
    lastCheckTime: Date;
    nextCheckTime: Date;
}

export class ScheduleManager {
    private static instance: ScheduleManager;
    private cronJobs: Map<number, CronJob> = new Map();
    private isInitialized: boolean = false;
    private isRunning: boolean = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private scheduleTaskModule: ScheduleTaskModuleInterface;
    private scheduleExecutionLogModule: ScheduleExecutionLogInterface;
    private scheduleDependencyModule: ScheduleDependencyInterface;
    private taskExecutorModule: TaskExecutorService;
    private schedulerStatusModel: SchedulerStatusModel;
    private dbpath: string;

    private constructor() {
        const tokenService = new Token();
        const dbpath = tokenService.getValue(USERSDBPATH);
        if (!dbpath) {
            throw new Error("Database path not found");
        }
        this.dbpath = dbpath;
        
        this.scheduleTaskModule = new ScheduleTaskModule();
        this.scheduleExecutionLogModule = new ScheduleExecutionLogModule();
        this.scheduleDependencyModule = new ScheduleDependencyModule();
        this.taskExecutorModule = new TaskExecutorService();
        this.schedulerStatusModel = new SchedulerStatusModel(this.dbpath);
    }

    public static getInstance(): ScheduleManager {
        if (!ScheduleManager.instance) {
            ScheduleManager.instance = new ScheduleManager();
        }
        return ScheduleManager.instance;
    }

    /**
     * Initialize the scheduler and load all active schedules
     */
    async initializeSchedules(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // Load all active schedules
            const activeSchedules = await this.scheduleTaskModule.getActiveSchedules();
            
            // Add each schedule to the scheduler
            for (const schedule of activeSchedules) {
                await this.addSchedule(schedule);
            }

            this.isInitialized = true;
            console.log(`ScheduleManager initialized with ${activeSchedules.length} active schedules`);
        } catch (error) {
            console.error('Failed to initialize schedules:', error);
            throw error;
        }
    }

    /**
     * Add a new schedule to the scheduler
     * @param schedule The schedule entity to add
     */
    async addSchedule(schedule: ScheduleTaskEntity): Promise<void> {
        if (!schedule.is_active || schedule.trigger_type !== TriggerType.CRON) {
            return;
        }

        // Remove existing job if it exists
        this.removeSchedule(schedule.id);

        try {
            // Create cron job
            const cronJob = new CronJob(schedule.cron_expression, async () => {
                await this.executeSchedule(schedule.id);
            }, null, false, 'UTC');

            // Start the job
            cronJob.start();
            this.cronJobs.set(schedule.id, cronJob);

            console.log(`Added schedule ${schedule.id} (${schedule.name}) with cron: ${schedule.cron_expression}`);
        } catch (error) {
            console.error(`Failed to add schedule ${schedule.id}:`, error);
            throw error;
        }
    }

    /**
     * Remove a schedule from the scheduler
     * @param scheduleId The schedule ID to remove
     */
    async removeSchedule(scheduleId: number): Promise<void> {
        const cronJob = this.cronJobs.get(scheduleId);
        if (cronJob) {
            cronJob.stop();
            this.cronJobs.delete(scheduleId);
            console.log(`Removed schedule ${scheduleId} from scheduler`);
        }
    }

    /**
     * Update an existing schedule
     * @param schedule The updated schedule entity
     */
    async updateSchedule(schedule: ScheduleTaskEntity): Promise<void> {
        // Remove existing job
        await this.removeSchedule(schedule.id);

        // Add updated job if active
        if (schedule.is_active && schedule.trigger_type === TriggerType.CRON) {
            await this.addSchedule(schedule);
        }
    }

    /**
     * Execute a schedule immediately
     * @param scheduleId The schedule ID to execute
     */
    async executeSchedule(scheduleId: number): Promise<void> {
        try {
            const schedule = await this.scheduleTaskModule.getScheduleById(scheduleId);
            if (!schedule) {
                throw new Error(`Schedule ${scheduleId} not found`);
            }

            if (!schedule.is_active) {
                console.log(`Schedule ${scheduleId} is not active, skipping execution`);
                return;
            }

            console.log(`Executing schedule ${scheduleId} (${schedule.name})`);

            // Log execution start
            const executionId = await this.scheduleExecutionLogModule.logExecution(
                scheduleId,
                ExecutionStatus.RUNNING,
                'Execution started',
                0,
                undefined,
                LogTriggerType.CRON
            );

            const startTime = Date.now();

            try {
                // Execute the task
                const taskOutputId = await this.taskExecutorModule.executeScheduledTask(schedule);

                // Calculate duration
                const duration = Date.now() - startTime;

                // Update execution log with success
                await this.scheduleExecutionLogModule.updateExecutionStatus(
                    executionId,
                    ExecutionStatus.SUCCESS,
                    'Task executed successfully',
                    duration
                );

                // Update schedule statistics
                await this.scheduleTaskModule.incrementExecutionCount(scheduleId, true);
                await this.scheduleTaskModule.updateLastRunTime(scheduleId, new Date());

                // Calculate and update next run time
                const nextRunTime = this.calculateNextRunTime(schedule.cron_expression);
                await this.scheduleTaskModule.updateNextRunTime(scheduleId, nextRunTime);

                console.log(`Schedule ${scheduleId} executed successfully in ${duration}ms`);

                // Handle dependent jobs
                await this.executeDependentJobs(executionId, ExecutionStatus.SUCCESS);

            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // Update execution log with failure
                await this.scheduleExecutionLogModule.updateExecutionStatus(
                    executionId,
                    ExecutionStatus.FAILED,
                    errorMessage,
                    duration
                );

                // Update schedule statistics
                await this.scheduleTaskModule.incrementExecutionCount(scheduleId, false);
                await this.scheduleTaskModule.updateLastErrorMessage(scheduleId, errorMessage);

                console.error(`Schedule ${scheduleId} execution failed:`, error);

                // Handle dependent jobs for failure
                await this.executeDependentJobs(executionId, ExecutionStatus.FAILED);
            }

        } catch (error) {
            console.error(`Failed to execute schedule ${scheduleId}:`, error);
            throw error;
        }
    }

    /**
     * Validate a cron expression
     * @param expression The cron expression to validate
     * @returns True if valid, false otherwise
     */
    validateCronExpression(expression: string): boolean {
        try {
            new CronJob(expression, () => {}, null, false);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Calculate the next run time for a cron expression
     * @param cronExpression The cron expression
     * @returns The next run time
     */
    calculateNextRunTime(cronExpression: string): Date {
        try {
            const cronJob = new CronJob(cronExpression, () => {}, null, false);
            const nextDate = cronJob.nextDate();
            return nextDate.toJSDate();
        } catch (error) {
            console.error('Failed to calculate next run time:', error);
            // Return a default time (1 hour from now) if calculation fails
            const defaultTime = new Date();
            defaultTime.setHours(defaultTime.getHours() + 1);
            return defaultTime;
        }
    }

    /**
     * Pause a schedule
     * @param scheduleId The schedule ID to pause
     */
    async pauseSchedule(scheduleId: number): Promise<void> {
        await this.scheduleTaskModule.pauseSchedule(scheduleId);
        await this.removeSchedule(scheduleId);
        console.log(`Schedule ${scheduleId} paused`);
    }

    /**
     * Resume a schedule
     * @param scheduleId The schedule ID to resume
     */
    async resumeSchedule(scheduleId: number): Promise<void> {
        await this.scheduleTaskModule.resumeSchedule(scheduleId);
        const schedule = await this.scheduleTaskModule.getScheduleById(scheduleId);
        if (schedule && schedule.is_active) {
            await this.addSchedule(schedule);
        }
        console.log(`Schedule ${scheduleId} resumed`);
    }

    /**
     * Add a dependency between schedules
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @param condition The dependency condition
     * @param delayMinutes Optional delay in minutes
     */
    async addDependency(
        parentId: number, 
        childId: number, 
        condition: DependencyCondition, 
        delayMinutes: number = 0
    ): Promise<void> {
        // Check for circular dependencies
        const hasCircular = await this.scheduleDependencyModule.checkCircularDependency(parentId, childId);
        if (hasCircular) {
            throw new Error('Circular dependency detected');
        }

        // Create the dependency
        await this.scheduleDependencyModule.createDependency(parentId, childId, condition, delayMinutes);
        console.log(`Added dependency: ${parentId} -> ${childId} (${condition})`);
    }

    /**
     * Remove a dependency between schedules
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     */
    async removeDependency(parentId: number, childId: number): Promise<void> {
        await this.scheduleDependencyModule.deleteDependencyByParentChild(parentId, childId);
        console.log(`Removed dependency: ${parentId} -> ${childId}`);
    }

    /**
     * Execute dependent jobs based on parent execution result
     * @param parentExecutionId The parent execution ID
     * @param parentStatus The parent execution status
     */
    async executeDependentJobs(parentExecutionId: number, parentStatus: ExecutionStatus): Promise<void> {
        try {
            // Get the parent execution to find the schedule
            const parentExecution = await this.scheduleExecutionLogModule.getExecutionById(parentExecutionId);
            if (!parentExecution) {
                return;
            }

            const parentScheduleId = parentExecution.schedule_id;

            // Get all dependencies for this parent
            const dependencies = await this.scheduleDependencyModule.getDependenciesByParent(parentScheduleId);

            for (const dependency of dependencies) {
                // Check if the dependency condition matches the parent status
                let shouldExecute = false;
                switch (dependency.dependency_condition) {
                    case DependencyCondition.ON_SUCCESS:
                        shouldExecute = parentStatus === ExecutionStatus.SUCCESS;
                        break;
                    case DependencyCondition.ON_COMPLETION:
                        shouldExecute = parentStatus === ExecutionStatus.SUCCESS || parentStatus === ExecutionStatus.FAILED;
                        break;
                    case DependencyCondition.ON_FAILURE:
                        shouldExecute = parentStatus === ExecutionStatus.FAILED;
                        break;
                }

                if (shouldExecute) {
                    // Add delay if specified
                    if (dependency.delay_minutes > 0) {
                        setTimeout(async () => {
                            await this.executeSchedule(dependency.child_schedule_id);
                        }, dependency.delay_minutes * 60 * 1000);
                    } else {
                        // Execute immediately
                        await this.executeSchedule(dependency.child_schedule_id);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to execute dependent jobs:', error);
        }
    }

    /**
     * Validate dependency chain for a schedule
     * @param scheduleId The schedule ID to validate
     * @returns True if valid, false otherwise
     */
    async validateDependencyChain(scheduleId: number): Promise<boolean> {
        try {
            const validation = await this.scheduleDependencyModule.validateDependencies(scheduleId);
            return validation.isValid;
        } catch (error) {
            console.error('Failed to validate dependency chain:', error);
            return false;
        }
    }

    /**
     * Get scheduler status
     * @returns Current scheduler status
     */
    getSchedulerStatus(): SchedulerStatus {
        const now = new Date();
        const nextCheck = new Date(now.getTime() + 60000); // 1 minute from now

        return {
            isRunning: this.isRunning,
            activeSchedules: this.cronJobs.size,
            totalSchedules: this.cronJobs.size, // This could be enhanced to get from database
            lastCheckTime: now,
            nextCheckTime: nextCheck
        };
    }

    /**
     * Start the scheduler
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        await this.initializeSchedules();
        this.isRunning = true;

        // Start periodic check for dependency-based schedules
        this.checkInterval = setInterval(async () => {
            await this.processDependencyQueue();
        }, 30000); // Check every 30 seconds

        // Persist running status to database
        await this.persistRunningStatus();

        console.log('ScheduleManager started');
    }

    /**
     * Stop the scheduler
     */
    async stop(): Promise<void> {
        this.isRunning = false;

        // Stop all cron jobs
        for (const [scheduleId, cronJob] of this.cronJobs) {
            cronJob.stop();
        }
        this.cronJobs.clear();

        // Clear check interval
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        // Persist stopped status to database
        await this.persistStoppedStatus();

        console.log('ScheduleManager stopped');
    }

    /**
     * Process dependency queue for non-cron triggered schedules
     */
    private async processDependencyQueue(): Promise<void> {
        try {
            // Get all dependency-based schedules that are ready to execute
            const dependencySchedules = await this.scheduleTaskModule.getSchedulesByTriggerType(TriggerType.DEPENDENCY);
            
            for (const schedule of dependencySchedules) {
                if (!schedule.is_active) continue;

                // Check if parent schedules have completed
                const parentSchedules = await this.scheduleDependencyModule.getParentSchedules(schedule.id);
                let allParentsCompleted = true;

                for (const parentId of parentSchedules) {
                    const parentSchedule = await this.scheduleTaskModule.getScheduleById(parentId);
                    if (parentSchedule && parentSchedule.status === ScheduleStatus.ACTIVE) {
                        allParentsCompleted = false;
                        break;
                    }
                }

                if (allParentsCompleted) {
                    await this.executeSchedule(schedule.id);
                }
            }
        } catch (error) {
            console.error('Failed to process dependency queue:', error);
        }
    }

    /**
     * Handle application shutdown
     */
    async handleAppShutdown(): Promise<void> {
        console.log('Shutting down ScheduleManager...');
        await this.persistStoppedStatus();
        await this.stop();
    }

    /**
     * Initialize scheduler with database status
     */
    async initializeWithDatabaseStatus(): Promise<void> {
        try {
            await this.schedulerStatusModel.initializeStatus();
            const shouldAutoStart = await this.schedulerStatusModel.shouldAutoStart();
            
            if (shouldAutoStart) {
                console.log('Auto-starting scheduler based on database status');
                await this.start();
            } else {
                console.log('Scheduler auto-start disabled based on database status');
            }
        } catch (error) {
            console.error('Failed to initialize with database status:', error);
            // Continue without auto-start if database operations fail
        }
    }

    /**
     * Persist running status to database
     */
    async persistRunningStatus(): Promise<void> {
        try {
            const status = this.getSchedulerStatus();
            await this.schedulerStatusModel.updateStatus({
                is_running: true,
                active_schedules: status.activeSchedules,
                total_schedules: status.totalSchedules,
                last_check_time: status.lastCheckTime,
                next_check_time: status.nextCheckTime,
                last_start_time: new Date(),
                last_error_message: undefined
            });
        } catch (error) {
            console.error('Failed to persist running status:', error);
        }
    }

    /**
     * Persist stopped status to database
     */
    async persistStoppedStatus(): Promise<void> {
        try {
            await this.schedulerStatusModel.updateStatus({
                is_running: false,
                last_stop_time: new Date(),
                last_error_message: undefined
            });
        } catch (error) {
            console.error('Failed to persist stopped status:', error);
        }
    }

    /**
     * Load status from database
     */
    async loadStatusFromDatabase(): Promise<void> {
        try {
            const status = await this.schedulerStatusModel.getStatus();
            if (status) {
                this.isRunning = status.is_running;
                console.log(`Loaded scheduler status from database: running=${this.isRunning}`);
            }
        } catch (error) {
            console.error('Failed to load status from database:', error);
        }
    }

    /**
     * Check if scheduler should auto-start
     */
    async shouldAutoStart(): Promise<boolean> {
        return await this.schedulerStatusModel.shouldAutoStart();
    }

    /**
     * Recover from database status
     */
    async recoverFromDatabase(): Promise<void> {
        try {
            await this.loadStatusFromDatabase();
            if (this.isRunning) {
                console.log('Recovering scheduler from database status');
                await this.start();
            }
        } catch (error) {
            console.error('Failed to recover from database:', error);
        }
    }

    /**
     * Validate database status consistency
     */
    async validateDatabaseStatus(): Promise<boolean> {
        try {
            const status = await this.schedulerStatusModel.getStatus();
            if (!status) {
                return false;
            }
            
            // Basic validation - could be enhanced
            return typeof status.is_running === 'boolean';
        } catch (error) {
            console.error('Failed to validate database status:', error);
            return false;
        }
    }

    /**
     * Reset database status
     */
    async resetDatabaseStatus(): Promise<void> {
        try {
            await this.schedulerStatusModel.resetStatus();
            console.log('Database status reset successfully');
        } catch (error) {
            console.error('Failed to reset database status:', error);
            throw error;
        }
    }
} 
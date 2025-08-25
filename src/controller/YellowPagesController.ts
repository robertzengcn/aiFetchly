import { YellowPagesModule } from "@/modules/YellowPagesModule";
import { YellowPagesTaskModule } from "@/modules/YellowPagesTaskModule";
import { YellowPagesResultModule } from "@/modules/YellowPagesResultModule";
import { YellowPagesPlatformModule } from "@/modules/YellowPagesPlatformModule";
import { YellowPagesProcessManager } from "@/modules/YellowPagesProcessManager";
import { BrowserManager } from "@/modules/browserManager";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";

import { 
    YellowPagesTaskData, 
    TaskStatus, 
    TaskProgress, 
    TaskFilters, 
    TaskSummary, 
    YellowPagesTask, 
    YellowPagesResult 
} from "@/interfaces/ITaskManager";
import { PlatformSummary } from "@/interfaces/IPlatformConfig";

/**
 * Yellow Pages Controller
 * 
 * Provides business logic for managing Yellow Pages scraping tasks.
 * This controller integrates with the existing aiFetchly infrastructure including:
 * - YellowPagesModule for core task management
 * - YellowPagesTaskModule for task database operations
 * - YellowPagesResultModule for result database operations
 * - YellowPagesPlatformModule for platform management
 * - YellowPagesProcessManager for multi-process operations
 * - BrowserManager for Puppeteer instance management
 * - AccountCookiesModule for authentication
 * - Database models for data persistence
 */
export class YellowPagesController {
    private yellowPagesModule: YellowPagesModule;
    private taskModule: YellowPagesTaskModule;
    private resultModule: YellowPagesResultModule;
    private platformModule: YellowPagesPlatformModule;
    private processManager: YellowPagesProcessManager;
    private browserManager: BrowserManager;
    private accountCookiesModule: AccountCookiesModule;

    constructor() {
        this.yellowPagesModule = new YellowPagesModule();
        this.taskModule = new YellowPagesTaskModule();
        this.resultModule = new YellowPagesResultModule();
        this.platformModule = new YellowPagesPlatformModule();
        this.processManager = new YellowPagesProcessManager();
        this.browserManager = new BrowserManager();
        this.accountCookiesModule = new AccountCookiesModule();
    }

    /**
     * Create a new Yellow Pages scraping task
     * @param taskData Task configuration data
     * @returns Promise resolving to the created task ID
     */
    async createTask(taskData: YellowPagesTaskData): Promise<number> {
        try {
            console.log('Creating Yellow Pages task:', taskData);

            // Validate task data
            await this.validateTaskData(taskData);

            // Validate platform exists and is active
            const platform = await this.platformModule.getPlatformByName(taskData.platform);
            if (!platform) {
                throw new Error(`Platform '${taskData.platform}' not found`);
            }
            if (!platform.is_active) {
                throw new Error(`Platform '${taskData.platform}' is not active`);
            }

            // Validate account if specified
            if (taskData.account_id) {
                const accountCookies = await this.accountCookiesModule.getAccountCookies(taskData.account_id);
                if (!accountCookies) {
                    console.warn(`Account ${taskData.account_id} not found, task will run without cookies`);
                }
            }

            // Create task using the task module
            const taskId = await this.taskModule.createTask(taskData);

            console.log(`Created Yellow Pages task with ID: ${taskId}`);
            return taskId;

        } catch (error) {
            console.error('Failed to create Yellow Pages task:', error);
            throw error;
        }
    }

    /**
     * Get all Yellow Pages tasks with optional filtering
     * @param filters Optional filters to apply
     * @returns Promise resolving to array of task summaries
     */
    async listTasks(filters?: TaskFilters): Promise<TaskSummary[]> {
        try {
            // Use the task module to list tasks
            const tasks = await this.taskModule.listTasks(0, 1000, filters);
            return tasks;
        } catch (error) {
            console.error('Failed to list Yellow Pages tasks:', error);
            throw error;
        }
    }

    /**
     * Get a specific Yellow Pages task by ID
     * @param taskId ID of the task
     * @returns Promise resolving to task details
     */
    async getTask(taskId: number): Promise<{
        task: YellowPagesTask;
        status: TaskStatus;
        progress: TaskProgress;
    }> {
        try {
            const status = await this.yellowPagesModule.getTaskStatus(taskId);
            const progress = await this.yellowPagesModule.getTaskProgress(taskId);
            
            // Get full task details from the task module
            const taskEntity = await this.taskModule.getTaskById(taskId);
            if (!taskEntity) {
                throw new Error(`Task ${taskId} not found`);
            }

            return {
                task: this.mapTaskToResponse(taskEntity),
                status,
                progress
            };
        } catch (error) {
            console.error(`Failed to get task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Update a specific Yellow Pages task
     * @param taskId ID of the task to update
     * @param updates Partial task data to update
     * @returns Promise that resolves when the task is updated
     */
    async updateTask(taskId: number, updates: Partial<YellowPagesTask>): Promise<void> {
        try {
            console.log(`Updating Yellow Pages task ${taskId}:`, updates);
            
            // Convert updates to entity format
            const entityUpdates = this.convertTaskUpdatesToEntity(updates);
            await this.taskModule.updateTask(taskId, entityUpdates);
            
            console.log(`Successfully updated Yellow Pages task ${taskId}`);
        } catch (error) {
            console.error(`Failed to update Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Delete a specific Yellow Pages task
     * @param taskId ID of the task to delete
     * @returns Promise that resolves when the task is deleted
     */
    async deleteTask(taskId: number): Promise<void> {
        try {
            console.log(`Deleting Yellow Pages task ${taskId}`);
            
            // Delete the task and its results
            await this.taskModule.deleteTask(taskId);
            await this.resultModule.deleteResultsByTaskId(taskId);
            
            console.log(`Successfully deleted Yellow Pages task ${taskId}`);
        } catch (error) {
            console.error(`Failed to delete Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Start a specific Yellow Pages task
     * @param taskId ID of the task to start
     * @returns Promise that resolves when the task starts
     */
    async startTask(taskId: number): Promise<void> {
        try {
            console.log(`Starting Yellow Pages task ${taskId}`);
            
            // Update task status to running
            await this.taskModule.updateTaskStatus(taskId, TaskStatus.InProgress);
            
            // Start the task using the main module
            await this.yellowPagesModule.startTask(taskId);
            
            console.log(`Successfully started Yellow Pages task ${taskId}`);
        } catch (error) {
            console.error(`Failed to start Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Stop a specific Yellow Pages task
     * @param taskId ID of the task to stop
     * @returns Promise that resolves when the task stops
     */
    async stopTask(taskId: number): Promise<void> {
        try {
            console.log(`Stopping Yellow Pages task ${taskId}`);
            
            // Update task status to stopped
            await this.taskModule.updateTaskStatus(taskId, TaskStatus.Pending);
            
            // Stop the task using the main module
            await this.yellowPagesModule.stopTask(taskId);
            
            console.log(`Successfully stopped Yellow Pages task ${taskId}`);
        } catch (error) {
            console.error(`Failed to stop Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Pause a specific Yellow Pages task
     * @param taskId ID of the task to pause
     * @returns Promise that resolves when the task is paused
     */
    async pauseTask(taskId: number): Promise<void> {
        try {
            console.log(`Pausing Yellow Pages task ${taskId}`);
            
            // Update task status to paused
            await this.taskModule.updateTaskStatus(taskId, TaskStatus.Paused);
            
            // Pause the task using the main module
            await this.yellowPagesModule.pauseTask(taskId);
            
            console.log(`Successfully paused Yellow Pages task ${taskId}`);
        } catch (error) {
            console.error(`Failed to pause Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Resume a specific Yellow Pages task
     * @param taskId ID of the task to resume
     * @returns Promise that resolves when the task resumes
     */
    async resumeTask(taskId: number): Promise<void> {
        try {
            console.log(`Resuming Yellow Pages task ${taskId}`);
            
            // Update task status to running
            await this.taskModule.updateTaskStatus(taskId, TaskStatus.InProgress);
            
            // Resume the task using the main module
            await this.yellowPagesModule.resumeTask(taskId);
            
            console.log(`Successfully resumed Yellow Pages task ${taskId}`);
        } catch (error) {
            console.error(`Failed to resume Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Kill a child process by PID
     * @param pid The process ID to kill
     * @returns Promise that resolves when the process is killed
     */
    async killProcessByPID(pid: number): Promise<{
        success: boolean;
        taskId?: number;
        message: string;
    }> {
        try {
            console.log(`Killing process with PID ${pid}`);
            
            // Use the process manager to terminate the process by PID
            const success = await this.processManager.terminateProcessByPID(pid);
            
            if (success) {
                // Find the task associated with this PID
                const task = await this.processManager.getTaskByPID(pid);
                const taskId = task?.id;
                
                console.log(`Successfully killed process ${pid} for task ${taskId}`);
                
                // Update task status to reflect that it's no longer running
                if (taskId) {
                    try {
                        await this.taskModule.updateTaskStatus(taskId, TaskStatus.Pending);
                        console.log(`Updated task ${taskId} status to Pending after killing process`);
                    } catch (statusUpdateError) {
                        console.warn(`Failed to update task ${taskId} status:`, statusUpdateError);
                        // Don't fail the entire operation if status update fails
                    }
                }
                
                return {
                    success: true,
                    taskId,
                    message: `Process ${pid} killed successfully and task status updated`
                };
            } else {
                return {
                    success: false,
                    message: `Failed to kill process ${pid}`
                };
            }
        } catch (error) {
            console.error(`Failed to kill process ${pid}:`, error);
            throw error;
        }
    }

    /**
     * Get process status by PID
     * @param pid The process ID to check
     * @returns Promise that resolves to process status information
     */
    async getProcessStatusByPID(pid: number): Promise<{
        isRunning: boolean;
        taskId?: number;
        status?: string;
        error?: string;
    }> {
        try {
            console.log(`Getting status for process with PID ${pid}`);
            
            // Use the process manager to check process status by PID
            const status = await this.processManager.checkProcessStatusByPID(pid);
            
            console.log(`Process ${pid} status:`, status);
            return status;
        } catch (error) {
            console.error(`Failed to get status for process ${pid}:`, error);
            throw error;
        }
    }

    /**
     * Get task progress
     * @param taskId ID of the task
     * @returns Promise resolving to task progress
     */
    async getTaskProgress(taskId: number): Promise<TaskProgress> {
        try {
            const progress = await this.yellowPagesModule.getTaskProgress(taskId);
            return progress;
        } catch (error) {
            console.error(`Failed to get progress for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Get task results
     * @param taskId ID of the task
     * @returns Promise resolving to array of task results
     */
    async getTaskResults(taskId: number): Promise<YellowPagesResult[]> {
        try {
            // Use the result module to get results
            const results = await this.resultModule.getResultsByTaskId(taskId);
            return results;
        } catch (error) {
            console.error(`Failed to get results for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Export task results
     * @param taskId ID of the task
     * @param format Export format ('json' or 'csv')
     * @returns Promise resolving to exported data
     */
    async exportTaskResults(taskId: number, format: 'json' | 'csv' = 'json'): Promise<any> {
        try {
            // Use the result module to export results
            const exportData = await this.resultModule.exportResults(taskId, format);
            return exportData;
        } catch (error) {
            console.error(`Failed to export results for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Bulk operations on tasks
     * @param operation Operation to perform
     * @param taskIds Array of task IDs
     * @returns Promise resolving to operation results
     */
    async bulkOperations(operation: 'start' | 'stop' | 'pause' | 'delete', taskIds: number[]): Promise<{
        operation: string;
        total: number;
        successful: number;
        failed: number;
        results: Array<{ taskId: number; success: boolean; message?: string }>;
    }> {
        try {
            const results: Array<{ taskId: number; success: boolean; message?: string }> = [];

            for (const taskId of taskIds) {
                try {
                    switch (operation) {
                        case 'start':
                            await this.startTask(taskId);
                            results.push({ taskId, success: true });
                            break;
                        case 'stop':
                            await this.stopTask(taskId);
                            results.push({ taskId, success: true });
                            break;
                        case 'pause':
                            await this.pauseTask(taskId);
                            results.push({ taskId, success: true });
                            break;
                        case 'delete':
                            await this.deleteTask(taskId);
                            results.push({ taskId, success: true });
                            break;
                    }
                } catch (error) {
                    results.push({ 
                        taskId, 
                        success: false, 
                        message: error instanceof Error ? error.message : 'Unknown error' 
                    });
                }
            }

            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;

            return {
                operation,
                total: taskIds.length,
                successful,
                failed,
                results
            };
        } catch (error) {
            console.error('Failed to perform bulk operations:', error);
            throw error;
        }
    }

    /**
     * Get system health status
     * @returns Promise resolving to health status information
     */
    async getHealthStatus(): Promise<{
        totalTasks: number;
        activeTasks: number;
        completedTasks: number;
        failedTasks: number;
        processHealth: any;
    }> {
        try {
            const healthStatus = await this.yellowPagesModule.getHealthStatus();
            return healthStatus;
        } catch (error) {
            console.error('Failed to get health status:', error);
            throw error;
        }
    }

    /**
     * Get available platforms
     * @returns Promise resolving to array of available platform summaries
     */
    async getAvailablePlatforms(): Promise<PlatformSummary[]> {
        try {
            const platforms = await this.platformModule.getAllPlatforms();
            return platforms.map(p => ({
                id: p.id,
                name: p.name,
                display_name: p.display_name,
                country: p.country,
                language: p.language,
                rate_limit: p.rate_limit,
                is_active: p.is_active,
                authentication: p.settings?.authentication ? {
                    requiresAuthentication: p.settings.requiresAuthentication,
                    requiresCookies: p.settings.authentication.requiresCookies,
                    requiresLogin: p.settings.authentication.requiresLogin,
                    requiresApiKey: p.settings.authentication.requiresApiKey,
                    requiresOAuth: p.settings.authentication.requiresOAuth,
                    type: p.settings.authentication.type
                } : undefined
            }));
        } catch (error) {
            console.error('Failed to get available platforms:', error);
            throw error;
        }
    }

    /**
     * Get task statistics
     * @returns Promise resolving to task statistics
     */
    async getTaskStatistics(): Promise<{
        totalTasks: number;
        tasksByStatus: Record<string, number>;
        tasksByPlatform: Record<string, number>;
        recentActivity: any[];
    }> {
        try {
            // Use the task module to get statistics
            const stats = await this.taskModule.getTaskStatistics();
            
            // Get tasks by platform
            const allTasks = await this.listTasks();
            const tasksByPlatform: Record<string, number> = {};
            allTasks.forEach(task => {
                const platform = task.platform;
                tasksByPlatform[platform] = (tasksByPlatform[platform] || 0) + 1;
            });

            // Get recent activity
            const recentTasks = await this.taskModule.getRecentTasks(10);
            const recentActivity = recentTasks.map(task => this.mapTaskToResponse(task));

            return {
                totalTasks: stats.total,
                tasksByStatus: {
                    pending: stats.pending,
                    running: stats.running,
                    completed: stats.completed,
                    failed: stats.failed,
                    paused: stats.paused
                },
                tasksByPlatform,
                recentActivity
            };
        } catch (error) {
            console.error('Failed to get task statistics:', error);
            throw error;
        }
    }

    /**
     * Validate task data before creation
     * @param taskData Task data to validate
     * @throws Error if validation fails
     */
    private async validateTaskData(taskData: YellowPagesTaskData): Promise<void> {
        if (!taskData.name || taskData.name.trim().length === 0) {
            throw new Error('Task name is required');
        }

        if (!taskData.platform || taskData.platform.trim().length === 0) {
            throw new Error('Platform is required');
        }

        if (!taskData.keywords || taskData.keywords.length === 0) {
            throw new Error('At least one keyword is required');
        }



        if (taskData.max_pages && taskData.max_pages < 1) {
            throw new Error('Max pages must be at least 1');
        }

        if (taskData.concurrency && taskData.concurrency < 1) {
            throw new Error('Concurrency must be at least 1');
        }

        if (taskData.delay_between_requests && taskData.delay_between_requests < 0) {
            throw new Error('Delay between requests cannot be negative');
        }

        // Validate headless parameter if provided
        if (taskData.headless !== undefined && typeof taskData.headless !== 'boolean') {
            throw new Error('Headless parameter must be a boolean value');
        }

        // Check if platform requires cookies and account is provided
        const platform = await this.platformModule.getPlatformByName(taskData.platform);
        if (platform && platform.settings?.authentication?.requiresCookies && !taskData.account_id) {
            throw new Error(`Platform '${platform.display_name}' requires cookies for authentication. Please select an account.`);
        }
    }

    /**
     * Map task entity to response format
     * @param task The task entity
     * @returns Mapped task object
     */
    private mapTaskToResponse(task: any): YellowPagesTask {
        return {
            id: task.id,
            name: task.name,
            platform: task.platform,
            keywords: task.keywords ? JSON.parse(task.keywords) : [],
            location: task.location,
            max_pages: task.max_pages,
            concurrency: task.concurrency,
            status: task.status as TaskStatus,
            created_at: task.created_at || new Date(),
            updated_at: task.updated_at || new Date(),
            scheduled_at: task.scheduled_at,
            completed_at: task.completed_at,
            error_log: task.error_log,
            run_log: task.run_log,
            account_id: task.account_id,
            proxy_config: task.proxy_config ? JSON.parse(task.proxy_config) : undefined,
            delay_between_requests: task.delay_between_requests,
            headless: task.headless !== undefined ? task.headless : true
        };
    }

    /**
     * Convert task updates to entity format
     * @param updates The task updates
     * @returns Entity format updates
     */
    private convertTaskUpdatesToEntity(updates: Partial<YellowPagesTask>): any {
        const entityUpdates: any = {};

        if (updates.name !== undefined) entityUpdates.name = updates.name;
        if (updates.platform !== undefined) entityUpdates.platform = updates.platform;
        if (updates.keywords !== undefined) entityUpdates.keywords = JSON.stringify(updates.keywords);
        if (updates.location !== undefined) entityUpdates.location = updates.location;
        if (updates.max_pages !== undefined) entityUpdates.max_pages = updates.max_pages;
        if (updates.concurrency !== undefined) entityUpdates.concurrency = updates.concurrency;
        if (updates.status !== undefined) entityUpdates.status = updates.status;
        if (updates.delay_between_requests !== undefined) entityUpdates.delay_between_requests = updates.delay_between_requests;
        if (updates.account_id !== undefined) entityUpdates.account_id = updates.account_id;
        if (updates.proxy_config !== undefined) entityUpdates.proxy_config = updates.proxy_config ? JSON.stringify(updates.proxy_config) : null;
        if (updates.headless !== undefined) entityUpdates.headless = updates.headless;
        if (updates.scheduled_at !== undefined) entityUpdates.scheduled_at = updates.scheduled_at;
        if (updates.completed_at !== undefined) entityUpdates.completed_at = updates.completed_at;
        if (updates.error_log !== undefined) entityUpdates.error_log = updates.error_log;
        if (updates.run_log !== undefined) entityUpdates.run_log = updates.run_log;

        // Always update the updated_at timestamp
        entityUpdates.updated_at = new Date();

        return entityUpdates;
    }
}

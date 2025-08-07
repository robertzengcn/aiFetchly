import { BaseModule } from "@/modules/baseModule";
import { ITaskManager, YellowPagesTaskData, TaskStatus, TaskProgress, TaskFilters, TaskSummary, YellowPagesTask, YellowPagesResult } from "@/interfaces/ITaskManager";
import { YellowPagesTaskModel } from "@/model/YellowPagesTask.model";
import { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import { YellowPagesProcessManager } from "@/modules/YellowPagesProcessManager";
import { BrowserManager } from "@/modules/browserManager";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { YellowPagesPlatformModel } from "@/model/YellowPagesPlatform.model";

/**
 * Main Yellow Pages Module that implements ITaskManager interface
 * 
 * This module serves as the primary interface for managing Yellow Pages scraping tasks.
 * It integrates with the existing aiFetchly infrastructure including:
 * - BackgroundScheduler for cron-based scheduling
 * - AccountCookiesModule for authentication
 * - BrowserManager for Puppeteer instance management
 * - Multi-process architecture for task isolation
 * 
 * @implements ITaskManager
 * @extends BaseModule
 */
export class YellowPagesModule extends BaseModule implements ITaskManager {
    private taskModel: YellowPagesTaskModel;
    private resultModel: YellowPagesResultModel;
    private processManager: YellowPagesProcessManager;
    private browserManager: BrowserManager;
    private accountCookiesModule: AccountCookiesModule;
    private platformModel: YellowPagesPlatformModel;

    constructor() {
        super();
        this.taskModel = new YellowPagesTaskModel(this.dbpath);
        this.resultModel = new YellowPagesResultModel(this.dbpath);
        this.processManager = new YellowPagesProcessManager();
        this.browserManager = new BrowserManager();
        this.accountCookiesModule = new AccountCookiesModule();
        this.platformModel = new YellowPagesPlatformModel(this.dbpath);
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
            this.validateTaskData(taskData);

            // Validate platform exists and is active
            const platform = await this.platformModel.getPlatformByName(taskData.platform);
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

            // Create task in database
            const taskId = await this.taskModel.saveYellowPagesTask({
                name: taskData.name,
                platform: taskData.platform,
                keywords: JSON.stringify(taskData.keywords),
                location: taskData.location,
                max_pages: taskData.max_pages || 1,
                concurrency: taskData.concurrency || 1,
                status: TaskStatus.Pending,
                account_id: taskData.account_id,
                proxy_config: taskData.proxy_config ? JSON.stringify(taskData.proxy_config) : undefined,
                delay_between_requests: taskData.delay_between_requests || 2000,
                scheduled_at: taskData.scheduled_at,
                created_at: new Date(),
                updated_at: new Date()
            });

            console.log(`Created Yellow Pages task with ID: ${taskId}`);
            return taskId;

        } catch (error) {
            console.error('Failed to create Yellow Pages task:', error);
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

            // Update task status to in-progress
            await this.taskModel.updateTaskStatus(taskId, TaskStatus.InProgress);

            // Spawn child process for scraping
            await this.processManager.spawnScraperProcess(taskId);

            console.log(`Successfully started Yellow Pages task ${taskId}`);

        } catch (error) {
            console.error(`Failed to start Yellow Pages task ${taskId}:`, error);
            
            // Update task status to failed
            await this.taskModel.updateTaskStatus(taskId, TaskStatus.Failed);
            await this.taskModel.updateTaskErrorLog(taskId, error.message);
            
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

            // Terminate the child process
            await this.processManager.terminateProcess(taskId);

            // Update task status
            await this.taskModel.updateTaskStatus(taskId, TaskStatus.Paused);

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

            // Terminate the process and update status
            await this.processManager.terminateProcess(taskId);
            await this.taskModel.updateTaskStatus(taskId, TaskStatus.Paused);

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

            // Check if task is in paused state
            const task = await this.taskModel.getYellowPagesTask(taskId);
            if (!task) {
                throw new Error(`Task ${taskId} not found`);
            }

            if (task.status !== TaskStatus.Paused) {
                throw new Error(`Task ${taskId} is not in paused state`);
            }

            // Start the task again
            await this.startTask(taskId);

            console.log(`Successfully resumed Yellow Pages task ${taskId}`);

        } catch (error) {
            console.error(`Failed to resume Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Get the current status of a Yellow Pages task
     * @param taskId ID of the task
     * @returns Promise resolving to the task status
     */
    async getTaskStatus(taskId: number): Promise<TaskStatus> {
        try {
            const task = await this.taskModel.getYellowPagesTask(taskId);
            if (!task) {
                throw new Error(`Task ${taskId} not found`);
            }

            return task.status as TaskStatus;

        } catch (error) {
            console.error(`Failed to get status for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Get the current progress of a Yellow Pages task
     * @param taskId ID of the task
     * @returns Promise resolving to the task progress
     */
    async getTaskProgress(taskId: number): Promise<TaskProgress> {
        try {
            const task = await this.taskModel.getYellowPagesTask(taskId);
            if (!task) {
                throw new Error(`Task ${taskId} not found`);
            }

            // Get process info if available
            const processInfo = this.processManager.getProcessInfo(taskId);
            const resultsCount = await this.resultModel.getResultCount(taskId);

            const progress: TaskProgress = {
                taskId: taskId,
                status: task.status as TaskStatus,
                currentPage: processInfo?.progress?.currentPage || 0,
                totalPages: task.max_pages,
                resultsCount: resultsCount,
                percentage: processInfo?.progress?.percentage || 0,
                estimatedTimeRemaining: processInfo?.progress?.estimatedTimeRemaining,
                startTime: processInfo?.startTime,
                lastUpdateTime: task.updated_at,
                errorMessage: task.error_log || undefined
            };

            return progress;

        } catch (error) {
            console.error(`Failed to get progress for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Get results for a specific Yellow Pages task
     * @param taskId ID of the task
     * @returns Promise resolving to array of task results
     */
    async getTaskResults(taskId: number): Promise<YellowPagesResult[]> {
        try {
            const results = await this.resultModel.getResultsByTaskId(taskId);
            
            // Convert to interface format
            return results.map(result => ({
                id: result.id,
                task_id: result.task_id,
                business_name: result.business_name,
                email: result.email || undefined,
                phone: result.phone || undefined,
                website: result.website || undefined,
                address: {
                    street: result.address_street || undefined,
                    city: result.address_city || undefined,
                    state: result.address_state || undefined,
                    zip: result.address_zip || undefined,
                    country: result.address_country || undefined
                },
                social_media: result.social_media ? JSON.parse(result.social_media) : undefined,
                categories: result.categories ? JSON.parse(result.categories) : undefined,
                business_hours: result.business_hours ? JSON.parse(result.business_hours) : undefined,
                description: result.description || undefined,
                rating: result.rating || undefined,
                review_count: result.review_count || undefined,
                scraped_at: result.scraped_at,
                platform: result.platform,
                raw_data: result.raw_data ? JSON.parse(result.raw_data) : undefined,
                fax_number: result.fax_number || undefined,
                contact_person: result.contact_person || undefined,
                year_established: result.year_established || undefined,
                number_of_employees: result.number_of_employees || undefined,
                payment_methods: result.payment_methods ? JSON.parse(result.payment_methods) : undefined,
                specialties: result.specialties ? JSON.parse(result.specialties) : undefined
            }));

        } catch (error) {
            console.error(`Failed to get results for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * List all Yellow Pages tasks with optional filtering
     * @param filters Optional filters to apply
     * @returns Promise resolving to array of task summaries
     */
    async listTasks(filters?: TaskFilters): Promise<TaskSummary[]> {
        try {
            const tasks = await this.taskModel.getYellowPagesTaskList(
                filters?.offset || 0,
                filters?.limit || 50,
                filters?.status,
                filters?.platform,
                filters?.createdAfter,
                filters?.createdBefore
            );

            const summaries: TaskSummary[] = [];
            
            for (const task of tasks) {
                const resultsCount = await this.resultModel.getResultCount(task.id);
                const processInfo = this.processManager.getProcessInfo(task.id);
                
                summaries.push({
                    id: task.id,
                    name: task.name,
                    platform: task.platform,
                    status: task.status as TaskStatus,
                    created_at: task.created_at,
                    completed_at: task.completed_at || undefined,
                    results_count: resultsCount,
                    progress_percentage: processInfo?.progress?.percentage || 0
                });
            }

            return summaries;

        } catch (error) {
            console.error('Failed to list Yellow Pages tasks:', error);
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

            const updateData: any = {
                ...updates,
                updated_at: new Date()
            };

            // Convert arrays to JSON strings if needed
            if (updates.keywords) {
                updateData.keywords = JSON.stringify(updates.keywords);
            }
            if (updates.proxy_config) {
                updateData.proxy_config = JSON.stringify(updates.proxy_config);
            }

            await this.taskModel.updateYellowPagesTask(taskId, updateData);

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

            // Stop the task if it's running
            if (this.processManager.isProcessRunning(taskId)) {
                await this.stopTask(taskId);
            }

            // Delete results first (foreign key constraint)
            await this.resultModel.deleteResultsByTaskId(taskId);

            // Delete the task
            await this.taskModel.deleteYellowPagesTask(taskId);

            console.log(`Successfully deleted Yellow Pages task ${taskId}`);

        } catch (error) {
            console.error(`Failed to delete Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Get browser manager instance
     * @returns BrowserManager instance
     */
    getBrowserManager(): BrowserManager {
        return this.browserManager;
    }

    /**
     * Get account cookies module instance
     * @returns AccountCookiesModule instance
     */
    getAccountCookiesModule(): AccountCookiesModule {
        return this.accountCookiesModule;
    }

    /**
     * Get process manager instance
     * @returns YellowPagesProcessManager instance
     */
    getProcessManager(): YellowPagesProcessManager {
        return this.processManager;
    }

    /**
     * Get system health status
     * @returns Health status information
     */
    async getHealthStatus(): Promise<{
        totalTasks: number;
        activeTasks: number;
        completedTasks: number;
        failedTasks: number;
        processHealth: any;
    }> {
        try {
            const allTasks = await this.listTasks();
            const processHealth = await this.processManager.healthCheck();

            const totalTasks = allTasks.length;
            const activeTasks = allTasks.filter(t => t.status === TaskStatus.InProgress).length;
            const completedTasks = allTasks.filter(t => t.status === TaskStatus.Completed).length;
            const failedTasks = allTasks.filter(t => t.status === TaskStatus.Failed).length;

            return {
                totalTasks,
                activeTasks,
                completedTasks,
                failedTasks,
                processHealth
            };

        } catch (error) {
            console.error('Failed to get health status:', error);
            throw error;
        }
    }

    /**
     * Validate task data before creation
     * @param taskData Task data to validate
     * @throws Error if validation fails
     */
    private validateTaskData(taskData: YellowPagesTaskData): void {
        if (!taskData.name || taskData.name.trim().length === 0) {
            throw new Error('Task name is required');
        }

        if (!taskData.platform || taskData.platform.trim().length === 0) {
            throw new Error('Platform is required');
        }

        if (!taskData.keywords || taskData.keywords.length === 0) {
            throw new Error('At least one keyword is required');
        }

        if (!taskData.location || taskData.location.trim().length === 0) {
            throw new Error('Location is required');
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
    }
}
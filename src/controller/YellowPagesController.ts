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
    YellowPagesResult,
    PaginationParams,
    PaginatedResponse
} from "@/interfaces/ITaskManager";
import { PlatformSummary } from "@/interfaces/IPlatformConfig";
import { 
    MCPRequest, 
    MCPResponse, 
    MCPYellowPagesRequest, 
    MCPYellowPagesData, 
    MCPBusinessListing,
    MCPTaskCreateRequest,
    MCPTaskUpdateRequest,
    MCPTask,
    MCPTaskListData,
    MCPPaginationParams,
    createMCPSuccessResponse,
    createMCPErrorResponse,
    createMCPError,
    MCPErrorCode
} from '@/mcp-server/types/mcpTypes';

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
 * 
 * Implemented as a Singleton to ensure:
 * - Single instance across the application
 * - Shared state for browser instances and process management
 * - Consistent resource allocation
 * - Centralized control over Yellow Pages operations
 */
export class YellowPagesController {
    private static instance: YellowPagesController | null = null;
    
    private yellowPagesModule: YellowPagesModule;
    private taskModule: YellowPagesTaskModule;
    private resultModule: YellowPagesResultModule;
    private platformModule: YellowPagesPlatformModule;
    private processManager: YellowPagesProcessManager;
    private browserManager: BrowserManager;
    private accountCookiesModule: AccountCookiesModule;

    /**
     * Private constructor to prevent direct instantiation
     * Use getInstance() method to access the singleton instance
     */
    private constructor() {
        this.yellowPagesModule = new YellowPagesModule();
        this.taskModule = new YellowPagesTaskModule();
        this.resultModule = new YellowPagesResultModule();
        this.platformModule = new YellowPagesPlatformModule();
        this.processManager = YellowPagesProcessManager.getInstance();
        //this.browserManager = new BrowserManager();
        this.accountCookiesModule = new AccountCookiesModule();
    }

    /**
     * Get the singleton instance of YellowPagesController
     * Creates a new instance if one doesn't exist
     * @returns The singleton instance of YellowPagesController
     */
    public static getInstance(): YellowPagesController {
        if (YellowPagesController.instance === null) {
            YellowPagesController.instance = new YellowPagesController();
        }
        return YellowPagesController.instance;
    }

    /**
     * Reset the singleton instance (useful for testing or cleanup)
     * @private - Use with caution, mainly for testing purposes
     */
    public static resetInstance(): void {
        YellowPagesController.instance = null;
    }

    /**
     * Check if a singleton instance exists
     * @returns true if an instance exists, false otherwise
     */
    public static hasInstance(): boolean {
        return YellowPagesController.instance !== null;
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
            
            
            // Resume the task using the main module
            await this.yellowPagesModule.resumeTask(taskId);
            
               // Update task status to running
               await this.taskModule.updateTaskStatus(taskId, TaskStatus.InProgress);
         
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
     * Get task results with pagination
     * @param taskId ID of the task
     * @param pagination Pagination parameters
     * @returns Promise resolving to paginated task results
     */
    async getTaskResults(taskId: number, pagination?: PaginationParams): Promise<PaginatedResponse<YellowPagesResult>> {
        try {
            // Use the result module to get paginated results
            const page = pagination?.page || 0;
            const size = pagination?.size || 20;
            
            // Get total count first
            const total = await this.resultModule.getResultsCountByTaskId(taskId);
            
            // Get paginated results
            const results = await this.resultModule.getResultsByTaskId(taskId, page, size);
            
            const totalPages = Math.ceil(total / size);
            
            return {
                data: results,
                pagination: {
                    page,
                    size,
                    total,
                    totalPages,
                    hasNext: page < totalPages - 1,
                    hasPrev: page > 0
                }
            };
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
                locationRequired: p.locationRequired,
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

    /**
     * Check for orphaned processes on application startup
     * This method should be called when the application starts to identify
     * tasks that were running before a restart/crash and mark them as failed
     * @returns Promise resolving to orphaned process check results
     */
    async checkForOrphanedProcesses(): Promise<{
        totalChecked: number;
        orphanedFound: number;
        failedUpdates: number;
    }> {
        try {
            console.log('YellowPagesController: Checking for orphaned processes...');
            const result = await this.processManager.checkForOrphanedProcesses();
            console.log('YellowPagesController: Orphaned process check completed:', result);
            return result;
        } catch (error) {
            console.error('YellowPagesController: Failed to check for orphaned processes:', error);
            throw error;
        }
    }

    /**
     * Handle tasks that were running before application restart
     * This method should be called on application startup to identify
     * and mark tasks that were in progress but are no longer running
     * @returns Promise resolving to the number of tasks marked as failed
     */
    async handleTasksFromPreviousSession(): Promise<number> {
        try {
            console.log('YellowPagesController: Handling tasks from previous session...');
            const failedCount = await this.taskModule.handleTasksFromPreviousSession();
            console.log(`YellowPagesController: Successfully handled ${failedCount} tasks from previous session`);
            return failedCount;
        } catch (error) {
            console.error('YellowPagesController: Failed to handle tasks from previous session:', error);
            throw error;
        }
    }

    /**
     * Handle MCP requests for Yellow Pages functionality
     * This method acts as an adapter between MCP requests and the existing Yellow Pages business logic
     */
    public async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            const { tool, parameters } = request;

            switch (tool) {
                case 'scrape_yellow_pages':
                    return await this.handleScrapeYellowPagesRequest(parameters as MCPYellowPagesRequest);
                
                case 'create_yellow_pages_task':
                    return await this.handleCreateYellowPagesTaskRequest(parameters as MCPTaskCreateRequest);
                
                case 'list_yellow_pages_tasks':
                    return await this.handleListYellowPagesTasksRequest(parameters as MCPPaginationParams);
                
                case 'get_yellow_pages_task':
                    return await this.handleGetYellowPagesTaskRequest(parameters.taskId as number);
                
                case 'update_yellow_pages_task':
                    return await this.handleUpdateYellowPagesTaskRequest(parameters as MCPTaskUpdateRequest);
                
                case 'delete_yellow_pages_task':
                    return await this.handleDeleteYellowPagesTaskRequest(parameters.taskId as number);
                
                case 'start_yellow_pages_task':
                    return await this.handleStartYellowPagesTaskRequest(parameters.taskId as number);
                
                case 'stop_yellow_pages_task':
                    return await this.handleStopYellowPagesTaskRequest(parameters.taskId as number);
                
                case 'pause_yellow_pages_task':
                    return await this.handlePauseYellowPagesTaskRequest(parameters.taskId as number);
                
                case 'resume_yellow_pages_task':
                    return await this.handleResumeYellowPagesTaskRequest(parameters.taskId as number);
                
                case 'get_yellow_pages_task_progress':
                    return await this.handleGetTaskProgressRequest(parameters.taskId as number);
                
                case 'get_yellow_pages_task_results':
                    return await this.handleGetTaskResultsRequest(parameters as { taskId: number } & MCPPaginationParams);
                
                case 'export_yellow_pages_results':
                    return await this.handleExportTaskResultsRequest(parameters as { taskId: number; format?: 'json' | 'csv' });
                
                case 'get_yellow_pages_platforms':
                    return await this.handleGetAvailablePlatformsRequest();
                
                case 'get_yellow_pages_health_status':
                    return await this.handleGetHealthStatusRequest();
                
                case 'get_yellow_pages_statistics':
                    return await this.handleGetTaskStatisticsRequest();
                
                case 'bulk_yellow_pages_operations':
                    return await this.handleBulkOperationsRequest(parameters as { operation: string; taskIds: number[] });
                
                default:
                    return createMCPErrorResponse(
                        createMCPError(MCPErrorCode.INVALID_PARAMETERS, `Unknown Yellow Pages tool: ${tool}`),
                        'Invalid Yellow Pages tool requested'
                    );
            }
        } catch (error) {
            console.error('Error in YellowPagesController.handleMCPRequest:', error);
            return createMCPErrorResponse(
                createMCPError(
                    MCPErrorCode.INTERNAL_ERROR,
                    'Internal error occurred while processing Yellow Pages request',
                    error instanceof Error ? error.message : String(error),
                    error instanceof Error ? error.stack : undefined
                ),
                'Failed to process Yellow Pages request'
            );
        }
    }

    /**
     * Handle scrape Yellow Pages requests
     */
    private async handleScrapeYellowPagesRequest(params: MCPYellowPagesRequest): Promise<MCPResponse<MCPYellowPagesData>> {
        try {
            // Convert MCP parameters to internal format
            const taskData: YellowPagesTaskData = {
                name: `Yellow Pages Search: ${params.query}`,
                platform: params.platform,
                keywords: [params.query],
                location: params.location,
                max_pages: params.maxResults || 10,
                concurrency: 1, // Default concurrency
                headless: true // Default to headless
            };

            // Create and start the task
            const taskId = await this.createTask(taskData);
            await this.startTask(taskId);

            // Wait a bit for results to start coming in (this is a simplified approach)
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Get the results
            const results = await this.getTaskResults(taskId, { page: 1, size: params.maxResults || 10 });

            // Convert to MCP format
            const businessListings: MCPBusinessListing[] = results.data.map(result => ({
                name: result.business_name || '',
                address: typeof result.address === 'string' ? result.address : 
                    result.address ? `${result.address.street || ''} ${result.address.city || ''} ${result.address.state || ''} ${result.address.zip || ''}`.trim() : '',
                phone: result.phone,
                website: result.website,
                email: result.email,
                rating: result.rating,
                reviewCount: result.review_count,
                categories: result.categories || [],
                hours: result.business_hours as Record<string, string> | undefined,
                coordinates: undefined, // Not available in YellowPagesResult
                platform: params.platform,
                listingUrl: '' // Not available in YellowPagesResult
            }));

            const yellowPagesData: MCPYellowPagesData = {
                businesses: businessListings,
                totalFound: results.pagination.total,
                platform: params.platform,
                location: params.location,
                searchQuery: params.query,
                processingTime: 0 // This would need to be tracked
            };

            return createMCPSuccessResponse(yellowPagesData, 'Yellow Pages scraping completed successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle create Yellow Pages task requests
     */
    private async handleCreateYellowPagesTaskRequest(params: MCPTaskCreateRequest): Promise<MCPResponse<MCPTask>> {
        try {
            // Convert MCP task parameters to internal format
            const taskData: YellowPagesTaskData = {
                name: params.name,
                platform: params.parameters.platform as string || 'yelp',
                keywords: params.parameters.keywords as string[] || [],
                location: params.parameters.location as string,
                max_pages: params.parameters.maxPages as number || 10,
                concurrency: params.parameters.concurrency as number || 1,
                headless: !(params.parameters.showBrowser as boolean) || true
            };

            const taskId = await this.createTask(taskData);

            // Convert to MCP task format
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: params.name,
                description: params.description,
                type: params.type,
                status: 'pending',
                parameters: params.parameters,
                priority: params.priority || 'medium',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            return createMCPSuccessResponse(mcpTask, 'Yellow Pages task created successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle list Yellow Pages tasks requests
     */
    private async handleListYellowPagesTasksRequest(params: MCPPaginationParams): Promise<MCPResponse<MCPTaskListData>> {
        try {
            const filters: TaskFilters = {
                status: undefined, // Could be added to params
                platform: undefined, // Could be added to params
                createdAfter: undefined, // Could be added to params
                createdBefore: undefined // Could be added to params
            };

            const tasks = await this.listTasks(filters);

            // Convert to MCP format
            const mcpTasks: MCPTask[] = tasks.map(task => ({
                id: task.id.toString(),
                name: task.name,
                description: `Platform: ${task.platform}`,
                type: 'yellow_pages',
                status: this.mapTaskStatus(task.status),
                parameters: {
                    platform: task.platform
                },
                priority: 'medium',
                createdAt: task.created_at.toISOString(),
                updatedAt: task.updated_at?.toISOString() || task.created_at.toISOString()
            }));

            const taskListData: MCPTaskListData = {
                tasks: mcpTasks,
                pagination: {
                    items: mcpTasks,
                    total: mcpTasks.length,
                    page: params.page || 1,
                    size: params.size || 20,
                    totalPages: Math.ceil(mcpTasks.length / (params.size || 20))
                }
            };

            return createMCPSuccessResponse(taskListData, 'Yellow Pages tasks retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get Yellow Pages task requests
     */
    private async handleGetYellowPagesTaskRequest(taskId: number): Promise<MCPResponse<MCPTask>> {
        try {
            const taskInfo = await this.getTask(taskId);
            
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: taskInfo.task.name,
                description: `Platform: ${taskInfo.task.platform}, Keywords: ${taskInfo.task.keywords.join(', ')}`,
                type: 'yellow_pages',
                status: this.mapTaskStatus(taskInfo.task.status),
                parameters: {
                    platform: taskInfo.task.platform,
                    keywords: taskInfo.task.keywords,
                    location: taskInfo.task.location,
                    maxPages: taskInfo.task.max_pages,
                    concurrency: taskInfo.task.concurrency,
                    headless: taskInfo.task.headless
                },
                priority: 'medium',
                createdAt: taskInfo.task.created_at.toISOString(),
                updatedAt: taskInfo.task.updated_at.toISOString(),
                startedAt: undefined, // Not available in YellowPagesTask
                completedAt: taskInfo.task.completed_at?.toISOString(),
                resultsCount: undefined, // Not available in YellowPagesTask
                errorMessage: taskInfo.task.error_log
            };

            return createMCPSuccessResponse(mcpTask, 'Yellow Pages task retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle update Yellow Pages task requests
     */
    private async handleUpdateYellowPagesTaskRequest(params: MCPTaskUpdateRequest): Promise<MCPResponse<MCPTask>> {
        try {
            const taskId = parseInt(params.taskId);
            
            // Convert MCP update parameters to internal format
            const updates: Partial<YellowPagesTask> = {};
            if (params.name) updates.name = params.name;
            if (params.parameters) {
                if (params.parameters.platform) updates.platform = params.parameters.platform as string;
                if (params.parameters.keywords) updates.keywords = params.parameters.keywords as string[];
                if (params.parameters.location) updates.location = params.parameters.location as string;
                if (params.parameters.maxPages) updates.max_pages = params.parameters.maxPages as number;
                if (params.parameters.concurrency) updates.concurrency = params.parameters.concurrency as number;
                if (params.parameters.showBrowser !== undefined) updates.headless = !(params.parameters.showBrowser as boolean);
            }

            await this.updateTask(taskId, updates);

            // Get updated task details
            const taskInfo = await this.getTask(taskId);
            
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: params.name || taskInfo.task.name,
                description: params.description || `Platform: ${taskInfo.task.platform}, Keywords: ${taskInfo.task.keywords.join(', ')}`,
                type: 'yellow_pages',
                status: this.mapTaskStatus(taskInfo.task.status),
                parameters: {
                    platform: taskInfo.task.platform,
                    keywords: taskInfo.task.keywords,
                    location: taskInfo.task.location,
                    maxPages: taskInfo.task.max_pages,
                    concurrency: taskInfo.task.concurrency,
                    headless: taskInfo.task.headless
                },
                priority: 'medium',
                createdAt: taskInfo.task.created_at.toISOString(),
                updatedAt: new Date().toISOString(),
                startedAt: undefined, // Not available in YellowPagesTask
                completedAt: taskInfo.task.completed_at?.toISOString(),
                resultsCount: undefined, // Not available in YellowPagesTask
                errorMessage: taskInfo.task.error_log
            };

            return createMCPSuccessResponse(mcpTask, 'Yellow Pages task updated successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle delete Yellow Pages task requests
     */
    private async handleDeleteYellowPagesTaskRequest(taskId: number): Promise<MCPResponse> {
        try {
            await this.deleteTask(taskId);
            return createMCPSuccessResponse(null, 'Yellow Pages task deleted successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle start Yellow Pages task requests
     */
    private async handleStartYellowPagesTaskRequest(taskId: number): Promise<MCPResponse> {
        try {
            await this.startTask(taskId);
            return createMCPSuccessResponse(null, 'Yellow Pages task started successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle stop Yellow Pages task requests
     */
    private async handleStopYellowPagesTaskRequest(taskId: number): Promise<MCPResponse> {
        try {
            await this.stopTask(taskId);
            return createMCPSuccessResponse(null, 'Yellow Pages task stopped successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle pause Yellow Pages task requests
     */
    private async handlePauseYellowPagesTaskRequest(taskId: number): Promise<MCPResponse> {
        try {
            await this.pauseTask(taskId);
            return createMCPSuccessResponse(null, 'Yellow Pages task paused successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle resume Yellow Pages task requests
     */
    private async handleResumeYellowPagesTaskRequest(taskId: number): Promise<MCPResponse> {
        try {
            await this.resumeTask(taskId);
            return createMCPSuccessResponse(null, 'Yellow Pages task resumed successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get task progress requests
     */
    private async handleGetTaskProgressRequest(taskId: number): Promise<MCPResponse<TaskProgress>> {
        try {
            const progress = await this.getTaskProgress(taskId);
            return createMCPSuccessResponse(progress, 'Task progress retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get task results requests
     */
    private async handleGetTaskResultsRequest(params: { taskId: number } & MCPPaginationParams): Promise<MCPResponse<MCPYellowPagesData>> {
        try {
            const page = params.page || 1;
            const size = params.size || 20;
            
            const results = await this.getTaskResults(params.taskId, { page, size });

            // Convert to MCP format
            const businessListings: MCPBusinessListing[] = results.data.map(result => ({
                name: result.business_name || '',
                address: typeof result.address === 'string' ? result.address : 
                    result.address ? `${result.address.street || ''} ${result.address.city || ''} ${result.address.state || ''} ${result.address.zip || ''}`.trim() : '',
                phone: result.phone,
                website: result.website,
                email: result.email,
                rating: result.rating,
                reviewCount: result.review_count,
                categories: result.categories || [],
                hours: result.business_hours as Record<string, string> | undefined,
                coordinates: undefined, // Not available in YellowPagesResult
                platform: 'unknown', // This would need to be retrieved from task details
                listingUrl: '' // Not available in YellowPagesResult
            }));

            const yellowPagesData: MCPYellowPagesData = {
                businesses: businessListings,
                totalFound: results.pagination.total,
                platform: 'unknown',
                location: '',
                searchQuery: '',
                processingTime: 0
            };

            return createMCPSuccessResponse(yellowPagesData, 'Task results retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle export task results requests
     */
    private async handleExportTaskResultsRequest(params: { taskId: number; format?: 'json' | 'csv' }): Promise<MCPResponse<any>> {
        try {
            const format = params.format || 'json';
            const results = await this.exportTaskResults(params.taskId, format);
            return createMCPSuccessResponse(results, `Task results exported successfully in ${format} format`);
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get available platforms requests
     */
    private async handleGetAvailablePlatformsRequest(): Promise<MCPResponse<PlatformSummary[]>> {
        try {
            const platforms = await this.getAvailablePlatforms();
            return createMCPSuccessResponse(platforms, 'Available platforms retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get health status requests
     */
    private async handleGetHealthStatusRequest(): Promise<MCPResponse<any>> {
        try {
            const healthStatus = await this.getHealthStatus();
            return createMCPSuccessResponse(healthStatus, 'Health status retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get task statistics requests
     */
    private async handleGetTaskStatisticsRequest(): Promise<MCPResponse<any>> {
        try {
            const statistics = await this.getTaskStatistics();
            return createMCPSuccessResponse(statistics, 'Task statistics retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle bulk operations requests
     */
    private async handleBulkOperationsRequest(params: { operation: string; taskIds: number[] }): Promise<MCPResponse<any>> {
        try {
            const operation = params.operation as 'start' | 'stop' | 'pause' | 'delete';
            const result = await this.bulkOperations(operation, params.taskIds);
            return createMCPSuccessResponse(result, `Bulk ${operation} operation completed successfully`);
        } catch (error) {
            throw error;
        }
    }

    /**
     * Helper method to map internal task status to MCP status
     */
    private mapTaskStatus(status: TaskStatus): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' {
        switch (status) {
            case TaskStatus.Pending:
                return 'pending';
            case TaskStatus.InProgress:
                return 'running';
            case TaskStatus.Completed:
                return 'completed';
            case TaskStatus.Failed:
                return 'failed';
            case TaskStatus.Paused:
                return 'cancelled'; // Map paused to cancelled for MCP
            default:
                return 'pending';
        }
    }
}

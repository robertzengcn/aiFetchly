import { BaseModule } from "@/modules/baseModule";
import { YellowPagesTaskModel } from "@/model/YellowPagesTask.model";
import { SortBy } from "@/entityTypes/commonType";
import { YellowPagesTaskEntity } from "@/entity/YellowPagesTask.entity";
import { YellowPagesTaskData, TaskStatus, TaskFilters, TaskSummary } from "@/interfaces/ITaskManager";
import { YellowPagesTaskStatus } from "@/model/YellowPagesTask.model";
import { YellowPagesTaskUpdateFields } from "@/model/YellowPagesTask.model";
import { YellowPagesResultModule } from "@/modules/YellowPagesResultModule";

export class YellowPagesTaskModule extends BaseModule {
    private yellowPagesTaskModel: YellowPagesTaskModel;
    private yellowPagesResultModule: YellowPagesResultModule;

    constructor() {
        super();
        this.yellowPagesTaskModel = new YellowPagesTaskModel(this.dbpath);
        this.yellowPagesResultModule = new YellowPagesResultModule();
    }

    /**
     * Create a new Yellow Pages task
     * @param taskData The task data to create
     * @returns The ID of the created task
     */
    async createTask(taskData: YellowPagesTaskData): Promise<number> {
        try {
            // Convert proxy_config from object to string if it exists
            const modelTaskData = {
                ...taskData,
                proxy_config: taskData.proxy_config ? JSON.stringify(taskData.proxy_config) : undefined
            };
            
            // Use the model's saveYellowPagesTask method
            return await this.yellowPagesTaskModel.saveYellowPagesTask(modelTaskData);
        } catch (error) {
            console.error('Error creating task:', error);
            throw new Error(`Failed to create task: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a Yellow Pages task by ID
     * @param id The task ID
     * @returns The task entity
     */
    async getTaskById(id: number): Promise<YellowPagesTaskEntity | undefined> {
        try {
            const task = await this.yellowPagesTaskModel.getTaskById(id);
            return task || undefined;
        } catch (error) {
            console.error('Error getting task by ID:', error);
            throw new Error(`Failed to get task by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update a Yellow Pages task
     * @param id The task ID
     * @param updates The task updates
     */
    async updateTask(id: number, updates: Partial<YellowPagesTaskEntity>): Promise<void> {
        try {
            const existingTask = await this.getTaskById(id);
            if (!existingTask) {
                throw new Error(`Task with ID ${id} not found`);
            }

            // Convert entity updates to model update format
            const modelUpdates: YellowPagesTaskUpdateFields = {};
            
            // Map entity fields to model fields
            if (updates.name !== undefined) modelUpdates.name = updates.name;
            if (updates.platform !== undefined) modelUpdates.platform = updates.platform;
            if (updates.keywords !== undefined) {
                try {
                    const keywords = JSON.parse(updates.keywords);
                    modelUpdates.keywords = keywords;
                } catch (e) {
                    throw new Error('Invalid keywords format');
                }
            }
            if (updates.location !== undefined) modelUpdates.location = updates.location;
            if (updates.max_pages !== undefined) modelUpdates.max_pages = updates.max_pages;
            if (updates.concurrency !== undefined) modelUpdates.concurrency = updates.concurrency;
            if (updates.status !== undefined) modelUpdates.status = updates.status as YellowPagesTaskStatus;
            if (updates.scheduled_at !== undefined) modelUpdates.scheduled_at = updates.scheduled_at;
            if (updates.completed_at !== undefined) modelUpdates.completed_at = updates.completed_at;
            if (updates.error_log !== undefined) modelUpdates.error_log = updates.error_log;
            if (updates.run_log !== undefined) modelUpdates.run_log = updates.run_log;
            if (updates.account_id !== undefined) modelUpdates.account_id = updates.account_id;
            if (updates.proxy_config !== undefined) {
                try {
                    const proxyConfig = JSON.parse(updates.proxy_config);
                    modelUpdates.proxy_config = JSON.stringify(proxyConfig);
                } catch (e) {
                    throw new Error('Invalid proxy_config format');
                }
            }
            if (updates.delay_between_requests !== undefined) modelUpdates.delay_between_requests = updates.delay_between_requests;
            if (updates.headless !== undefined) modelUpdates.headless = updates.headless;

            const success = await this.yellowPagesTaskModel.updateTask(id, modelUpdates);
            if (!success) {
                throw new Error('Failed to update task');
            }
        } catch (error) {
            console.error('Error updating task:', error);
            throw new Error(`Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Delete a Yellow Pages task
     * @param id The task ID
     */
    async deleteTask(id: number): Promise<void> {
        try {
            const success = await this.yellowPagesTaskModel.deleteTask(id);
            if (!success) {
                throw new Error('Failed to delete task');
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            throw new Error(`Failed to delete task: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * List Yellow Pages tasks with pagination and filtering
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param filters Optional filters
     * @param sort Sort parameters (optional)
     * @returns Array of task summary objects
     */
    async listTasks(page: number = 0, size: number = 50, filters?: TaskFilters, sort?: SortBy): Promise<TaskSummary[]> {
        try {
            // Convert from 0-based to 1-based pagination for the model
            const modelPage = page + 1;
            
            // Get tasks from the model
            const tasks = await this.yellowPagesTaskModel.listTasks(modelPage, size, sort);
            
            // Convert entities to task summaries (now async)
            const taskSummaries = await Promise.all(tasks.map(task => this.convertEntityToTaskSummary(task)));
            
            // Apply filters if provided
            if (filters) {
                return this.applyFilters(taskSummaries, filters);
            }
            
            return taskSummaries;
        } catch (error) {
            console.error('Error listing tasks:', error);
            throw new Error(`Failed to list tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get total number of Yellow Pages tasks
     * @returns Total count of tasks
     */
    async countTasks(): Promise<number> {
        try {
            return await this.yellowPagesTaskModel.getTaskTotal();
        } catch (error) {
            console.error('Error counting tasks:', error);
            throw new Error(`Failed to count tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get tasks by status
     * @param status The task status to filter by
     * @returns Array of tasks with the specified status
     */
    async getTasksByStatus(status: TaskStatus): Promise<YellowPagesTaskEntity[]> {
        try {
            // Convert TaskStatus enum to YellowPagesTaskStatus enum
            const modelStatus = status as unknown as YellowPagesTaskStatus;
            return await this.yellowPagesTaskModel.getTasksByStatus(modelStatus);
        } catch (error) {
            console.error('Error getting tasks by status:', error);
            throw new Error(`Failed to get tasks by status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get tasks by platform
     * @param platform The platform to filter by
     * @returns Array of tasks for the specified platform
     */
    async getTasksByPlatform(platform: string): Promise<YellowPagesTaskEntity[]> {
        try {
            // Get all tasks and filter by platform
            // This is not the most efficient approach, but it works with the current model structure
            const allTasks = await this.yellowPagesTaskModel.listTasks(1, 1000); // Get a large number to cover all tasks
            return allTasks.filter(task => task.platform === platform);
        } catch (error) {
            console.error('Error getting tasks by platform:', error);
            throw new Error(`Failed to get tasks by platform: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search tasks by name or keywords
     * @param searchTerm The search term
     * @returns Array of matching tasks
     */
    async searchTasks(searchTerm: string): Promise<YellowPagesTaskEntity[]> {
        try {
            const allTasks = await this.yellowPagesTaskModel.listTasks(1, 1000); // Get a large number to cover all tasks
            
            return allTasks.filter(task => {
                const nameMatch = task.name.toLowerCase().includes(searchTerm.toLowerCase());
                let keywordMatch = false;
                
                try {
                    const keywords = JSON.parse(task.keywords);
                    keywordMatch = Array.isArray(keywords) && 
                        keywords.some(keyword => 
                            keyword.toLowerCase().includes(searchTerm.toLowerCase())
                        );
                } catch (e) {
                    // If keywords can't be parsed, just check the raw string
                    keywordMatch = task.keywords.toLowerCase().includes(searchTerm.toLowerCase());
                }
                
                return nameMatch || keywordMatch;
            });
        } catch (error) {
            console.error('Error searching tasks:', error);
            throw new Error(`Failed to search tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update task status
     * @param id The task ID
     * @param status The new status
     */
    async updateTaskStatus(id: number, status: TaskStatus): Promise<void> {
        try {
            const existingTask = await this.getTaskById(id);
            if (!existingTask) {
                throw new Error(`Task with ID ${id} not found`);
            }

            // Convert TaskStatus enum to YellowPagesTaskStatus enum
            const modelStatus = status as unknown as YellowPagesTaskStatus;
            await this.yellowPagesTaskModel.updateTaskStatus(id, modelStatus);
        } catch (error) {
            console.error('Error updating task status:', error);
            throw new Error(`Failed to update task status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update task progress
     * @param id The task ID
     * @param progress The progress data
     */
    async updateTaskProgress(id: number, progress: any): Promise<void> {
        const existingTask = await this.getTaskById(id);
        if (!existingTask) {
            throw new Error(`Task with ID ${id} not found`);
        }

        // Note: progress_data is not a property of YellowPagesTaskEntity
        // TODO: Implement progress tracking through a different mechanism
        throw new Error("Progress tracking not implemented");
    }

    /**
     * Get tasks by account ID
     * @param accountId The account ID
     * @returns Array of tasks for the specified account
     */
    async getTasksByAccountId(accountId: number): Promise<YellowPagesTaskEntity[]> {
        try {
            const allTasks = await this.yellowPagesTaskModel.listTasks(1, 1000); // Get a large number to cover all tasks
            return allTasks.filter(task => task.account_id === accountId);
        } catch (error) {
            console.error('Error getting tasks by account ID:', error);
            throw new Error(`Failed to get tasks by account ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get active tasks (running, pending, or paused)
     * @returns Array of active tasks
     */
    async getActiveTasks(): Promise<YellowPagesTaskEntity[]> {
        const activeStatuses: TaskStatus[] = [TaskStatus.InProgress, TaskStatus.Pending, TaskStatus.Paused];
        const activeTasks: YellowPagesTaskEntity[] = [];
        
        for (const status of activeStatuses) {
            const tasks = await this.getTasksByStatus(status);
            activeTasks.push(...tasks);
        }
        
        return activeTasks;
    }

    /**
     * Get completed tasks
     * @returns Array of completed tasks
     */
    async getCompletedTasks(): Promise<YellowPagesTaskEntity[]> {
        return await this.getTasksByStatus(TaskStatus.Completed);
    }

    /**
     * Get failed tasks
     * @returns Array of failed tasks
     */
    async getFailedTasks(): Promise<YellowPagesTaskEntity[]> {
        return await this.getTasksByStatus(TaskStatus.Failed);
    }

    /**
     * Get task statistics
     * @returns Object with task counts by status
     */
    async getTaskStatistics(): Promise<{
        total: number;
        pending: number;
        running: number;
        completed: number;
        failed: number;
        paused: number;
    }> {
        const total = await this.countTasks();
        const pending = (await this.getTasksByStatus(TaskStatus.Pending)).length;
        const running = (await this.getTasksByStatus(TaskStatus.InProgress)).length;
        const completed = (await this.getTasksByStatus(TaskStatus.Completed)).length;
        const failed = (await this.getTasksByStatus(TaskStatus.Failed)).length;
        const paused = (await this.getTasksByStatus(TaskStatus.Paused)).length;

        return {
            total,
            pending,
            running,
            completed,
            failed,
            paused
        };
    }

    /**
     * Get recent tasks
     * @param limit Maximum number of recent tasks to return
     * @returns Array of recent tasks
     */
    async getRecentTasks(limit: number = 10): Promise<YellowPagesTaskEntity[]> {
        try {
            // Get recent tasks by using the listTasks method with sorting by creation date
            const recentTasks = await this.yellowPagesTaskModel.listTasks(1, limit, { key: 'createdAt', order: 'DESC' });
            return recentTasks;
        } catch (error) {
            console.error('Error getting recent tasks:', error);
            throw new Error(`Failed to get recent tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Clean up old completed tasks
     * @param daysOld Number of days old to consider for cleanup
     * @returns Number of tasks cleaned up
     */
    async cleanupOldTasks(daysOld: number = 30): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            
            // Get all completed tasks
            const completedTasks = await this.getTasksByStatus(TaskStatus.Completed);
            
            // Filter tasks older than cutoff date
            const oldTasks = completedTasks.filter(task => 
                task.completed_at && task.completed_at < cutoffDate
            );
            
            // Delete old tasks
            let deletedCount = 0;
            for (const task of oldTasks) {
                const success = await this.yellowPagesTaskModel.deleteTask(task.id);
                if (success) {
                    deletedCount++;
                }
            }
            
            return deletedCount;
        } catch (error) {
            console.error('Error cleaning up old tasks:', error);
            throw new Error(`Failed to cleanup old tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Convert entity to task summary format
     * @param entity The task entity
     * @returns The task summary
     */
    private async convertEntityToTaskSummary(entity: YellowPagesTaskEntity): Promise<TaskSummary> {
        // Get the actual results count from the results module
        let resultsCount = 0;
        try {
            resultsCount = await this.yellowPagesResultModule.getResultsCountByTaskId(entity.id);
        } catch (error) {
            console.warn(`Failed to get results count for task ${entity.id}:`, error);
            // Fallback to 0 if we can't get the count
        }

        return {
            id: entity.id,
            name: entity.name,
            platform: entity.platform,
            status: entity.status as TaskStatus, // Cast the number status to TaskStatus enum
            created_at: entity.createdAt || new Date(),
            updated_at: entity.updatedAt || entity.createdAt || new Date(),
            completed_at: entity.completed_at,
            progress_percentage: this.calculateProgress(entity),
            results_count: resultsCount,
            pid: entity.pid // Include PID for process management
        };
    }

    /**
     * Calculate task progress from entity data
     * @param entity The task entity
     * @returns Progress percentage
     */
    private calculateProgress(entity: YellowPagesTaskEntity): number {
        if (entity.status === TaskStatus.Completed) {
            return 100;
        } else if (entity.status === TaskStatus.Failed) {
            return 0;
        } else if (entity.status === TaskStatus.InProgress) {
            // For in-progress tasks, we could calculate based on some progress indicator
            // For now, return a default progress
            return 25;
        }
        return 0;
    }

    /**
     * Apply filters to task summaries
     * @param tasks Array of task summaries
     * @param filters The filters to apply
     * @returns Filtered array of task summaries
     */
    private applyFilters(tasks: TaskSummary[], filters: TaskFilters): TaskSummary[] {
        let filteredTasks = [...tasks];

        // Filter by status
        if (filters.status !== undefined) {
            filteredTasks = filteredTasks.filter(task => task.status === filters.status);
        }

        // Filter by platform
        if (filters.platform) {
            filteredTasks = filteredTasks.filter(task => task.platform === filters.platform);
        }

        // Filter by creation date range
        if (filters.createdAfter) {
            filteredTasks = filteredTasks.filter(task => task.created_at >= filters.createdAfter!);
        }

        if (filters.createdBefore) {
            filteredTasks = filteredTasks.filter(task => task.created_at <= filters.createdBefore!);
        }

        // Apply pagination (filters.offset and filters.limit are handled by the model)
        // The model already applies pagination, so we just return the filtered results
        return filteredTasks;
    }

    /**
     * Get task status name
     * @param status The task status value
     * @returns String representation of the status
     */
    getTaskStatusName(status: TaskStatus): string {
        switch (status) {
            case TaskStatus.Pending:
                return "Pending";
            case TaskStatus.InProgress:
                return "Running";
            case TaskStatus.Completed:
                return "Completed";
            case TaskStatus.Failed:
                return "Failed";
            case TaskStatus.Paused:
                return "Paused";
            default:
                return "Unknown";
        }
    }
}

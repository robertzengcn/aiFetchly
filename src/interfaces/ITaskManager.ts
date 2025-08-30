/**
 * Task management interface that defines the contract for managing Yellow Pages scraping tasks.
 * 
 * This interface ensures consistent task lifecycle management across the system and provides
 * a unified way to create, monitor, and control scraping tasks. It supports both synchronous
 * and asynchronous task operations.
 * 
 * @example
 * ```typescript
 * const taskManager = new YellowPagesTaskManager();
 * const taskId = await taskManager.createTask(taskData);
 * await taskManager.startTask(taskId);
 * const progress = await taskManager.getTaskProgress(taskId);
 * const results = await taskManager.getTaskResults(taskId);
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface ITaskManager {
    /**
     * Create a new scraping task
     * @param taskData - Task configuration data
     * @returns Promise resolving to the created task ID
     */
    createTask(taskData: YellowPagesTaskData): Promise<number>;

    /**
     * Start a specific task
     * @param taskId - ID of the task to start
     * @returns Promise that resolves when the task starts
     */
    startTask(taskId: number): Promise<void>;

    /**
     * Stop a specific task
     * @param taskId - ID of the task to stop
     * @returns Promise that resolves when the task stops
     */
    stopTask(taskId: number): Promise<void>;

    /**
     * Pause a specific task
     * @param taskId - ID of the task to pause
     * @returns Promise that resolves when the task is paused
     */
    pauseTask(taskId: number): Promise<void>;

    /**
     * Resume a specific task
     * @param taskId - ID of the task to resume
     * @returns Promise that resolves when the task resumes
     */
    resumeTask(taskId: number): Promise<void>;

    /**
     * Get the current status of a task
     * @param taskId - ID of the task
     * @returns Promise resolving to the task status
     */
    getTaskStatus(taskId: number): Promise<TaskStatus>;

    /**
     * Get the current progress of a task
     * @param taskId - ID of the task
     * @returns Promise resolving to the task progress
     */
    getTaskProgress(taskId: number): Promise<TaskProgress>;

    /**
     * Get results for a specific task
     * @param taskId - ID of the task
     * @returns Promise resolving to array of task results
     */
    getTaskResults(taskId: number): Promise<YellowPagesResult[]>;

    /**
     * List all tasks with optional filtering
     * @param filters - Optional filters to apply
     * @returns Promise resolving to array of task summaries
     */
    listTasks(filters?: TaskFilters): Promise<TaskSummary[]>;

    /**
     * Update a specific task
     * @param taskId - ID of the task to update
     * @param updates - Partial task data to update
     * @returns Promise that resolves when the task is updated
     */
    updateTask(taskId: number, updates: Partial<YellowPagesTask>): Promise<void>;

    /**
     * Delete a specific task
     * @param taskId - ID of the task to delete
     * @returns Promise that resolves when the task is deleted
     */
    deleteTask(taskId: number): Promise<void>;
}

/**
 * Task data for creating new tasks
 */
export interface YellowPagesTaskData {
    name: string;
    platform: string;
    keywords: string[];
    location?: string;
    max_pages?: number;
    concurrency?: number;
    account_id?: number;
    proxy_config?: object;
    delay_between_requests?: number;
    headless?: boolean;
    scheduled_at?: Date;
}

/**
 * Task status enumeration
 */
export enum TaskStatus {
    Pending = 0,
    InProgress = 1,
    Completed = 2,
    Failed = 3,
    Paused = 4
}

/**
 * Task progress information
 */
export interface TaskProgress {
    taskId: number;
    status: TaskStatus;
    currentPage: number;
    totalPages: number;
    resultsCount: number;
    percentage: number;
    estimatedTimeRemaining?: number;
    startTime?: Date;
    lastUpdateTime: Date;
    errorMessage?: string;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
    page: number;
    size: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        size: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}

/**
 * Task filters for listing tasks
 */
export interface TaskFilters {
    status?: TaskStatus;
    platform?: string;
    createdAfter?: Date;
    createdBefore?: Date;
    limit?: number;
    offset?: number;
    page?: number;
    size?: number;
}

/**
 * Task summary for listing
 */
export interface TaskSummary {
    id: number;
    name: string;
    platform: string;
    status: TaskStatus;
    created_at: Date;
    updated_at?: Date;
    completed_at?: Date;
    results_count?: number;
    progress_percentage?: number;
    pid?: number; // Process ID for PID management
}

/**
 * Yellow Pages task structure
 */
export interface YellowPagesTask {
    id: number;
    name: string;
    platform: string;
    keywords: string[];
    location?: string;
    max_pages: number;
    concurrency: number;
    status: TaskStatus;
    created_at: Date;
    updated_at: Date;
    scheduled_at?: Date;
    completed_at?: Date;
    error_log?: string;
    run_log?: string;
    account_id?: number;
    proxy_config?: object;
    delay_between_requests: number;
    headless?: boolean;
}

/**
 * Yellow Pages result structure
 */
export interface YellowPagesResult {
    id: number;
    task_id: number;
    business_name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
    };
    social_media?: string[];
    categories?: string[];
    business_hours?: object;
    description?: string;
    rating?: number;
    review_count?: number;
    scraped_at: Date;
    platform: string;
    raw_data?: object;
    fax_number?: string;
    contact_person?: string;
    year_established?: number;
    number_of_employees?: string;
    payment_methods?: string[];
    specialties?: string[];
} 
import { SortBy } from "@/entityTypes/commonType";
import { TaskType, ScheduleStatus, TriggerType, DependencyCondition } from "@/entity/ScheduleTask.entity";
import { ExecutionStatus } from "@/entity/ScheduleExecutionLog.entity";

// Request types
export interface ScheduleCreateRequest {
    name: string;
    description?: string;
    task_type: TaskType;
    task_id: number;
    cron_expression: string;
    is_active?: boolean;
    trigger_type?: TriggerType;
    parent_schedule_id?: number;
    dependency_condition?: DependencyCondition;
    delay_minutes?: number;
}

export interface ScheduleUpdateRequest {
    name?: string;
    description?: string;
    task_type?: TaskType;
    task_id?: number;
    cron_expression?: string;
    is_active?: boolean;
    trigger_type?: TriggerType;
    parent_schedule_id?: number;
    dependency_condition?: DependencyCondition;
    delay_minutes?: number;
    status?: ScheduleStatus;
}

export interface DependencyCreateRequest {
    parent_schedule_id: number;
    child_schedule_id: number;
    dependency_condition: DependencyCondition;
    delay_minutes?: number;
    notes?: string;
}

// Response types
export interface ScheduleListResponse {
    schedules: any[];
    total: number;
    page: number;
    size: number;
}

export interface ScheduleDetailResponse {
    schedule: any;
    execution_history?: any[];
    dependencies?: {
        children: any[];
        parents: any[];
    };
}

export interface ExecutionHistoryResponse {
    executions: any[];
    total: number;
    page: number;
    size: number;
}

export interface DependencyGraphResponse {
    nodes: any[];
    edges: any[];
}

export interface DependencyValidationResponse {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

// Scheduler status and execution types
export interface SchedulerStatusInfo {
    isRunning: boolean;
    activeSchedules: number;
    totalSchedules: number;
    lastCheckTime: Date;
    nextCheckTime: Date;
    queueSize: number;
    runningExecutions: number;
    lastExecutionTime: Date | null;
}

export interface SchedulerStatusResponse {
    isRunning: boolean;
    activeSchedules: number;
    totalSchedules: number;
    lastCheckTime: Date;
    nextCheckTime: Date;
}

export interface ExecutionQueueItem {
    scheduleId: number;
    priority: number;
    retryCount: number;
    maxRetries: number;
    parentExecutionId?: number;
    triggeredBy: TriggerType;
    scheduledTime: Date;
}

export interface DetailedStats {
    scheduler: SchedulerStatusInfo;
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

// Task execution types
export interface TaskExecutionRequest {
    scheduleId: number;
    taskType: TaskType;
    taskId: number;
    parentExecutionId?: number;
    triggeredBy: TriggerType;
}

export interface TaskExecutionResult {
    executionId: number;
    status: ExecutionStatus;
    duration: number;
    message: string;
    output?: any;
}

// Dependency management types
export interface DependencyStatistics {
    total: number;
    active: number;
    inactive: number;
    byCondition: Record<string, number>;
}

export interface DependencyValidationResult {
    isValid: boolean;
    circularDependencies: number[];
    orphanedDependencies: number[];
    errors: string[];
    warnings: string[];
}

// Schedule filtering and search types
export interface ScheduleFilterOptions {
    taskType?: TaskType;
    status?: ScheduleStatus;
    triggerType?: TriggerType;
    isActive?: boolean;
    dateRange?: {
        startDate: Date;
        endDate: Date;
    };
}

export interface ScheduleSearchRequest {
    query?: string;
    filters?: ScheduleFilterOptions;
    page: number;
    size: number;
    sort?: SortBy;
}

// Execution statistics types
export interface ExecutionStatistics {
    total: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    averageExecutionTime: number;
    successRate: number;
    lastExecutionTime?: Date;
    nextExecutionTime?: Date;
}

// Cron expression validation types
export interface CronValidationResult {
    isValid: boolean;
    errors: string[];
    nextRunTimes: Date[];
    description: string;
}

// Schedule import/export types
export interface ScheduleExportData {
    schedules: any[];
    dependencies: any[];
    version: string;
    exportDate: Date;
}

export interface ScheduleImportRequest {
    data: ScheduleExportData;
    overwriteExisting?: boolean;
    validateOnly?: boolean;
}

export interface ScheduleImportResult {
    success: boolean;
    importedSchedules: number;
    importedDependencies: number;
    errors: string[];
    warnings: string[];
}

// Enum types
export { TaskType, ScheduleStatus, TriggerType, DependencyCondition } from "@/entity/ScheduleTask.entity";
export { ExecutionStatus } from "@/entity/ScheduleExecutionLog.entity";

// Additional enums
export enum SchedulerStatus {
    RUNNING = 'running',
    STOPPED = 'stopped',
    PAUSED = 'paused',
    ERROR = 'error'
}

// Priority levels for execution queue
export enum ExecutionPriority {
    LOW = 1,
    NORMAL = 5,
    HIGH = 10,
    CRITICAL = 15
}

// Retry strategies
export enum RetryStrategy {
    IMMEDIATE = 'immediate',
    LINEAR_BACKOFF = 'linear_backoff',
    EXPONENTIAL_BACKOFF = 'exponential_backoff',
    FIXED_DELAY = 'fixed_delay'
}

// Notification types
export enum NotificationType {
    EXECUTION_STARTED = 'execution_started',
    EXECUTION_COMPLETED = 'execution_completed',
    EXECUTION_FAILED = 'execution_failed',
    SCHEDULE_CREATED = 'schedule_created',
    SCHEDULE_UPDATED = 'schedule_updated',
    SCHEDULE_DELETED = 'schedule_deleted',
    DEPENDENCY_ADDED = 'dependency_added',
    DEPENDENCY_REMOVED = 'dependency_removed'
} 
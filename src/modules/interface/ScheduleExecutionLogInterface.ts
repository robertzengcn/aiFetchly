import { ScheduleExecutionLogEntity } from "@/entity/ScheduleExecutionLog.entity";
import { ExecutionStatus, TriggerType } from "@/entity/ScheduleExecutionLog.entity";
import { SortBy, ListData } from "@/entityTypes/commonType";

export interface ExecutionStatistics {
    total: number;
    successful: number;
    failed: number;
    running: number;
    averageDuration: number;
    lastExecution: Date | null;
}

export interface ScheduleExecutionLogInterface {
    /**
     * Log a new execution
     * @param scheduleId The schedule ID
     * @param status The execution status
     * @param message The result or error message
     * @param duration The execution duration in milliseconds
     * @param parentExecutionId Optional parent execution ID for dependency chains
     * @param triggeredBy What triggered this execution
     * @param taskOutputId Optional reference to task output
     * @returns The ID of the created execution log
     */
    logExecution(
        scheduleId: number, 
        status: ExecutionStatus, 
        message: string, 
        duration: number,
        parentExecutionId?: number,
        triggeredBy?: TriggerType,
        taskOutputId?: number
    ): Promise<number>;

    /**
     * Update execution status
     * @param executionId The execution log ID
     * @param status The new status
     * @param message Optional result message
     * @param duration Optional execution duration
     */
    updateExecutionStatus(
        executionId: number, 
        status: ExecutionStatus, 
        message?: string,
        duration?: number
    ): Promise<void>;

    /**
     * Get execution by ID
     * @param executionId The execution ID
     * @returns The execution log entity or null
     */
    getExecutionById(executionId: number): Promise<ScheduleExecutionLogEntity | null>;

    /**
     * Get execution history for a schedule with pagination
     * @param scheduleId The schedule ID
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @returns List data containing records and total count
     */
    getExecutionHistory(scheduleId: number, page: number, size: number): Promise<ListData<ScheduleExecutionLogEntity>>;

    /**
     * Get total number of executions for a schedule
     * @param scheduleId The schedule ID
     * @returns Total count of executions
     */
    getExecutionHistoryTotal(scheduleId: number): Promise<number>;

    /**
     * Get recent executions across all schedules
     * @param limit Maximum number of executions to return
     * @returns Array of recent execution log entities
     */
    getRecentExecutions(limit: number): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Get failed executions for a schedule
     * @param scheduleId The schedule ID
     * @param limit Maximum number of executions to return
     * @returns Array of failed execution log entities
     */
    getFailedExecutions(scheduleId: number, limit: number): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Get child executions for a parent execution
     * @param parentExecutionId The parent execution ID
     * @returns Array of child execution log entities
     */
    getChildExecutions(parentExecutionId: number): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Get execution chain starting from a specific execution
     * @param executionId The execution ID to start from
     * @returns Array of execution log entities in the chain
     */
    getExecutionChain(executionId: number): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Get executions by status
     * @param status The execution status to filter by
     * @param limit Maximum number of executions to return
     * @returns Array of execution log entities
     */
    getExecutionsByStatus(status: ExecutionStatus, limit: number): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Get executions by trigger type
     * @param triggeredBy The trigger type to filter by
     * @param limit Maximum number of executions to return
     * @returns Array of execution log entities
     */
    getExecutionsByTriggerType(triggeredBy: TriggerType, limit: number): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Get execution statistics for a schedule
     * @param scheduleId The schedule ID
     * @returns Object with execution statistics
     */
    getExecutionStatistics(scheduleId: number): Promise<ExecutionStatistics>;

    /**
     * Get running executions
     * @returns Array of currently running execution log entities
     */
    getRunningExecutions(): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Clean up old execution logs
     * @param daysToKeep Number of days to keep execution logs
     * @returns Number of deleted records
     */
    cleanupOldExecutions(daysToKeep: number): Promise<number>;

    /**
     * Get executions within a date range
     * @param startDate Start date
     * @param endDate End date
     * @param scheduleId Optional schedule ID to filter by
     * @returns Array of execution log entities
     */
    getExecutionsInDateRange(
        startDate: Date, 
        endDate: Date, 
        scheduleId?: number
    ): Promise<ScheduleExecutionLogEntity[]>;

    /**
     * Get all executions with pagination and filtering
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param scheduleId Optional schedule ID to filter by
     * @param status Optional status to filter by
     * @param triggeredBy Optional trigger type to filter by
     * @param sort Optional sort parameters
     * @returns List data containing records and total count
     */
    listExecutions(
        page: number, 
        size: number, 
        scheduleId?: number,
        status?: ExecutionStatus,
        triggeredBy?: TriggerType,
        sort?: SortBy
    ): Promise<ListData<ScheduleExecutionLogEntity>>;

    /**
     * Get total number of executions with optional filtering
     * @param scheduleId Optional schedule ID to filter by
     * @param status Optional status to filter by
     * @param triggeredBy Optional trigger type to filter by
     * @returns Total count of executions
     */
    getExecutionsTotal(
        scheduleId?: number,
        status?: ExecutionStatus,
        triggeredBy?: TriggerType
    ): Promise<number>;

    /**
     * Delete execution log by ID
     * @param executionId The execution ID to delete
     */
    deleteExecution(executionId: number): Promise<void>;

    /**
     * Delete all execution logs for a schedule
     * @param scheduleId The schedule ID
     * @returns Number of deleted records
     */
    deleteExecutionsBySchedule(scheduleId: number): Promise<number>;

    /**
     * Truncate the database table
     */
    truncatedb(): Promise<void>;
} 
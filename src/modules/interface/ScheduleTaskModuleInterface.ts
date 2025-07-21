import { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";
import { ScheduleCreateRequest, ScheduleUpdateRequest, ScheduleListResponse, ScheduleDetailResponse, DependencyValidationResponse } from "@/entityTypes/schedule-type";
import { SortBy, ListData } from "@/entityTypes/commonType";
import { TaskType, ScheduleStatus, TriggerType } from "@/entity/ScheduleTask.entity";

export interface ScheduleTaskModuleInterface {
    /**
     * Create a new schedule task
     * @param scheduleData The schedule creation data
     * @returns The ID of the created schedule
     */
    createSchedule(scheduleData: ScheduleCreateRequest): Promise<number>;

    /**
     * Update an existing schedule task
     * @param id The schedule ID
     * @param scheduleData The update data
     */
    updateSchedule(id: number, scheduleData: ScheduleUpdateRequest): Promise<void>;

    /**
     * Delete a schedule task
     * @param id The schedule ID
     */
    deleteSchedule(id: number): Promise<void>;

    /**
     * Get schedule task by ID
     * @param id The schedule ID
     * @returns The schedule entity or null
     */
    getScheduleById(id: number): Promise<ScheduleTaskEntity | null>;

    /**
     * List schedule tasks with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns List data containing records and total count
     */
    listSchedules(page: number, size: number, sort?: SortBy): Promise<ListData<ScheduleTaskEntity>>;

    /**
     * Get total number of schedule tasks
     * @returns Total count of schedules
     */
    getScheduleTotal(): Promise<number>;

    /**
     * Get active schedule tasks
     * @returns Array of active schedule entities
     */
    getActiveSchedules(): Promise<ScheduleTaskEntity[]>;

    /**
     * Get schedules ready to execute (next_run_time <= now)
     * @returns Array of schedules ready to execute
     */
    getSchedulesReadyToExecute(): Promise<ScheduleTaskEntity[]>;

    /**
     * Update next run time for a schedule
     * @param id The schedule ID
     * @param nextRunTime The new next run time
     */
    updateNextRunTime(id: number, nextRunTime: Date): Promise<void>;

    /**
     * Update last run time for a schedule
     * @param id The schedule ID
     * @param lastRunTime The new last run time
     */
    updateLastRunTime(id: number, lastRunTime: Date): Promise<void>;

    /**
     * Increment execution count for a schedule
     * @param id The schedule ID
     * @param success Whether the execution was successful
     */
    incrementExecutionCount(id: number, success: boolean): Promise<void>;

    /**
     * Update last error message for a schedule
     * @param id The schedule ID
     * @param errorMessage The error message
     */
    updateLastErrorMessage(id: number, errorMessage: string): Promise<void>;

    /**
     * Get child schedules for a parent schedule
     * @param parentId The parent schedule ID
     * @returns Array of child schedule entities
     */
    getChildSchedules(parentId: number): Promise<ScheduleTaskEntity[]>;

    /**
     * Get parent schedule for a child schedule
     * @param childId The child schedule ID
     * @returns The parent schedule entity or null
     */
    getParentSchedule(childId: number): Promise<ScheduleTaskEntity | null>;

    /**
     * Get dependency chain for a schedule
     * @param scheduleId The schedule ID
     * @returns Array of schedule entities in the dependency chain
     */
    getDependencyChain(scheduleId: number): Promise<ScheduleTaskEntity[]>;

    /**
     * Check for circular dependencies
     * @param scheduleId The schedule ID to check
     * @returns True if circular dependency is detected
     */
    checkCircularDependencies(scheduleId: number): Promise<boolean>;

    /**
     * Get schedules by task type
     * @param taskType The task type to filter by
     * @returns Array of schedule entities
     */
    getSchedulesByTaskType(taskType: TaskType): Promise<ScheduleTaskEntity[]>;

    /**
     * Get schedules by trigger type
     * @param triggerType The trigger type to filter by
     * @returns Array of schedule entities
     */
    getSchedulesByTriggerType(triggerType: TriggerType): Promise<ScheduleTaskEntity[]>;

    /**
     * Enable a schedule
     * @param id The schedule ID
     */
    enableSchedule(id: number): Promise<void>;

    /**
     * Disable a schedule
     * @param id The schedule ID
     */
    disableSchedule(id: number): Promise<void>;

    /**
     * Pause a schedule
     * @param id The schedule ID
     */
    pauseSchedule(id: number): Promise<void>;

    /**
     * Resume a schedule
     * @param id The schedule ID
     */
    resumeSchedule(id: number): Promise<void>;

    /**
     * Validate schedule configuration
     * @param scheduleData The schedule data to validate
     * @returns Validation result with validity status and error messages
     */
    validateSchedule(scheduleData: ScheduleCreateRequest | ScheduleUpdateRequest): Promise<DependencyValidationResponse>;

    /**
     * Get schedule details with execution history and dependencies
     * @param id The schedule ID
     * @returns Schedule detail response
     */
    getScheduleDetails(id: number): Promise<ScheduleDetailResponse>;

    /**
     * Truncate the database table
     */
    truncatedb(): Promise<void>;
} 
import { windowInvoke, windowSend } from '@/views/utils/apirequest'
import { 
    ScheduleCreateRequest, 
    ScheduleUpdateRequest, 
    ScheduleListResponse, 
    ScheduleDetailResponse,
    ExecutionHistoryResponse,
    DependencyCreateRequest,
    DependencyGraphResponse,
    DependencyValidationResponse,
    SchedulerStatusResponse,
    ScheduleFilterOptions,
    ScheduleSearchRequest,
    ExecutionStatistics,
    CronValidationResult,
    ScheduleExportData,
    ScheduleImportRequest,
    ScheduleImportResult
} from '@/entityTypes/schedule-type'
import { SortBy } from '@/entityTypes/commonType'
import { TaskType, ScheduleStatus, TriggerType, DependencyCondition } from '@/entity/ScheduleTask.entity'
import { ExecutionStatus } from '@/entity/ScheduleExecutionLog.entity'
import {
    SCHEDULE_CREATE,
    SCHEDULE_UPDATE,
    SCHEDULE_DELETE,
    SCHEDULE_ENABLE,
    SCHEDULE_DISABLE,
    SCHEDULE_PAUSE,
    SCHEDULE_RESUME,
    SCHEDULE_RUN_NOW,
    SCHEDULE_LIST,
    SCHEDULE_DETAIL,
    SCHEDULE_BY_TASK_TYPE,
    SCHEDULE_SEARCH,
    SCHEDULE_EXPORT,
    SCHEDULE_IMPORT,
    EXECUTION_HISTORY,
    EXECUTION_STATISTICS,
    EXECUTION_RECENT,
    DEPENDENCY_ADD,
    DEPENDENCY_REMOVE,
    DEPENDENCY_GRAPH,
    DEPENDENCY_VALIDATE,
    SCHEDULER_STATUS,
    SCHEDULER_START,
    SCHEDULER_STOP,
    SCHEDULER_RELOAD,
    CRON_VALIDATE,
    CRON_NEXT_RUN_TIME
} from '@/config/channellist'

// Schedule Management
export async function createSchedule(scheduleData: ScheduleCreateRequest): Promise<number> {
    const response = await windowInvoke(SCHEDULE_CREATE, scheduleData)
    return response
}

export async function updateSchedule(id: number, scheduleData: ScheduleUpdateRequest): Promise<void> {
    await windowInvoke(SCHEDULE_UPDATE, { id, ...scheduleData })
}

export async function deleteSchedule(id: number): Promise<void> {
    await windowInvoke(SCHEDULE_DELETE, { id })
}

export async function enableSchedule(id: number): Promise<void> {
    await windowInvoke(SCHEDULE_ENABLE, { id })
}

export async function disableSchedule(id: number): Promise<void> {
    await windowInvoke(SCHEDULE_DISABLE, { id })
}

export async function pauseSchedule(id: number): Promise<void> {
    await windowInvoke(SCHEDULE_PAUSE, { id })
}

export async function resumeSchedule(id: number): Promise<void> {
    await windowInvoke(SCHEDULE_RESUME, { id })
}

export async function runScheduleNow(id: number): Promise<void> {
    await windowInvoke(SCHEDULE_RUN_NOW, { id })
}

export async function getScheduleList(
    page: number = 0, 
    size: number = 10, 
    sort?: SortBy,
    filters?: ScheduleFilterOptions
): Promise<ScheduleListResponse> {
    const response = await windowInvoke(SCHEDULE_LIST, { page, size, sort, filters })
    return response
}

export async function getScheduleById(id: number): Promise<ScheduleDetailResponse> {
    const response = await windowInvoke(SCHEDULE_DETAIL, { id })
    return response
}

export async function getSchedulesByTaskType(taskType: TaskType): Promise<any[]> {
    const response = await windowInvoke(SCHEDULE_BY_TASK_TYPE, { taskType })
    return response
}

export async function searchSchedules(searchRequest: ScheduleSearchRequest): Promise<ScheduleListResponse> {
    const response = await windowInvoke(SCHEDULE_SEARCH, searchRequest)
    return response
}

export async function exportSchedules(filterOptions?: ScheduleFilterOptions): Promise<ScheduleExportData> {
    const response = await windowInvoke(SCHEDULE_EXPORT, { filters: filterOptions })
    return response
}

export async function importSchedules(importRequest: ScheduleImportRequest): Promise<ScheduleImportResult> {
    const response = await windowInvoke(SCHEDULE_IMPORT, importRequest)
    return response
}

// Execution Management
export async function getExecutionHistory(
    scheduleId: number, 
    page: number = 0, 
    size: number = 10
): Promise<ExecutionHistoryResponse> {
    const response = await windowInvoke(EXECUTION_HISTORY, { scheduleId, page, size })
    return response
}

export async function getExecutionStatistics(scheduleId: number): Promise<ExecutionStatistics> {
    const response = await windowInvoke(EXECUTION_STATISTICS, { scheduleId })
    return response
}

export async function getRecentExecutions(limit: number = 10): Promise<any[]> {
    const response = await windowInvoke(EXECUTION_RECENT, { limit })
    return response
}

// Dependency Management
export async function addDependency(
    parentId: number, 
    childId: number, 
    dependencyData: DependencyCreateRequest
): Promise<number> {
    const response = await windowInvoke(DEPENDENCY_ADD, { parentId, childId, ...dependencyData })
    return response
}

export async function removeDependency(parentId: number, childId: number): Promise<void> {
    await windowInvoke(DEPENDENCY_REMOVE, { parentId, childId })
}

export async function getDependencyGraph(scheduleId: number): Promise<DependencyGraphResponse> {
    const response = await windowInvoke(DEPENDENCY_GRAPH, { scheduleId })
    return response
}

export async function validateDependencies(scheduleId: number): Promise<DependencyValidationResponse> {
    const response = await windowInvoke(DEPENDENCY_VALIDATE, { scheduleId })
    return response
}

// Scheduler Management
export async function getSchedulerStatus(): Promise<SchedulerStatusResponse> {
    const response = await windowInvoke(SCHEDULER_STATUS)
    console.log('Scheduler status response:', response);
    return response
}

export async function startScheduler(): Promise<void> {
    await windowInvoke(SCHEDULER_START)
}

export async function stopScheduler(): Promise<void> {
    await windowInvoke(SCHEDULER_STOP)
}

export async function reloadScheduler(): Promise<void> {
    await windowInvoke(SCHEDULER_RELOAD)
}

// Utility Functions
export async function validateCronExpression(expression: string): Promise<CronValidationResult> {
    const response = await windowInvoke(CRON_VALIDATE, { expression })
    return response
}

export async function calculateNextRunTime(expression: string): Promise<Date> {
    const response = await windowInvoke(CRON_NEXT_RUN_TIME, { expression })
    return response
}

// Async message sending for real-time updates
export function sendScheduleMessage(channel: string, data?: any): void {
    windowSend(channel, data)
} 
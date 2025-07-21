import { ipcMain } from 'electron';
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
} from '@/config/channellist';
import { ScheduleController } from '@/controller/ScheduleController';
import { CommonResponse, CommonMessage } from "@/entityTypes/commonType";
import { CustomError } from '@/modules/customError';
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
} from '@/entityTypes/schedule-type';
import { TaskType } from '@/entity/ScheduleTask.entity';

export function registerScheduleIpcHandlers(): void {
    console.log("Schedule IPC handlers registered");
    
    // Schedule Management
    ipcMain.handle(SCHEDULE_CREATE, async (event, data): Promise<CommonMessage<number | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const scheduleData = JSON.parse(data) as ScheduleCreateRequest;
            const scheduleId = await scheduleCtrl.createSchedule(scheduleData);
            
            const response: CommonMessage<number> = {
                status: true,
                msg: "schedule.created_successfully",
                data: scheduleId
            };
            return response;
        } catch (error) {
            console.error('Schedule creation error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_UPDATE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id, ...scheduleData } = JSON.parse(data) as { id: number } & ScheduleUpdateRequest;
            await scheduleCtrl.updateSchedule(id, scheduleData);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "schedule.updated_successfully"
            };
            return response;
        } catch (error) {
            console.error('Schedule update error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_DELETE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id } = JSON.parse(data) as { id: number };
            await scheduleCtrl.deleteSchedule(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "schedule.deleted_successfully"
            };
            return response;
        } catch (error) {
            console.error('Schedule deletion error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_ENABLE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id } = JSON.parse(data) as { id: number };
            await scheduleCtrl.enableSchedule(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "schedule.enabled_successfully"
            };
            return response;
        } catch (error) {
            console.error('Schedule enable error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_DISABLE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id } = JSON.parse(data) as { id: number };
            await scheduleCtrl.disableSchedule(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "schedule.disabled_successfully"
            };
            return response;
        } catch (error) {
            console.error('Schedule disable error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_PAUSE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id } = JSON.parse(data) as { id: number };
            await scheduleCtrl.pauseSchedule(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "schedule.paused_successfully"
            };
            return response;
        } catch (error) {
            console.error('Schedule pause error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_RESUME, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id } = JSON.parse(data) as { id: number };
            await scheduleCtrl.resumeSchedule(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "schedule.resumed_successfully"
            };
            return response;
        } catch (error) {
            console.error('Schedule resume error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_RUN_NOW, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id } = JSON.parse(data) as { id: number };
            await scheduleCtrl.runScheduleNow(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "schedule.execution_started"
            };
            return response;
        } catch (error) {
            console.error('Schedule run now error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_LIST, async (event, data): Promise<CommonMessage<ScheduleListResponse | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { page = 0, size = 10, sort, filters } = JSON.parse(data) as {
                page?: number;
                size?: number;
                sort?: any;
                filters?: ScheduleFilterOptions;
            };
            
            const result = await scheduleCtrl.getScheduleList(page, size, sort);
            
            const response: CommonMessage<ScheduleListResponse> = {
                status: true,
                msg: "schedule.list_retrieved",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Schedule list error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_DETAIL, async (event, data): Promise<CommonMessage<ScheduleDetailResponse | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { id } = JSON.parse(data) as { id: number };
            const result = await scheduleCtrl.getScheduleById(id);
            
            const response: CommonMessage<ScheduleDetailResponse> = {
                status: true,
                msg: "schedule.detail_retrieved",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Schedule detail error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_BY_TASK_TYPE, async (event, data): Promise<CommonMessage<any[] | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { taskType } = JSON.parse(data) as { taskType: TaskType };
            const result = await scheduleCtrl.getSchedulesByTaskType(taskType);
            
            const response: CommonMessage<any[]> = {
                status: true,
                msg: "schedule.list_by_task_type",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Schedule by task type error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_SEARCH, async (event, data): Promise<CommonMessage<ScheduleListResponse | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const searchRequest = JSON.parse(data) as ScheduleSearchRequest;
            const result = await scheduleCtrl.getScheduleList(
                searchRequest.page || 0,
                searchRequest.size || 10,
                searchRequest.sort
            );
            
            const response: CommonMessage<ScheduleListResponse> = {
                status: true,
                msg: "schedule.search_completed",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Schedule search error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Execution Management
    ipcMain.handle(EXECUTION_HISTORY, async (event, data): Promise<CommonMessage<ExecutionHistoryResponse | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { scheduleId, page = 0, size = 10 } = JSON.parse(data) as {
                scheduleId: number;
                page?: number;
                size?: number;
            };
            const result = await scheduleCtrl.getExecutionHistory(scheduleId, page, size);
            
            const response: CommonMessage<ExecutionHistoryResponse> = {
                status: true,
                msg: "execution.history_retrieved",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Execution history error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(EXECUTION_STATISTICS, async (event, data): Promise<CommonMessage<ExecutionStatistics | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { scheduleId } = JSON.parse(data) as { scheduleId: number };
            const result = await scheduleCtrl.getExecutionStatistics(scheduleId);
            
            const response: CommonMessage<ExecutionStatistics | null> = {
                status: true,
                msg: "execution.statistics_retrieved",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Execution statistics error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(EXECUTION_RECENT, async (event, data): Promise<CommonMessage<any[] | null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { limit = 10 } = JSON.parse(data) as { limit?: number };
            const result = await scheduleCtrl.getRecentExecutions(limit);
            
            const response: CommonMessage<any[]> = {
                status: true,
                msg: "execution.recent_retrieved",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Recent executions error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Dependency Management
    ipcMain.handle(DEPENDENCY_ADD, async (event, data): Promise<CommonMessage<number|null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { parentId, childId, ...dependencyData } = JSON.parse(data) as {
                parentId: number;
                childId: number;
            } & DependencyCreateRequest;
            const dependencyId = await scheduleCtrl.addDependency(parentId, childId, dependencyData);
            
            const response: CommonMessage<number> = {
                status: true,
                msg: "dependency.added_successfully",
                data: dependencyId
            };
            return response;
        } catch (error) {
            console.error('Dependency add error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(DEPENDENCY_REMOVE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { parentId, childId } = JSON.parse(data) as { parentId: number; childId: number };
            await scheduleCtrl.removeDependency(parentId, childId);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "dependency.removed_successfully"
            };
            return response;
        } catch (error) {
            console.error('Dependency remove error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(DEPENDENCY_GRAPH, async (event, data): Promise<CommonMessage<DependencyGraphResponse|null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { scheduleId } = JSON.parse(data) as { scheduleId: number };
            const result = await scheduleCtrl.getDependencyGraph(scheduleId);
            
            const response: CommonMessage<DependencyGraphResponse|null> = {
                status: true,
                msg: "dependency.graph_retrieved",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Dependency graph error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(DEPENDENCY_VALIDATE, async (event, data): Promise<CommonMessage<DependencyValidationResponse|null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const { scheduleId } = JSON.parse(data) as { scheduleId: number };
            const result = await scheduleCtrl.validateDependencies(scheduleId);
            
            // Convert DependencyValidationResult to DependencyValidationResponse
            const validationResponse: DependencyValidationResponse = {
                isValid: result.isValid,
                errors: result.errors,
                warnings: [] // DependencyValidationResult doesn't have warnings property
            };
            
            const response: CommonMessage<DependencyValidationResponse> = {
                status: true,
                msg: "dependency.validation_completed",
                data: validationResponse
            };
            return response;
        } catch (error) {
            console.error('Dependency validation error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Scheduler Management
    ipcMain.handle(SCHEDULER_STATUS, async (event): Promise<CommonMessage<SchedulerStatusResponse|null>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            const result = scheduleCtrl.getSchedulerStatus();
            
            const response: CommonMessage<SchedulerStatusResponse> = {
                status: true,
                msg: "scheduler.status_retrieved",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Scheduler status error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULER_START, async (event): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            await scheduleCtrl.startScheduler();
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "scheduler.started_successfully"
            };
            return response;
        } catch (error) {
            console.error('Scheduler start error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULER_STOP, async (event): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            await scheduleCtrl.stopScheduler();
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "scheduler.stopped_successfully"
            };
            return response;
        } catch (error) {
            console.error('Scheduler stop error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULER_RELOAD, async (event): Promise<CommonMessage<void>> => {
        try {
            const scheduleCtrl = new ScheduleController();
            await scheduleCtrl.stopScheduler();
            await scheduleCtrl.startScheduler();
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "scheduler.reloaded_successfully"
            };
            return response;
        } catch (error) {
            console.error('Scheduler reload error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    // Utility Functions
    ipcMain.handle(CRON_VALIDATE, async (event, data): Promise<CommonMessage<CronValidationResult|null>> => {
        try {
            const { expression } = JSON.parse(data) as { expression: string };
            // This would need to be implemented in the ScheduleManager or a utility class
            // For now, we'll return a basic validation result
            const isValid = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/.test(expression);
            
            const result: CronValidationResult = {
                isValid,
                errors: isValid ? [] : ["Invalid cron expression format"],
                nextRunTimes: isValid ? [] : [],
                description: isValid ? "Valid cron expression" : "Invalid cron expression"
            };
            
            const response: CommonMessage<CronValidationResult> = {
                status: true,
                msg: "cron.validation_completed",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Cron validation error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(CRON_NEXT_RUN_TIME, async (event, data): Promise<CommonMessage<Date|null>> => {
        try {
            const { expression } = JSON.parse(data) as { expression: string };
            const scheduleCtrl = new ScheduleController();
            const nextRunTime = scheduleCtrl.calculateNextRunTime(expression);
            
            const response: CommonMessage<Date> = {
                status: true,
                msg: "cron.next_run_time_calculated",
                data: nextRunTime
            };
            return response;
        } catch (error) {
            console.error('Cron next run time calculation error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Import/Export functionality (placeholder implementations)
    ipcMain.handle(SCHEDULE_EXPORT, async (event, data): Promise<CommonMessage<ScheduleExportData|null>> => {
        try {
            // Placeholder implementation
            const result: ScheduleExportData = {
                schedules: [],
                dependencies: [],
                version: "1.0.0",
                exportDate: new Date()
            };
            
            const response: CommonMessage<ScheduleExportData|null> = {
                status: true,
                msg: "schedule.export_completed",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Schedule export error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(SCHEDULE_IMPORT, async (event, data): Promise<CommonMessage<ScheduleImportResult|null>> => {
        try {
            // Placeholder implementation
            const importRequest = JSON.parse(data) as ScheduleImportRequest;
            const result: ScheduleImportResult = {
                success: true,
                importedSchedules: 0,
                importedDependencies: 0,
                errors: [],
                warnings: []
            };
            
            const response: CommonMessage<ScheduleImportResult> = {
                status: true,
                msg: "schedule.import_completed",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Schedule import error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });
} 
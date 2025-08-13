import { ipcMain } from 'electron';
import { 
    YELLOW_PAGES_CREATE,
    YELLOW_PAGES_UPDATE,
    YELLOW_PAGES_DELETE,
    YELLOW_PAGES_START,
    YELLOW_PAGES_STOP,
    YELLOW_PAGES_PAUSE,
    YELLOW_PAGES_RESUME,
    YELLOW_PAGES_LIST,
    YELLOW_PAGES_DETAIL,
    YELLOW_PAGES_PROGRESS,
    YELLOW_PAGES_RESULTS,
    YELLOW_PAGES_EXPORT,
    YELLOW_PAGES_BULK,
    YELLOW_PAGES_HEALTH,
    YELLOW_PAGES_PLATFORMS,
    YELLOW_PAGES_STATISTICS
} from '@/config/channellist';
import { YellowPagesController } from '@/controller/YellowPagesController';
import { CommonMessage } from "@/entityTypes/commonType";
import { 
    YellowPagesTaskData, 
    YellowPagesTask, 
    TaskFilters, 
    TaskSummary, 
    TaskProgress, 
    YellowPagesResult 
} from '@/interfaces/ITaskManager';

export function registerYellowPagesIpcHandlers(): void {
    console.log("Yellow Pages IPC handlers registered");
    
    // Task Management
    ipcMain.handle(YELLOW_PAGES_CREATE, async (event, data): Promise<CommonMessage<number | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const taskData = JSON.parse(data) as YellowPagesTaskData;
            const taskId = await yellowPagesCtrl.createTask(taskData);
            
            const response: CommonMessage<number> = {
                status: true,
                msg: "yellow_pages.task_created_successfully",
                data: taskId
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task creation error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });
    // update yellow pages task
    ipcMain.handle(YELLOW_PAGES_UPDATE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id, ...taskData } = JSON.parse(data) as { id: number } & Partial<YellowPagesTask>;
            await yellowPagesCtrl.updateTask(id, taskData);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "yellow_pages.task_updated_successfully"
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task update error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_DELETE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            await yellowPagesCtrl.deleteTask(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "yellow_pages.task_deleted_successfully"
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task deletion error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    // Task Control Operations
    ipcMain.handle(YELLOW_PAGES_START, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            await yellowPagesCtrl.startTask(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "yellow_pages.task_started_successfully"
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task start error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_STOP, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            await yellowPagesCtrl.stopTask(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "yellow_pages.task_stopped_successfully"
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task stop error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_PAUSE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            await yellowPagesCtrl.pauseTask(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "yellow_pages.task_paused_successfully"
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task pause error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_RESUME, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            await yellowPagesCtrl.resumeTask(id);
            
            const response: CommonMessage<void> = {
                status: true,
                msg: "yellow_pages.task_resumed_successfully"
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task resume error:', error);
            const errorResponse: CommonMessage<void> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return errorResponse;
        }
    });

    // list yellow pages tasks
    ipcMain.handle(YELLOW_PAGES_LIST, async (event, data): Promise<CommonMessage<TaskSummary[] | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const filters = data ? JSON.parse(data) as TaskFilters : undefined;
            const tasks = await yellowPagesCtrl.listTasks(filters);
            
            const response: CommonMessage<TaskSummary[]> = {
                status: true,
                msg: "yellow_pages.tasks_retrieved_successfully",
                data: tasks
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages tasks list error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_DETAIL, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            const taskDetails = await yellowPagesCtrl.getTask(id);
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "yellow_pages.task_detail_retrieved_successfully",
                data: taskDetails
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task detail error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_PROGRESS, async (event, data): Promise<CommonMessage<TaskProgress | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            const progress = await yellowPagesCtrl.getTaskProgress(id);
            
            const response: CommonMessage<TaskProgress> = {
                status: true,
                msg: "yellow_pages.task_progress_retrieved_successfully",
                data: progress
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task progress error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_RESULTS, async (event, data): Promise<CommonMessage<YellowPagesResult[] | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id } = JSON.parse(data) as { id: number };
            const results = await yellowPagesCtrl.getTaskResults(id);
            
            const response: CommonMessage<YellowPagesResult[]> = {
                status: true,
                msg: "yellow_pages.task_results_retrieved_successfully",
                data: results
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task results error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_EXPORT, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { id, format = 'json' } = JSON.parse(data) as { id: number; format?: 'json' | 'csv' };
            const exportData = await yellowPagesCtrl.exportTaskResults(id, format);
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "yellow_pages.task_results_exported_successfully",
                data: exportData
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages task export error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // Bulk Operations
    ipcMain.handle(YELLOW_PAGES_BULK, async (event, data): Promise<CommonMessage<any | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const { operation, taskIds } = JSON.parse(data) as { 
                operation: 'start' | 'stop' | 'pause' | 'delete'; 
                taskIds: number[] 
            };
            const bulkResult = await yellowPagesCtrl.bulkOperations(operation, taskIds);
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "yellow_pages.bulk_operation_completed_successfully",
                data: bulkResult
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages bulk operation error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    // System Operations
    ipcMain.handle(YELLOW_PAGES_HEALTH, async (event): Promise<CommonMessage<any | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const healthStatus = await yellowPagesCtrl.getHealthStatus();
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "yellow_pages.health_status_retrieved_successfully",
                data: healthStatus
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages health status error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_PLATFORMS, async (event): Promise<CommonMessage<any[] | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const platforms = await yellowPagesCtrl.getAvailablePlatforms();
            
            const response: CommonMessage<any[]> = {
                status: true,
                msg: "yellow_pages.platforms_retrieved_successfully",
                data: platforms
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages platforms error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });

    ipcMain.handle(YELLOW_PAGES_STATISTICS, async (event): Promise<CommonMessage<any | null>> => {
        try {
            const yellowPagesCtrl = new YellowPagesController();
            const statistics = await yellowPagesCtrl.getTaskStatistics();
            
            const response: CommonMessage<any> = {
                status: true,
                msg: "yellow_pages.statistics_retrieved_successfully",
                data: statistics
            };
            return response;
        } catch (error) {
            console.error('Yellow Pages statistics error:', error);
            const errorResponse: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
            return errorResponse;
        }
    });
}

"use strict";

import { windowInvoke } from '@/views/utils/apirequest'
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
} from '@/config/channellist'
import { CommonResponse, CommonMessage } from "@/entityTypes/commonType"
import { 
    YellowPagesTaskData, 
    YellowPagesTask, 
    TaskFilters, 
    TaskSummary, 
    TaskProgress, 
    YellowPagesResult 
} from '@/interfaces/ITaskManager'
// import { PlatformConfig } from '@/interfaces/IPlatformConfig'
import { PlatformSummary } from '@/interfaces/IPlatformConfig';

// Task Management
export async function createYellowPagesTask(taskData: YellowPagesTaskData): Promise<number | null> {
    const resp = await windowInvoke(YELLOW_PAGES_CREATE, taskData)
    console.log("createYellowPagesTask")
    console.log(resp)
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function updateYellowPagesTask(id: number, taskData: Partial<YellowPagesTask>): Promise<void> {
    const resp = await windowInvoke(YELLOW_PAGES_UPDATE, { id, ...taskData })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function deleteYellowPagesTask(id: number): Promise<void> {
    const resp = await windowInvoke(YELLOW_PAGES_DELETE, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

// Task Control Operations
export async function startYellowPagesTask(id: number): Promise<number> {
    const resp = await windowInvoke(YELLOW_PAGES_START, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function stopYellowPagesTask(id: number): Promise<void> {
    const resp = await windowInvoke(YELLOW_PAGES_STOP, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function pauseYellowPagesTask(id: number): Promise<void> {
    const resp = await windowInvoke(YELLOW_PAGES_PAUSE, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function resumeYellowPagesTask(id: number): Promise<void> {
    const resp = await windowInvoke(YELLOW_PAGES_RESUME, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

// Task Information Operations
export async function getYellowPagesTaskList(filters?: TaskFilters): Promise<TaskSummary[] | null> {
    const resp = await windowInvoke(YELLOW_PAGES_LIST, filters)
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function getYellowPagesTaskDetail(id: number): Promise<any | null> {
    const resp = await windowInvoke(YELLOW_PAGES_DETAIL, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function getYellowPagesTaskProgress(id: number): Promise<TaskProgress | null> {
    const resp = await windowInvoke(YELLOW_PAGES_PROGRESS, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function getYellowPagesTaskResults(id: number): Promise<YellowPagesResult[] | null> {
    const resp = await windowInvoke(YELLOW_PAGES_RESULTS, { id })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function exportYellowPagesTaskResults(id: number, format: 'json' | 'csv' = 'json'): Promise<any | null> {
    const resp = await windowInvoke(YELLOW_PAGES_EXPORT, { id, format })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

// Bulk Operations
export async function bulkYellowPagesOperations(
    operation: 'start' | 'stop' | 'pause' | 'delete', 
    taskIds: number[]
): Promise<CommonMessage<any | null>> {
    const resp = await windowInvoke(YELLOW_PAGES_BULK, { operation, taskIds })
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

// System Operations
export async function getYellowPagesHealthStatus(): Promise<any | null> {
    const resp = await windowInvoke(YELLOW_PAGES_HEALTH)
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}

export async function getYellowPagesPlatforms(): Promise<PlatformSummary[] | null> {
    const resp = await windowInvoke(YELLOW_PAGES_PLATFORMS)
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    console.log("getYellowPagesPlatforms")
    console.log(resp)
    return resp
}

export async function getYellowPagesStatistics(): Promise<any | null> {
    const resp = await windowInvoke(YELLOW_PAGES_STATISTICS)
    
    if (!resp) {
        throw new Error("Unknown error")
    }
    
    return resp
}


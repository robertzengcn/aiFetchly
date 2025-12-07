import { Usersearchdata } from "@/entityTypes/searchControlType"
import { SEARCHSCRAPERAPI } from '@/config/channellist'
import { SearchtaskItem,SearchResultFetchparam } from "@/entityTypes/searchControlType"
import { SearchResult} from '@/views/api/types'
import { windowInvoke,windowReceive,windowSend } from '@/views/utils/apirequest'
import {LISTSESARCHRESUT,TASKSEARCHRESULTLIST,SAVESEARCHERRORLOG,RETRYSEARCHTASK,GET_SEARCH_TASK_DETAILS,UPDATE_SEARCH_TASK,SEARCH_TASK_UPDATE_EVENT,CREATE_SEARCH_TASK_ONLY,EXPORT_SEARCH_RESULTS,KILL_SEARCH_PROCESS,AI_KEYWORDS_GENERATE,ANALYZE_WEBSITE,ANALYZE_WEBSITE_PROGRESS} from "@/config/channellist";
import {SearchResEntityDisplay} from "@/entityTypes/scrapeType"
import {ItemSearchparam} from "@/entityTypes/commonType"
import {TaskDetailsForEdit, SearchTaskUpdateData} from "@/modules/SearchModule"
//import {CommonDialogMsg} from "@/entityTypes/commonType";
// import { ipcMain} from 'electron'


export async function submitScraper(data: Usersearchdata) {
    
    windowSend(SEARCHSCRAPERAPI, data) 
    
    // return resp 
}

export async function listSearchresult(data: ItemSearchparam): Promise<SearchResult<SearchtaskItem>> {
    const resp = await windowInvoke(LISTSESARCHRESUT, data);
    console.log(resp)
    if (!resp) {
        throw new Error("unknow error")
    }
    const resdata: SearchResult<SearchtaskItem> = {
        data: resp.records,
        total: resp.num,
    }
    return resdata;
}
export function receiveSearchevent(channel:string,cb:(data:any)=>void){
   
    windowReceive(channel,cb)
}
export async function gettaskresult(res:SearchResultFetchparam):Promise<SearchResult<SearchResEntityDisplay>> {
   console.log("get task result")
    const resp = await windowInvoke(TASKSEARCHRESULTLIST, res);
    console.log(resp)
    if (!resp) {
        throw new Error("unknow error")
    }
    const resdata: SearchResult<SearchResEntityDisplay> = {
        data: resp.records,
        total: resp.num,
    }
    return resdata;
}
export async function Errorlogquery(id:number){
    const res=await windowInvoke(SAVESEARCHERRORLOG,{id:id})
    return res
}

export async function retrySearchTask(id: number) {
    await windowSend(RETRYSEARCHTASK, { id: id });
    // return res;
}

/**
 * Get search task details for editing
 * @param taskId The task ID
 * @returns Task details
 */
export async function getSearchTaskDetails(taskId: number): Promise<TaskDetailsForEdit> {
    const resp = await windowInvoke(GET_SEARCH_TASK_DETAILS, { id: taskId });
    if (!resp) {
        throw new Error("Unknown error");
    }
    return resp;
}

/**
 * Update search task
 * @param taskId The task ID
 * @param updates The update data
 * @returns Update result
 */
export async function updateSearchTask(taskId: number, updates: SearchTaskUpdateData): Promise<boolean> {
    const resp = await windowInvoke(UPDATE_SEARCH_TASK, { id: taskId, updates: updates });
    if (!resp) {
        throw new Error("Unknown error");
    }
    return resp;
}

/**
 * Listen for search task update events
 * @param callback The callback function to handle events
 */
export function receiveSearchTaskUpdateEvent(callback: (data: unknown) => void) {
    windowReceive(SEARCH_TASK_UPDATE_EVENT, callback);
}

/**
 * Create a search task without running it
 * @param data Search task data
 * @returns Promise with task ID or error
 */
export async function createSearchTaskOnly(data: Usersearchdata): Promise<number> {
    const resp = await windowInvoke(CREATE_SEARCH_TASK_ONLY, data);
    if (!resp) {
        throw new Error("Unknown error");
    }
    return resp;
}

/**
 * Export search results for a task
 * @param taskId The task ID
 * @param format Export format ('json' or 'csv')
 * @returns Promise with file path or error
 */
export async function exportSearchResults(taskId: number, format: 'json' | 'csv' = 'csv'): Promise<string> {
    const resp = await windowInvoke(EXPORT_SEARCH_RESULTS, { taskId, format });
    if (!resp) {
        throw new Error(resp?.msg || "Unknown error");
    }
    return resp;
}

/**
 * Kill a search process
 * @param pid Optional process ID
 * @param taskId Optional task ID
 * @returns Promise with kill result
 */
export async function killSearchProcess(pid?: number, taskId?: number): Promise<{success: boolean, taskId?: number, pid?: number, message: string}> {
    const resp = await windowInvoke(KILL_SEARCH_PROCESS, { pid, taskId });
    if (!resp) {
        throw new Error("Unknown error");
    }
    return resp;
}

/**
 * Generate related keywords using AI
 * @param keywords Array of seed keywords
 * @param numKeywords Number of keywords to generate per seed (default: 15)
 * @param keywordType Type of keywords to generate (default: 'seo')
 * @returns Promise with array of generated keywords
 */
export async function generateRelatedKeywords(
    keywords: string[],
    numKeywords: number = 15,
    keywordType: string = 'seo'
): Promise<string[]> {
    const resp = await windowInvoke(AI_KEYWORDS_GENERATE, {
        keywords,
        num_keywords: numKeywords,
        keyword_type: keywordType
    });
    if (!resp) {
        throw new Error("Unknown error");
    }
    return resp;
}

/**
 * Batch analysis request item
 */
export interface AnalyzeWebsiteBatchItem {
    resultId: number;
    url: string;
}

/**
 * Batch analysis request
 */
export interface AnalyzeWebsiteBatchRequest {
    items: AnalyzeWebsiteBatchItem[];
    clientBusiness: string;
    temperature: number;
}

/**
 * Batch analysis response
 */
export interface AnalyzeWebsiteBatchResponse {
    batchId: string;
    total: number;
}

/**
 * Progress update data
 */
export interface AnalyzeWebsiteProgressData {
    batchId: string;
    completed: number;
    total: number;
}

/**
 * Start batch website analysis
 * @param request Batch analysis request
 * @returns Promise with batch analysis response
 */
export async function analyzeWebsiteBatch(request: AnalyzeWebsiteBatchRequest): Promise<AnalyzeWebsiteBatchResponse> {
    const resp = await windowInvoke(ANALYZE_WEBSITE, request);
    if (!resp) {
        throw new Error("Failed to start batch analysis");
    }
    return resp;
}

/**
 * Listen for website analysis progress updates
 * @param callback The callback function to handle progress updates
 */
export function receiveAnalyzeWebsiteProgress(callback: (data: AnalyzeWebsiteProgressData) => void): void {
    windowReceive(ANALYZE_WEBSITE_PROGRESS, (event: unknown) => {
        try {
            // windowReceive passes the event object, extract data from it
            const eventData = event as { data?: string } | string;
            const progressData = typeof eventData === 'string' ? eventData : (eventData.data || '');
            if (!progressData) return;
            
            const progress = JSON.parse(progressData) as AnalyzeWebsiteProgressData;
            callback(progress);
        } catch (error) {
            console.error('Error parsing progress data:', error);
        }
    });
}
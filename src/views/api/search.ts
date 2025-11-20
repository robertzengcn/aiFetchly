import { Usersearchdata } from "@/entityTypes/searchControlType"
import { SEARCHSCRAPERAPI } from '@/config/channellist'
import { SearchtaskItem,SearchResultFetchparam } from "@/entityTypes/searchControlType"
import { SearchResult} from '@/views/api/types'
import { windowInvoke,windowReceive,windowSend } from '@/views/utils/apirequest'
import {LISTSESARCHRESUT,TASKSEARCHRESULTLIST,SAVESEARCHERRORLOG,RETRYSEARCHTASK,GET_SEARCH_TASK_DETAILS,UPDATE_SEARCH_TASK,SEARCH_TASK_UPDATE_EVENT,CREATE_SEARCH_TASK_ONLY,EXPORT_SEARCH_RESULTS,KILL_SEARCH_PROCESS} from "@/config/channellist";
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
    if (!resp || !resp.status) {
        throw new Error(resp?.msg || "Unknown error");
    }
    return resp.data;
}
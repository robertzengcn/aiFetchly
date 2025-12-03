import {EmailscFormdata,EmailResultDisplay,EmailsearchtaskResultquery} from '@/entityTypes/emailextraction-type'
import { windowInvoke,windowReceive,windowSend } from '@/views/utils/apirequest'
import {EMAILEXTRACTIONAPI, EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD, GETEMAILSEARCHTASK, UPDATEEMAILSEARCHTASK, DELETEEMAILSEARCHTASK, EMAILEXTRACTION_RESULT_EXPORT} from '@/config/channellist'
import { SearchResult} from '@/views/api/types'
import {ItemSearchparam} from "@/entityTypes/commonType"
import {LISTEMAILSEARCHTASK,EMAILSEARCHTASKRESULT} from "@/config/channellist";
// import { CommonResponse } from "@/entityTypes/commonType"
import {EmailsearchTaskEntityDisplay} from '@/entityTypes/emailextraction-type'

/**
 * Submits a new email extraction task to the backend
 * @param data - The email extraction form data containing URLs, settings, and configuration
 * @returns Promise that resolves when the task is submitted successfully
 * @throws Error if the submission fails
 */
export async function submitScraper(data: EmailscFormdata) {
    
    await windowSend(EMAILEXTRACTIONAPI, data) 
    
    // return resp 
}
/**
 * Retrieves a list of email extraction tasks with pagination support
 * @param data - Search parameters including pagination, filters, and sorting options
 * @returns Promise that resolves to a SearchResult containing task data and total count
 * @throws Error if the request fails or returns invalid data
 */
export async function listEmailSearchtasks(data: ItemSearchparam): Promise<SearchResult<EmailsearchTaskEntityDisplay>> {
    const resp = await windowInvoke(LISTEMAILSEARCHTASK, data);
    //console.log(resp)
    if (!resp) {
        throw new Error("unknow error")
    }
    const resdata: SearchResult<EmailsearchTaskEntityDisplay> = {
        data: resp.records,
        total: resp.num,
    }
    return resdata;
}
/**
 * Retrieves detailed results for a specific email extraction task
 * @param data - Query parameters including task ID and result filtering options
 * @returns Promise that resolves to a SearchResult containing email extraction results
 * @throws Error if the request fails or the task is not found
 */
export async function getEmailtaskdetail(data: EmailsearchtaskResultquery){
    const resp = await windowInvoke(EMAILSEARCHTASKRESULT, data);
    if (!resp) {
        throw new Error("unknow error")
    }
    // EmailResultDisplay
    const resdata: SearchResult<EmailResultDisplay> = {
        data: resp.records,
        total: resp.num,
    }
    return resdata;

}

/**
 * Sets up event listener for email extraction task events
 * @param channel - The IPC channel name to listen on
 * @param cb - Callback function to handle received events
 */
export function receiveSearchEmailevent(channel:string,cb:(data:any)=>void){
   
    windowReceive(channel,cb)
}

/**
 * Downloads the error log for a specific email extraction task
 * @param id - The task ID to download the error log for
 * @returns Promise that resolves to the error log content as a string
 * @throws Error if the log file is not found or the download fails
 */
export async function downloadErrorLog(id: number): Promise<string> {
    try {
        const querydata = { id: id }
        const res = await windowInvoke(EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD, querydata)
        console.log(res)
        return res
        
    } catch (error) {
        console.error('Error downloading log:', error)
        throw error
    }
}

/**
 * Retrieves a single email extraction task by ID for editing purposes
 * @param taskId - The unique identifier of the task to retrieve
 * @returns Promise that resolves to the task data object
 * @throws Error if the task is not found or the request fails
 */
export async function getEmailSearchTask(taskId: number): Promise<any> {
    try {
        const querydata = { id: taskId }
        const resp = await windowInvoke(GETEMAILSEARCHTASK, querydata)
        if (!resp) {
            throw new Error(resp?.msg || "Failed to get task")
        }
        console.log("resp", resp)
        return resp
    } catch (error) {
        console.error('Error getting task:', error)
        throw error
    }
}

/**
 * Updates an existing email extraction task with new data
 * @param taskId - The unique identifier of the task to update
 * @param data - The updated form data for the task
 * @returns Promise that resolves to a success message
 * @throws Error if the task cannot be updated (e.g., running/completed tasks) or the request fails
 */
export async function updateEmailSearchTask(taskId: number, data: EmailscFormdata): Promise<string> {
    try {
        const querydata = { id: taskId, data: data }
        const resp = await windowInvoke(UPDATEEMAILSEARCHTASK, querydata)
        if (!resp || !resp.status) {
            throw new Error(resp?.msg || "Failed to update task")
        }
        return resp.data
    } catch (error) {
        console.error('Error updating task:', error)
        throw error
    }
}

/**
 * Deletes an email extraction task and all its associated data
 * @param taskId - The unique identifier of the task to delete
 * @returns Promise that resolves to a success message
 * @throws Error if the task cannot be deleted (e.g., running tasks) or the request fails
 */
export async function deleteEmailSearchTask(taskId: number): Promise<string> {
    try {
        const querydata = { id: taskId }
        const resp = await windowInvoke(DELETEEMAILSEARCHTASK, querydata)
        if (!resp || !resp.status) {
            throw new Error(resp?.msg || "Failed to delete task")
        }
        return resp.data
    } catch (error) {
        console.error('Error deleting task:', error)
        throw error
    }
}

/**
 * Export email extraction results for a task
 * @param taskId The task ID
 * @param format Export format ('json' or 'csv')
 * @returns Promise with file path or error
 */
export async function exportEmailResults(taskId: number, format: 'json' | 'csv' = 'csv'): Promise<string> {
    try {
        const querydata = { taskId, format }
        const resp = await windowInvoke(EMAILEXTRACTION_RESULT_EXPORT, querydata)
        if (!resp) {
            throw new Error(resp?.msg || "Failed to export results")
        }
        return resp
    } catch (error) {
        console.error('Error exporting results:', error)
        throw error
    }
}
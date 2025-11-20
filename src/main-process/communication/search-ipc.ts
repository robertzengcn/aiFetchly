import { ipcMain, dialog, app } from 'electron';
import { SEARCHSCRAPERAPI, LISTSESARCHRESUT, SEARCHEVENT, TASKSEARCHRESULTLIST, SAVESEARCHERRORLOG, RETRYSEARCHTASK, SYSTEM_MESSAGE, GET_SEARCH_TASK_DETAILS, UPDATE_SEARCH_TASK, SEARCH_TASK_UPDATE_EVENT, CREATE_SEARCH_TASK_ONLY, EXPORT_SEARCH_RESULTS, KILL_SEARCH_PROCESS } from '@/config/channellist'
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { Usersearchdata, SearchtaskItem, SearchResultFetchparam } from "@/entityTypes/searchControlType"
import { SearchController } from "@/controller/SearchController"
import { CommonResponse, CommonMessage } from "@/entityTypes/commonType"
import { SearchTaskUpdateData,TaskDetailsForEdit } from "@/modules/SearchModule"
import { SearchResEntity } from "@/entityTypes/scrapeType"
//import {  } from "@/modules/SearchModule"
import * as path from 'path';
import * as fs from 'fs';
import { ItemSearchparam } from "@/entityTypes/commonType"
import { SearhEnginer } from "@/config/searchSetting"
import { ToArray } from "@/views/utils/function"

export function registerSearchIpcHandlers(): void {
    ipcMain.on(SEARCHSCRAPERAPI, async (event, arg): Promise<void> => {

        //handle search event
        const qdata = JSON.parse(arg) as Usersearchdata;
        if (!("searchEnginer" in qdata)) {

            const comMsgs: CommonDialogMsg = {
                status: false,
                code: 20240705103811,
                data: {
                    action: "",
                    title: "search.scraper_failed",
                    content: "search.search_enginer_empty"
                }
            }
            event.sender.send(SEARCHEVENT, JSON.stringify(comMsgs))
            return
        }
        if (!("keywords" in qdata)) {
            const comMsgs: CommonDialogMsg = {
                status: false,
                code: 20240705104323,
                data: {
                    action: "",
                    title: "search.scraper_failed",
                    content: "search.search_enginer_empty"
                }
            }
            event.sender.send(SEARCHEVENT, JSON.stringify(comMsgs))
            return
        }
        if (typeof qdata.concurrency === 'string') {
            qdata.concurrency = parseInt(qdata.concurrency, 10);
            if (isNaN(qdata.concurrency)) {
                // throw new Error("Invalid number format");
                qdata.concurrency = 1
            }
        }
        if (typeof qdata.num_pages === 'string') {
            qdata.num_pages = parseInt(qdata.num_pages, 10);
            if (isNaN(qdata.num_pages)) {
                // throw new Error("Invalid number format");
                qdata.num_pages = 1
            }
        }
        //valid search enginer 
        const seArr: string[] = ToArray(SearhEnginer);
        if (!seArr.includes(qdata.searchEnginer)) {
            const comMsgs: CommonDialogMsg = {
                status: false,
                code: 20240705103811,
                data: {
                    action: "",
                    title: "search.scraper_failed",
                    content: "search.search_enginer_invalid"
                }
            }
            event.sender.send(SEARCHEVENT, JSON.stringify(comMsgs))
            return
        }

        const searchcon = SearchController.getInstance()
        await searchcon.searchData(qdata)
        const comMsgs: CommonDialogMsg = {
            status: true,
            code: 0,
            data: {
                action: "search_task _start",
                title: "",
                content: ""
            }
        }
        event.sender.send(SEARCHEVENT, JSON.stringify(comMsgs))
        //return comMsgs
    })
    ipcMain.handle(LISTSESARCHRESUT, async (event, data): Promise<CommonResponse<SearchtaskItem>> => {
        const qdata = JSON.parse(data) as ItemSearchparam;

        //console.log("handle campaign:list")
        const searchControl = SearchController.getInstance()
        const res = await searchControl.listSearchresult(qdata.page, qdata.size, qdata.sortby, qdata.search)
        const resp: CommonResponse<SearchtaskItem> = {
            status: true,
            msg: "",
            data: {
                records: res.records,
                num: res.total
            }
        }
        return resp
        // return res as CommonResponse<SearchtaskEntityNum>;
    });
    //return the result list in search task
    ipcMain.handle(TASKSEARCHRESULTLIST, async (event, data): Promise<CommonResponse<SearchResEntity>> => {
        const qdata = JSON.parse(data) as SearchResultFetchparam;
        if (!("taskId" in qdata)) {
            const resp: CommonResponse<SearchResEntity> = {
                status: false,
                msg: "task id is empty",

            }
            return resp
        }

        const searchControl = SearchController.getInstance()
        const res = await searchControl.listtaskSearchResult(qdata.taskId, qdata.page, qdata.itemsPerPage, qdata.search)
        const resp: CommonResponse<SearchResEntity> = {
            status: true,
            msg: "",
            data: {
                records: res.record,
                num: res.total
            }
        }
        return resp
    });

    ipcMain.handle(SAVESEARCHERRORLOG, async (event, data): Promise<string | undefined> => {
        const qdata = JSON.parse(data) as { id: number };
        const { filePath } = await dialog.showSaveDialog({
            title: 'Save Text File',
            defaultPath: path.join(app.getPath('documents'), qdata.id.toString() + '_search-error-log.txt'),
            filters: [{ name: 'Text Files', extensions: ['txt'] }]
        });
        if (filePath) {
            // console.log(filePath)
            // console.log(qdata.id)
            if (qdata.id) {
                const searchControl = SearchController.getInstance()
                const content = await searchControl.getTaskErrorlog(qdata.id)
                fs.writeFileSync(filePath, content, 'utf-8');
                return filePath;
            }
        }
        return undefined;
    })

    ipcMain.on(RETRYSEARCHTASK, async (event, data): Promise<void> => {
        const qdata = JSON.parse(data) as { id: number };
        if (!qdata.id) {
            const resp: CommonResponse<any> = {
                status: false,
                msg: "task id is empty",
            }
            event.sender.send(SYSTEM_MESSAGE, JSON.stringify(resp))
            return;
        }

        try {
            const searchControl = SearchController.getInstance();
            await searchControl.retryTask(qdata.id);
            const resp: CommonResponse<any> = {
                status: true,
                msg: "Task retry started successfully",
            }
            event.sender.send(SYSTEM_MESSAGE, JSON.stringify(resp))
            return;
        } catch (error) {
            const resp: CommonResponse<any> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
            }
            event.sender.send(SYSTEM_MESSAGE, JSON.stringify(resp))
            return;
        }
    });

    // Get search task details for editing
    ipcMain.handle(GET_SEARCH_TASK_DETAILS, async (event, data): Promise<CommonMessage<TaskDetailsForEdit>> => {
        const qdata = JSON.parse(data) as { id: number };
        if (!qdata.id) {
            const resp: CommonMessage<TaskDetailsForEdit> = {
                status: false,
                msg: "Task ID is required",
            }
            return resp;
        }

        try {
            const searchControl = SearchController.getInstance();
            const taskDetails = await searchControl.getTaskDetailsForEdit(qdata.id);
            const resp: CommonMessage<TaskDetailsForEdit> = {
                status: true,
                msg: "Task details retrieved successfully",
                data: taskDetails
            }
            return resp;
        } catch (error) {
            const resp: CommonMessage<TaskDetailsForEdit> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
            }
            return resp;
        }
    });

    // Update search task
    ipcMain.handle(UPDATE_SEARCH_TASK, async (event, data): Promise<CommonMessage<any>> => {
        const qdata = JSON.parse(data) as { id: number; updates: SearchTaskUpdateData };
        console.log("update search task")
        console.log(qdata)
        if (!qdata.id) {
            const resp: CommonMessage<any> = {
                status: false,
                msg: "Task ID is required",
            }
            return resp;
        }

        if (!qdata.updates) {
            const resp: CommonMessage<any> = {
                status: false,
                msg: "Update data is required",
            }
            return resp;
        }

        try {
            const searchControl = SearchController.getInstance();
            const success = await searchControl.updateSearchTask(qdata.id, qdata.updates);
            
            if (success) {
                const resp: CommonMessage<number> = {
                    status: true,
                    msg: "Task updated successfully",
                    data:qdata.id
                }
                // Send event to notify about the update
                event.sender.send(SEARCH_TASK_UPDATE_EVENT, JSON.stringify({
                    status: true,
                    msg: "Task updated successfully",
                    taskId: qdata.id
                }));
                return resp;
            } else {
                const resp: CommonMessage<any> = {
                    status: false,
                    msg: "Failed to update task",
                }
                return resp;
            }
        } catch (error) {
            const resp: CommonMessage<any> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
            }
            // Send error event
            event.sender.send(SEARCH_TASK_UPDATE_EVENT, JSON.stringify({
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                taskId: qdata.id
            }));
            return resp;
        }
    });

    // Create search task without running it
    ipcMain.handle(CREATE_SEARCH_TASK_ONLY, async (event, data): Promise<CommonMessage<number>> => {
        const qdata = JSON.parse(data) as Usersearchdata;
        console.log("create search task only")
        console.log(qdata)
        
        // Validate required fields
        if (!("searchEnginer" in qdata)) {
            const resp: CommonMessage<number> = {
                status: false,
                msg: "Search engine is required",
            }
            return resp;
        }
        if (!("keywords" in qdata)) {
            const resp: CommonMessage<number> = {
                status: false,
                msg: "Keywords are required",
            }
            return resp;
        }

        // Validate data types
        if (typeof qdata.concurrency === 'string') {
            qdata.concurrency = parseInt(qdata.concurrency, 10);
            if (isNaN(qdata.concurrency)) {
                qdata.concurrency = 1
            }
        }
        if (typeof qdata.num_pages === 'string') {
            qdata.num_pages = parseInt(qdata.num_pages, 10);
            if (isNaN(qdata.num_pages)) {
                qdata.num_pages = 1
            }
        }

        // Validate search engine
        const seArr: string[] = ToArray(SearhEnginer);
        if (!seArr.includes(qdata.searchEnginer)) {
            const resp: CommonMessage<number> = {
                status: false,
                msg: "Invalid search engine",
            }
            return resp;
        }

        try {
            const searchControl = SearchController.getInstance();
            const taskId = await searchControl.createTaskOnly({
                engine: qdata.searchEnginer,
                keywords: qdata.keywords,
                num_pages: qdata.num_pages,
                concurrency: qdata.concurrency,
                notShowBrowser: qdata.notShowBrowser,
                localBrowser: qdata.localBrowser,
                proxys: qdata.proxys,
                accounts: qdata.accounts
            });
            
            const resp: CommonMessage<number> = {
                status: true,
                msg: "Task created successfully",
                data: taskId
            }
            return resp;
        } catch (error) {
            const resp: CommonMessage<number> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
            }
            return resp;
        }
    });

    // Export search results
    ipcMain.handle(EXPORT_SEARCH_RESULTS, async (event, data): Promise<CommonMessage<any | null>> => {
        const qdata = JSON.parse(data) as { taskId: number; format?: 'json' | 'csv' };
        
        if (!qdata.taskId || qdata.taskId <= 0) {
            const resp: CommonMessage<null> = {
                status: false,
                msg: "Task ID is required",
            };
            return resp;
        }

        try {
            const searchControl = SearchController.getInstance();
            const format = qdata.format || 'csv';
            const exportData = await searchControl.exportSearchResults(qdata.taskId, format);
            
            // Show save dialog
            const fileExtension = format === 'csv' ? 'csv' : 'json';
            const defaultFilename = `search_results_task_${qdata.taskId}_${new Date().toISOString().split('T')[0]}.${fileExtension}`;
            
            const { filePath } = await dialog.showSaveDialog({
                title: `Export Search Results as ${format.toUpperCase()}`,
                defaultPath: path.join(app.getPath('documents'), defaultFilename),
                filters: [
                    { name: format === 'csv' ? 'CSV Files' : 'JSON Files', extensions: [fileExtension] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (filePath) {
                if (format === 'csv') {
                    fs.writeFileSync(filePath, exportData, 'utf-8');
                } else {
                    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
                }
                
                const resp: CommonMessage<string> = {
                    status: true,
                    msg: "Search results exported successfully",
                    data: filePath
                };
                return resp;
            } else {
                const resp: CommonMessage<null> = {
                    status: false,
                    msg: "Export cancelled by user",
                };
                return resp;
            }
        } catch (error) {
            console.error('Export search results error:', error);
            const resp: CommonMessage<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
            };
            return resp;
        }
    });

    // Kill search process
    ipcMain.handle(KILL_SEARCH_PROCESS, async (event, data): Promise<CommonMessage<{
        success: boolean;
        taskId?: number;
        pid?: number;
        message: string;
    }>> => {
        try {
            const searchControl = SearchController.getInstance();
            const qdata = JSON.parse(data) as { pid?: number; taskId?: number };
            
            if (!qdata.pid && !qdata.taskId) {
                const resp: CommonMessage<{
                    success: boolean;
                    message: string;
                }> = {
                    status: false,
                    msg: "Either PID or taskId is required",
                    data: {
                        success: false,
                        message: "Either PID or taskId is required"
                    }
                };
                return resp;
            }

            const result = qdata.pid 
                ? await searchControl.killProcessByPID(qdata.pid)
                : await searchControl.killProcessByTaskId(qdata.taskId!);
            
            const response: CommonMessage<{
                success: boolean;
        taskId?: number;
        pid?: number;
        message: string;
            }> = {
                status: true,
                msg: "Process killed successfully",
                data: result
            };
            return response;
        } catch (error) {
            console.error('Search process kill error:', error);
            const errorResponse: CommonMessage<{
                success: boolean;
                message: string;
            }> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: {
                    success: false,
                    message: error instanceof Error ? error.message : "Unknown error occurred"
                }
            };
            return errorResponse;
        }
    });
}
import { ipcMain, dialog, app } from 'electron';
import { SEARCHSCRAPERAPI, LISTSESARCHRESUT, SEARCHEVENT, TASKSEARCHRESULTLIST, SAVESEARCHERRORLOG, RETRYSEARCHTASK, SYSTEM_MESSAGE, GET_SEARCH_TASK_DETAILS, UPDATE_SEARCH_TASK, SEARCH_TASK_UPDATE_EVENT, CREATE_SEARCH_TASK_ONLY } from '@/config/channellist'
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { Usersearchdata, SearchtaskItem, SearchResultFetchparam } from "@/entityTypes/searchControlType"
import { SearchController } from "@/controller/searchController"
import { CommonResponse, CommonMessage } from "@/entityTypes/commonType"
import { SearchTaskUpdateData } from "@/modules/searchModule"
import { SearchResEntity } from "@/entityTypes/scrapeType"
import { TaskDetailsForEdit } from "@/modules/searchModule"
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

        const searchcon = new SearchController()
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
        const searchControl = new SearchController()
        const res = await searchControl.listSearchresult(qdata.page, qdata.size, qdata.sortby)
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

        const searchControl = new SearchController()
        const res = await searchControl.listtaskSearchResult(qdata.taskId, qdata.page, qdata.itemsPerPage)
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
                const searchControl = new SearchController()
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
            const searchControl = new SearchController();
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
            const searchControl = new SearchController();
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
            const searchControl = new SearchController();
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
            const searchControl = new SearchController();
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
}
import { ipcMain, dialog, app } from 'electron';
import { SEARCHSCRAPERAPI, LISTSESARCHRESUT, SEARCHEVENT, TASKSEARCHRESULTLIST, SAVESEARCHERRORLOG, RETRYSEARCHTASK,SYSTEM_MESSAGE } from '@/config/channellist'
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { Usersearchdata, SearchtaskItem, SearchResultFetchparam } from "@/entityTypes/searchControlType"
import { SearchController } from "@/controller/searchController"
import { CommonResponse } from "@/entityTypes/commonType"
import { SearchResEntity } from "@/entityTypes/scrapeType"
import * as path from 'path';
import * as fs from 'fs';
import { ItemSearchparam } from "@/entityTypes/commonType"
import { SearhEnginer } from "@/config/searchSetting"
import { ToArray } from "@/views/utils/function"

export function registerSearchIpcHandlers() {
    ipcMain.on(SEARCHSCRAPERAPI, async (event, arg) => {

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
            return comMsgs
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
            return comMsgs
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
            return comMsgs
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
    ipcMain.handle(LISTSESARCHRESUT, async (event, data) => {
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
    ipcMain.handle(TASKSEARCHRESULTLIST, async (event, data) => {
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

    ipcMain.handle(SAVESEARCHERRORLOG, async (event, data) => {
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

    })

    ipcMain.on(RETRYSEARCHTASK, async (event, data) => {
        const qdata = JSON.parse(data) as { id: number };
        if (!qdata.id) {
            const resp: CommonResponse<any> = {
                status: false,
                msg: "task id is empty",
            }
            event.sender.send(SYSTEM_MESSAGE, JSON.stringify(resp))
            return resp;
        }

        try {
            const searchControl = new SearchController();
            await searchControl.retryTask(qdata.id);
            const resp: CommonResponse<any> = {
                status: true,
                msg: "Task retry started successfully",
            }
            event.sender.send(SYSTEM_MESSAGE, JSON.stringify(resp))
            return resp;
        } catch (error) {
            const resp: CommonResponse<any> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
            }
            event.sender.send(SYSTEM_MESSAGE, JSON.stringify(resp))
            return resp;
        }
    });
}
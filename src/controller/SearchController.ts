// import { Usersearchdata } from '@/entityTypes/scrapeType';
//import { SMstruct, SearchDataParam,SearchResEntity } from "@/entityTypes/scrapeType"
// import { ScrapeManager } from "@/modules/scrapeManager"
// import {SearhEnginer} from "@/config/searchSetting"
// import { ToArray } from "@/modules/lib/function"
import {Usersearchdata,SearchtaskEntityNum } from "@/entityTypes/searchControlType"
// import {SearchTaskdb} from "@/model/searchTaskdb"
// import {SearchKeyworddb} from "@/model/searchKeyworddb"
// import {SearchResultdb} from "@/model/searchResultdb"
//import { utilityProcess, MessageChannelMain} from "electron";
import * as path from 'path';
import * as fs from 'fs';
import {SearchModule} from "@/modules/SearchModule"
import { Token } from "@/modules/token"
// import {USERSDBPATH} from '@/config/usersetting';
import {SearchDataParam,SearchResEntityDisplay,SearchResEntityRecord,SearchResEntity} from "@/entityTypes/scrapeType"
import {TaskDetailsForEdit} from "@/modules/SearchModule"
import {SearchResultModule} from "@/modules/SearchResultModule"
// import {SEARCHEVENT} from "@/config/channellist"
import { SearchTaskStatus } from "@/model/SearchTask.model"
// import { SearchKeyworddb } from "@/model/searchKeyworddb";
//import { CustomError } from "@/modules/customError";
import {USERLOGPATH,USEREMAIL} from '@/config/usersetting';
import {getApplogspath,getRandomValues} from "@/modules/lib/function"
import { v4 as uuidv4 } from 'uuid';
import {SortBy} from "@/entityTypes/commonType";
//import { SystemSettingGroupModule } from '@/modules/SystemSettingGroupModule';
// import {twocaptchagroup,twocaptchatoken,twocaptcha_enabled,chrome_path,firefox_path,external_system} from '@/config/settinggroupInit'
// import { AccountCookiesModule } from "@/modules/accountCookiesModule"
// import {CookiesType} from "@/entityTypes/cookiesType"
import type { UtilityProcess } from 'electron';

/**
 * Search Controller
 * 
 * Provides business logic for managing search scraping tasks.
 * Implemented as a Singleton to ensure:
 * - Single instance across the application
 * - Shared state for process management
 * - Consistent resource allocation
 * - Centralized control over search operations
 */
export class SearchController {
    private static instance: SearchController | null = null;
    
    private searchModel:SearchModule;
    private searchResultModule:SearchResultModule;
    private processMap: Map<number, UtilityProcess> = new Map();
    // private accountCookiesModule: AccountCookiesModule;
   //private systemSettingGroupModule: SystemSettingGroupModule

    /**
     * Private constructor to prevent direct instantiation
     * Use getInstance() method to access the singleton instance
     */
    private constructor() {
        // this.accountCookiesModule=new AccountCookiesModule()
        this.searchModel=new SearchModule()
        this.searchResultModule=new SearchResultModule()
        //this.systemSettingGroupModule=new SystemSettingGroupModule()
    }

    /**
     * Get the singleton instance of SearchController
     * Creates a new instance if one doesn't exist
     * @returns The singleton instance of SearchController
     */
    public static getInstance(): SearchController {
        if (SearchController.instance === null) {
            SearchController.instance = new SearchController();
        }
        return SearchController.instance;
    }

    /**
     * Reset the singleton instance (useful for testing or cleanup)
     * @private - Use with caution, mainly for testing purposes
     */
    public static resetInstance(): void {
        SearchController.instance = null;
    }

    /**
     * Check if a singleton instance exists
     * @returns true if an instance exists, false otherwise
     */
    public static hasInstance(): boolean {
        return SearchController.instance !== null;
    }
    //save user search task, and run task
    public async searchData(data: Usersearchdata) {
        //search data

       
        const dp:SearchDataParam={
            engine:data.searchEnginer,
            keywords:data.keywords,
            num_pages:data.num_pages,
            concurrency:data.concurrency,
            notShowBrowser:data.notShowBrowser,
            proxys:data.proxys,
            //useLocalbrowserdata:data.useLocalbrowserdata,
            localBrowser:data.localBrowser,
            accounts:data.accounts
        }
        //console.log("search datat dp")
        //console.log(dp)
        // const taskId=await this.searhModel.saveSearchtask(dp)

        const taskId=await this.createTask(dp)
        await this.searchModel.runSearchTask(taskId)
        // const jsonData=JSON.stringify(data);
        //console.log(jsonData)
    //    const childPath = path.join(__dirname, 'taskCode.js')
    //     if (!fs.existsSync(childPath)) {
    //         throw new Error("child js path not exist for the path " + childPath);
    //     }
    //     const { port1, port2 } = new MessageChannelMain()
    //     const tokenService=new Token()
        
    //     const child = utilityProcess.fork(childPath, [],{stdio:"pipe",execArgv:["puppeteer-cluster:*"],env:{
    //         ...process.env,
    //         NODE_OPTIONS: ""  
    //     }} )
    //     // console.log(path.join(__dirname, 'utilityCode.js'))
    //     let logpath=tokenService.getValue(USERLOGPATH)
    //     if(!logpath){
    //         const useremail=tokenService.getValue(USEREMAIL)
    //         //create log path
    //         logpath=getApplogspath(useremail)
    //     }
    //     // console.log(logpath)
    //     const uuid=uuidv4({random: getRandomValues(new Uint8Array(16))})
    //     const errorLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.error.log')
    //     const runLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.runtime.log')
    //    // console.log(errorLogfile)
    //     // console.log(data)
    //     // child.postMessage({ message: 'hello' }, [port1])
    //     child.on("spawn", () => {
    //         console.log("child process satart, pid is"+child.pid)
    //         child.postMessage(JSON.stringify({action:"searchscraper",data:data}),[port1])
    //         this.searhModel.updateTaskLog(taskId,runLogfile,errorLogfile)
    //     })
        
    //     child.stdout?.on('data', (data) => {
    //         console.log(`Received data chunk ${data}`)
    //         WriteLog(runLogfile,data)
    //        // child.kill()
    //     })
    //     child.stderr?.on('data', (data) => {
    //         const ingoreStr=["Debugger attached","Waiting for the debugger to disconnect","Most NODE_OPTIONs are not supported in packaged apps"]
    //         if(!ingoreStr.some((value)=>data.includes(value))){
                    
    //         // seModel.saveTaskerrorlog(taskId,data)
    //         console.log(`Received error chunk ${data}`)
    //         WriteLog(errorLogfile,data)
    //         this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Error)
    //         //child.kill()
    //         }
            
    //     })
    //     child.on("exit", (code) => {
    //         if (code !== 0) {
    //             console.error(`Child process exited with code ${code}`);
                
    //         } else {
    //             console.log('Child process exited successfully');
    //         }
    //     })
    //     child.on('message', (message) => {
    //         console.log("get message from child")
    //         console.log('Message from child:', JSON.parse(message));
    //         const childdata=JSON.parse(message)
    //         if(childdata.action=="saveres"){
    //             //save result
    //             this.searhModel.saveSearchResult(childdata.data,taskId)
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Complete)
    //             child.kill()
    //         }
    //     });
    }

    public async createTask(data:SearchDataParam):Promise<number>{
        const taskId=await this.searchModel.saveSearchtask(data)
        const tokenService=new Token()
        let logpath=tokenService.getValue(USERLOGPATH)
        if(!logpath){
            const useremail=tokenService.getValue(USEREMAIL)
            //create log path
            logpath=getApplogspath(useremail)
        }
        const uuid=uuidv4({random: getRandomValues(new Uint8Array(16))})
        const errorLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.error.log')
        const runLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.runtime.log')
        //create log file and runlog file
        fs.writeFileSync(errorLogfile,'')
        fs.writeFileSync(runLogfile,'')
        await this.searchModel.updateTaskLog(taskId,runLogfile,errorLogfile)
        return taskId
    }

    /**
     * Create a search task without running it
     * @param data Search task parameters
     * @returns The ID of the created task
     */
    public async createTaskOnly(data:SearchDataParam):Promise<number>{
        const taskId=await this.searchModel.saveSearchtaskOnly(data)
        const tokenService=new Token()
        let logpath=tokenService.getValue(USERLOGPATH)
        if(!logpath){
            const useremail=tokenService.getValue(USEREMAIL)
            //create log path
            logpath=getApplogspath(useremail)
        }
        const uuid=uuidv4({random: getRandomValues(new Uint8Array(16))})
        const errorLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.error.log')
        const runLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.runtime.log')
        //create log file and runlog file
        fs.writeFileSync(errorLogfile,'')
        fs.writeFileSync(runLogfile,'')
        await this.searchModel.updateTaskLog(taskId,runLogfile,errorLogfile)
        return taskId
    }
    //run search function
    public async runSearchTask(taskId:number):Promise<void>{
        await this.searchModel.runSearchTask(taskId);
    //     //get error log and run log
    //     const taskEntity=await this.searhModel.getTaskEntityById(taskId)
    //     if(!taskEntity){
    //         throw new Error("task not exist")
    //     }
    //     const errorLogfile=taskEntity.error_log
    //     if(!errorLogfile){
    //         throw new Error("error log not exist")
    //     }
    //     const runLogfile=taskEntity.run_log
    //     if(!runLogfile){
    //         throw new Error("run log not exist")
    //     }
    //     // Get parent path of errorLogfile
    //     const errorLogDir = path.dirname(errorLogfile);
        
    //     // Ensure the directory exists
    //     if (!fs.existsSync(errorLogDir)) {
    //         fs.mkdirSync(errorLogDir, { recursive: true });
    //     }
    //     //const cookiesArray:Array<Array<CookiesType>>=[]
    //     // if(taskEntity.accounts){
    //     //     for (const account of taskEntity.accounts) {
    //     //         const cookies = await this.accountCookiesModule.getAccountCookies(account)
    //     //         if(cookies){
    //     //             const cookiesits:Array<CookiesType>=JSON.parse(cookies.cookies)
    //     //             cookiesArray.push(cookiesits)
    //     //             }
    //     //     }
    //     // }  
    // // const cookies = await this.accountCookiesModule.getAccountCookies(taskEntity.accounts)
    // // //    if(!cookies){
    // //     throw new Error("account cookies not found")
    // //    }
       
    //     const data:Usersearchdata={
    //         searchEnginer:taskEntity.engine,
    //         keywords:taskEntity.keywords,
    //         num_pages:taskEntity.num_pages??1,
    //         concurrency:taskEntity.concurrency??1,
    //         notShowBrowser:taskEntity.notShowBrowser??false,
    //         proxys:taskEntity.proxys,
    //         debug_log_path:errorLogDir,
    //         //useLocalbrowserdata:taskEntity.useLocalbrowserdata?true:false,
    //         localBrowser:taskEntity.localBrowser?taskEntity.localBrowser:"",
    //         cookies:taskEntity.cookies
    //     }

    //     const childPath = path.join(__dirname, 'taskCode.js')
    //     if (!fs.existsSync(childPath)) {
    //         throw new Error("child js path not exist for the path " + childPath);
    //     }
    //     const { port1, port2 } = new MessageChannelMain()
    //    // const tokenService=new Token()
    //    let twoCaptchaTokenvalue=""
    //    const twoCaptchaToken=await this.systemSettingGroupModule.getGroupItembyName(twocaptchagroup)
    //    if(twoCaptchaToken){
    //     //find 2captcha enable key
    //     const twocaptchenable=twoCaptchaToken.settings.find((item)=>item.key===twocaptcha_enabled)
    //     if(twocaptchenable){
    //     const token=twoCaptchaToken.settings.find((item)=>item.key===twocaptchatoken)
    //     if(token){
    //         twoCaptchaTokenvalue=token.value
    //     }
    //    }
    // }
    // let localBrowserexcutepath:string=""
    // if(data.localBrowser&&data.localBrowser.length>0){
    //     const external_system_group=await this.systemSettingGroupModule.getGroupItembyName(external_system)
    //     if(external_system_group){
    //         const chromePath=external_system_group.settings.find((item)=>item.key===chrome_path)
    //         if(chromePath){
    //             localBrowserexcutepath=chromePath.value
    //         }
    //         const firefoxPath=external_system_group.settings.find((item)=>item.key===firefox_path)
    //         if(firefoxPath){
    //             localBrowserexcutepath=firefoxPath.value
    //         }
    //     }
    //     if(data.localBrowser=="chrome"&&!localBrowserexcutepath){
            
    //         const localBrowserexcutepathresult=getChromeExcutepath()
    //         if(localBrowserexcutepathresult){
    //             localBrowserexcutepath=localBrowserexcutepathresult
    //         }

    //     }else if(data.localBrowser=="firefox"&&!localBrowserexcutepath){
    //         const localBrowserexcutepathresult=getFirefoxExcutepath()
    //         if(localBrowserexcutepathresult){
    //             localBrowserexcutepath=localBrowserexcutepathresult
    //         }
    //     }
    //     if(!localBrowserexcutepath){
    //         throw new Error("local browser excute path not exist")
    //     }
    // }
    // //let userDataDir=""
    // // if(data.useLocalbrowserdata){
    // //     userDataDir=getChromeUserDataDir()
    // //     if(!userDataDir){
    // //         throw new Error("user data dir not exist")
    // //     }
    // // }
    //    //console.log("two captcha token value is "+twoCaptchaTokenvalue)
    //    //console.log("local browser excute path is "+localBrowserexcutepath)
    //    //console.log("user data dir is "+userDataDir)
    //     const child = utilityProcess.fork(childPath, [],{stdio:"pipe",execArgv:["puppeteer-cluster:*"],env:{
    //         ...process.env,
    //         NODE_OPTIONS: "",
    //         TWOCAPTCHA_TOKEN: twoCaptchaTokenvalue,
    //         LOCAL_BROWSER_EXCUTE_PATH: localBrowserexcutepath,
    //         //USEDATADIR: userDataDir
    //     }} )
    //     child.on("spawn", () => {
    //         console.log("child process satart, pid is"+child.pid)
    //         this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Processing)
    //         child.postMessage(JSON.stringify({action:"searchscraper",data:data}),[port1])
    //        // this.searhModel.updateTaskLog(taskId,runLogfile,errorLogfile)
    //     })
        
    //     child.stdout?.on('data', (data) => {
    //         console.log(`Received data chunk ${data}`)
    //         WriteLog(runLogfile,data)
    //        // child.kill()
    //     })
    //     child.stderr?.on('data', (data) => {
    //         const ingoreStr=["Debugger attached","Waiting for the debugger to disconnect","Most NODE_OPTIONs are not supported in packaged apps"]
    //         if(!ingoreStr.some((value)=>data.includes(value))){
                    
    //         // seModel.saveTaskerrorlog(taskId,data)
    //         console.log(`Received error chunk ${data}`)
    //         WriteLog(errorLogfile,data)
    //         this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Error)
    //         //child.kill()
    //         }
            
    //     })
    //     child.on("exit", (code) => {
    //         if (code !== 0) {
    //             console.error(`Child process exited with code ${code}`);
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Error)
    //         } else {
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Complete)
    //             console.log('Child process exited successfully');
    //         }
    //     })
    //     child.on('message', (message) => {
    //         console.log("get message from child")
    //         console.log('Message from child:', JSON.parse(message));
    //         const childdata=JSON.parse(message)
    //         if(childdata.action=="savesearchresult"){
    //             //save result
    //             this.searhModel.saveSearchResult(childdata.data,taskId)
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Complete)
    //             child.kill()
    //         }
    //     });
    }
    //return search result
    public async listSearchresult(page:number,size:number,sortBy?:SortBy,search?:string):Promise<SearchtaskEntityNum>{
        // const seModel=new searhModel()
        // await seModel.init();
        const res=await this.searchModel.listSearchtask(page,size, sortBy, search)
        return res;
    }   
    //list task search result
    public async listtaskSearchResult(taskId:number,page:number,size:number,search?:string):Promise<SearchResEntityRecord>{
        // const seModel=new searhModel()
        const res=await this.searchModel.listSearchResult(taskId,page,size,search)

        const datas: Array<SearchResEntityDisplay> = []
        //const SearchKeyDb=new SearchKeyworddb(this.dbpath)

        // Use Promise.all to properly handle async operations
        await Promise.all(res.map(async (item) => {
            //console.log(item)
            //console.log(item.keyword_id)
            const keyEntity = await this.searchModel.getkeywrodsEntitybyId(item.keyword_id)
            //console.log(keyEntity)
            const data: SearchResEntityDisplay = {
                id: item.id,
                keyword_id: item.keyword_id,
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                record_time: item.record_time,
                visible_link: item.visible_link,
                keyword: keyEntity?.keyword??""
            }
            datas.push(data)
        }))
        //return datas

        // Get total count - if search is provided, get filtered count, otherwise get all count
        let total: number;
        if (search && search.trim().length > 0) {
            // For search, get all results with keywords and count filtered ones
            const allResults = await this.searchResultModule.getAllSearchResultsByTaskId(taskId)
            const searchLower = search.toLowerCase().trim()
            
            // Enrich all results with keywords for filtering
            const enrichedResults = await Promise.all(allResults.map(async (item) => {
                const keyEntity = await this.searchModel.getkeywrodsEntitybyId(item.keyword_id)
                return {
                    ...item,
                    keyword: keyEntity?.keyword ?? ""
                }
            }))
            
            const filteredResults = enrichedResults.filter(result => 
                result.keyword?.toLowerCase().includes(searchLower) ||
                result.title?.toLowerCase().includes(searchLower) ||
                result.snippet?.toLowerCase().includes(searchLower) ||
                result.link?.toLowerCase().includes(searchLower) ||
                result.visible_link?.toLowerCase().includes(searchLower)
            )
            total = filteredResults.length
        } else {
            total = await this.searchModel.countSearchResult(taskId)
        }
        
        const data:SearchResEntityRecord={
            total:total,
            record:datas
        }
        return data
    }
    public async getTaskErrorlog(taskId:number):Promise<string>{
        // const seModel=new searhModel()
        const log=await this.searchModel.getTaskErrorLog(taskId)
        return log
    }
    //retry task by task id
    public async retryTask(taskId:number):Promise<void>{
        const taskEntity=await this.searchModel.getTaskEntityById(taskId)
        if(!taskEntity){
            throw new Error("task not exist")
        }
        await this.runSearchTask(taskId)
    }

    /**
     * Update search task with new parameters
     * @param taskId The task ID to update
     * @param updates The updated task parameters
     * @returns True if update was successful
     */
    public async updateSearchTask(taskId: number, updates: {
        engine?: string;
        keywords?: string[];
        num_pages?: number;
        concurrency?: number;
        notShowBrowser?: boolean;
        localBrowser?: string;
        proxys?: Array<{host: string, port: number, user?: string, pass?: string}>;
        accounts?: number[];
    }): Promise<boolean> {
        // Validate task existence and editability
        const taskEntity = await this.searchModel.getTaskEntityById(taskId);
        if (!taskEntity) {
            throw new Error("search.task_not_found");
        }
      

        // Check if task is editable
        const isEditable = await this.searchModel.isTaskEditable(taskId);
        console.log("isEditable",isEditable)
        if (!isEditable) {
            throw new Error("search.task_cannot_be_edited");
        }

        // Validate input parameters
        if (updates.keywords && updates.keywords.length === 0) {
            throw new Error("search.at_least_one_keyword_required");
        }

        if (updates.num_pages !== undefined && (updates.num_pages < 1 || updates.num_pages > 100)) {
            throw new Error("search.pages_must_be_between");
        }

        if (updates.concurrency !== undefined && (updates.concurrency < 1 || updates.concurrency > 10)) {
            throw new Error("search.concurrency_must_be_between");
        }

        // Perform the update
        return await this.searchModel.updateSearchTask(taskId, updates);
    }

    /**
     * Get task details for editing
     * @param taskId The task ID
     * @returns Task details suitable for editing
     */
    public async getTaskDetailsForEdit(taskId: number): Promise<TaskDetailsForEdit> {
        // Validate task existence
        const taskEntity = await this.searchModel.getTaskEntityById(taskId);
        if (!taskEntity) {
            throw new Error("search.task_not_found");
        }
        
        // Check if task is editable
        const isEditable = await this.searchModel.isTaskEditable(taskId);
        if (!isEditable) {
            throw new Error("search.task_cannot_be_edited");
        }

        return await this.searchModel.getTaskDetailsForEdit(taskId);
    }

    /**
     * Export search results for a task
     * @param taskId The task ID
     * @param format Export format ('json' or 'csv')
     * @returns Exported data
     */
    public async exportSearchResults(taskId: number, format: 'json' | 'csv' = 'csv'): Promise<any> {
        if (!taskId || taskId <= 0) {
            throw new Error("Task ID is required");
        }

        // Get all results for the task using SearchResultModule
        const allResults = await this.searchResultModule.getAllSearchResultsByTaskId(taskId);
        
        // Get keyword information for each result
        const resultsWithKeywords: Array<SearchResEntityDisplay> = [];
        for (const item of allResults) {
            const keyEntity = await this.searchModel.getkeywrodsEntitybyId(item.keyword_id);
            const data: SearchResEntityDisplay = {
                id: item.id,
                keyword_id: item.keyword_id,
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                record_time: item.record_time,
                visible_link: item.visible_link,
                keyword: keyEntity?.keyword ?? ""
            };
            resultsWithKeywords.push(data);
        }

        if (format === 'csv') {
            return this.convertToCSV(resultsWithKeywords);
        } else {
            return {
                total: resultsWithKeywords.length,
                results: resultsWithKeywords,
                exportDate: new Date().toISOString(),
                taskId: taskId
            };
        }
    }

    /**
     * Convert search results to CSV format
     * @param results Array of search result entities
     * @returns CSV string
     */
    private convertToCSV(results: Array<SearchResEntityDisplay>): string {
        if (results.length === 0) {
            return '';
        }

        const headers = ['ID', 'Keyword', 'Title', 'Link', 'Visible Link', 'Snippet', 'Record Time'];
        const rows = results.map(result => [
            result.id?.toString() ?? '',
            result.keyword ?? '',
            this.escapeCSV(result.title ?? ''),
            result.link ?? '',
            result.visible_link ?? '',
            this.escapeCSV(result.snippet ?? ''),
            result.record_time ?? ''
        ]);

        const csvRows = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ];

        return csvRows.join('\n');
    }

    /**
     * Escape CSV field values
     * @param value The value to escape
     * @returns Escaped value
     */
    private escapeCSV(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    /**
     * Register a process for a task
     * @param taskId The task ID
     * @param process The utility process instance
     */
    public registerProcess(taskId: number, process: UtilityProcess): void {
        this.processMap.set(taskId, process);
    }

    /**
     * Unregister a process for a task
     * @param taskId The task ID
     */
    public unregisterProcess(taskId: number): void {
        this.processMap.delete(taskId);
    }

    /**
     * Get process by task ID
     * @param taskId The task ID
     * @returns The utility process or undefined
     */
    public getProcessByTaskId(taskId: number): UtilityProcess | undefined {
        return this.processMap.get(taskId);
    }

    /**
     * Get task ID by PID
     * @param pid The process ID
     * @returns The task ID or null if not found
     */
    public async getTaskIdByPID(pid: number): Promise<number | null> {
        // Search through processMap
        for (const [taskId, process] of this.processMap.entries()) {
            if (process.pid === pid) {
                return taskId;
            }
        }
        // If not found in memory, check database
        const taskId = await this.searchModel.getTaskIdByPID(pid);
        return taskId;
    }

    /**
     * Kill a child process by PID
     * @param pid The process ID to kill
     * @returns Promise that resolves with kill result
     */
    public async killProcessByPID(pid: number): Promise<{
        success: boolean;
        taskId?: number;
        message: string;
    }> {
        try {
            console.log(`Killing search process with PID ${pid}`);
            
            // Find task by PID
            const taskId = await this.getTaskIdByPID(pid);
            
            if (!taskId) {
                // Try to kill process directly using system kill command
                try {
                    const { exec } = require('child_process');
                    const isWindows = require('process').platform === 'win32';
                    exec(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, (error: unknown) => {
                        if (error) {
                            console.error(`Failed to kill process ${pid}:`, error);
                        }
                    });
                    return {
                        success: true,
                        message: `Process ${pid} killed successfully (task not found in memory)`
                    };
                } catch (error) {
                    return {
                        success: false,
                        message: `Failed to kill process ${pid}: Task not found`
                    };
                }
            }

            // Get process from map
            const utilityProcess = this.processMap.get(taskId);
            
            if (utilityProcess && utilityProcess.pid === pid) {
                try {
                    // Kill the process
                    utilityProcess.kill();
                    console.log(`Successfully killed process ${pid} for task ${taskId}`);
                } catch (error) {
                    console.error(`Error killing process ${pid}:`, error);
                    // Try system kill as fallback
                    try {
                        const { exec } = require('child_process');
                        const isWindows = require('process').platform === 'win32';
                        exec(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`);
                    } catch (killError) {
                        console.error(`Failed to kill process ${pid} using system command:`, killError);
                    }
                }
            } else {
                // Process not in map, try system kill
                try {
                    const { exec } = require('child_process');
                    const isWindows = require('process').platform === 'win32';
                    exec(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`);
                } catch (error) {
                    console.error(`Failed to kill process ${pid}:`, error);
                }
            }

            // Update task status
            if (taskId) {
                try {
                    await this.searchModel.updateTaskStatus(taskId, SearchTaskStatus.Error);
                    await this.searchModel.updateTaskPID(taskId, null);
                    console.log(`Updated task ${taskId} status to Error after killing process`);
                } catch (statusUpdateError) {
                    console.warn(`Failed to update task ${taskId} status:`, statusUpdateError);
                }
            }

            // Remove from process map
            if (taskId) {
                this.processMap.delete(taskId);
            }

            return {
                success: true,
                taskId,
                message: `Process ${pid} killed successfully and task status updated`
            };
        } catch (error) {
            console.error(`Failed to kill process ${pid}:`, error);
            throw error;
        }
    }

    /**
     * Kill a child process by task ID
     * @param taskId The task ID
     * @returns Promise that resolves with kill result
     */
    public async killProcessByTaskId(taskId: number): Promise<{
        success: boolean;
        pid?: number;
        message: string;
    }> {
        try {
            console.log(`Killing process for task ${taskId}`);
            
            // Get process from map
            const utilityProcess = this.processMap.get(taskId);
            
            if (!utilityProcess) {
                // Try to get PID from database and kill it
                const pid = await this.searchModel.getTaskPID(taskId);
                if (pid) {
                    return await this.killProcessByPID(pid);
                }
                return {
                    success: false,
                    message: `No process found for task ${taskId}`
                };
            }

            const pid = utilityProcess.pid;
            
            try {
                // Kill the process
                utilityProcess.kill();
                console.log(`Successfully killed process ${pid} for task ${taskId}`);
            } catch (error) {
                console.error(`Error killing process for task ${taskId}:`, error);
                // Try system kill as fallback
                if (pid) {
                    try {
                        const { exec } = require('child_process');
                        const isWindows = require('process').platform === 'win32';
                        exec(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`);
                    } catch (killError) {
                        console.error(`Failed to kill process ${pid} using system command:`, killError);
                    }
                }
            }

            // Update task status
            try {
                await this.searchModel.updateTaskStatus(taskId, SearchTaskStatus.Error);
                await this.searchModel.updateTaskPID(taskId, null);
                console.log(`Updated task ${taskId} status to Error after killing process`);
            } catch (statusUpdateError) {
                console.warn(`Failed to update task ${taskId} status:`, statusUpdateError);
            }

            // Remove from process map
            this.processMap.delete(taskId);

            return {
                success: true,
                pid,
                message: `Process ${pid} killed successfully for task ${taskId}`
            };
        } catch (error) {
            console.error(`Failed to kill process for task ${taskId}:`, error);
            throw error;
        }
    }

}
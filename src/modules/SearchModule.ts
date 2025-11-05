import { SearchDataParam } from "@/entityTypes/scrapeType"
import { SearchTaskModel, SearchTaskStatus, SearchTaskUpdateFields } from "@/model/SearchTask.model"
import { Token } from "@/modules/token"
//import { USERSDBPATH } from '@/config/usersetting';
import { SearhEnginer } from "@/config/searchSetting"
// import { ToArray } from "@/modules/lib/function"
import { SearchKeywordModel } from "@/model/SearchKeyword.model"
import { SearchResultModel } from "@/model/SearchResult.model"
import { SearchResEntity, ResultParseItemType } from "@/entityTypes/scrapeType"
//import {SearchTaskdb} from "@/model/searchTaskdb"
import { SearchtaskEntityNum, SearchtaskItem } from "@/entityTypes/searchControlType"
import { getEnumKeyByValue, getEnumValueByNumber, getApplogspath, getRandomValues } from "@/modules/lib/function"
import * as path from 'path';
import * as fs from 'fs';
import { SortBy } from "@/entityTypes/commonType";
import { BaseModule } from "@/modules/baseModule";
import { SearchTaskProxyModel } from "@/model/SearchTaskProxy.model";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";
//import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { SearchAccountModel } from "@/model/SearchAccount.model"
import { SearchAccountEntity } from "@/entity/SearchAccount.entity";
import { SearchKeywordEntity } from "@/entity/SearchKeyword.entity";
import { CookiesType } from "@/entityTypes/cookiesType"
import { AccountCookiesModule } from "./accountCookiesModule";
import {Usersearchdata } from "@/entityTypes/searchControlType"
import { utilityProcess, MessageChannelMain} from "electron";
import { SystemSettingGroupModule } from '@/modules/SystemSettingGroupModule';
import { twocaptchagroup,twocaptchatoken,twocaptcha_enabled,chrome_path,firefox_path,external_system} from '@/config/settinggroupInit'
import {WriteLog,getChromeExcutepath,getFirefoxExcutepath,getRecorddatetime} from "@/modules/lib/function"
import { USERLOGPATH, USEREMAIL } from '@/config/usersetting';
import { v4 as uuidv4 } from 'uuid';

export type TaskDetailsForEdit = {
    id: number;
    engine: number;
    engineName?: string;
    keywords: Array<string>;
    num_pages: number;
    concurrency: number;
    notShowBrowser: boolean;
    localBrowser: string;
    proxys: Array<{host: string, port: number, user: string, pass: string}>;
    accounts: Array<number>;
    status: SearchTaskStatus;
    record_time: string;
}

export type SearchTaskUpdateData = {
    engine?: string;
    keywords?: string[];
    num_pages?: number;
    concurrency?: number;
    notShowBrowser?: boolean;
    localBrowser?: string;
    proxys?: Array<{host: string, port: number, user?: string, pass?: string}>;
    accounts?: number[];
}

export class SearchModule extends BaseModule {
    // private dbpath: string
    private taskdbModel: SearchTaskModel
    private serResultModel: SearchResultModel
    private serKeywordModel: SearchKeywordModel
    private searchTaskProxyModel: SearchTaskProxyModel
    private searchAccountModel: SearchAccountModel
    private accountCookiesModule: AccountCookiesModule
    private systemSettingGroupModule: SystemSettingGroupModule
    constructor() {
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        // this.dbpath = dbpath
        super()
        this.taskdbModel = new SearchTaskModel(this.dbpath)
        this.serResultModel = new SearchResultModel(this.dbpath)
        this.serKeywordModel = new SearchKeywordModel(this.dbpath)
        this.searchTaskProxyModel = new SearchTaskProxyModel(this.dbpath)
        this.searchAccountModel = new SearchAccountModel(this.dbpath)
        this.accountCookiesModule = new AccountCookiesModule()
        this.systemSettingGroupModule = new SystemSettingGroupModule()
    }

    /**
     * Search by keyword and search engine name
     * Creates a task and runs it immediately
     * @param keywords Array of keywords to search
     * @param engineName Search engine name (e.g., "google", "bing")
     * @param options Optional search parameters (num_pages, concurrency, etc.)
     * @returns The created task ID
     */
    public async searchByKeywordAndEngine(
        keywords: string[],
        engineName: string,
        options?: {
            num_pages?: number;
            concurrency?: number;
            notShowBrowser?: boolean;
            localBrowser?: string;
            proxys?: Array<{host: string, port: number, user?: string, pass?: string}>;
            accounts?: number[];
        }
    ): Promise<number> {
        // Validate inputs
        if (!keywords || keywords.length === 0) {
            throw new Error("Keywords cannot be empty");
        }
        if (!engineName || engineName.trim().length === 0) {
            throw new Error("Search engine name cannot be empty");
        }

        // Convert search engine name to number
        const enginId = this.convertSEtoNum(engineName);
        if (!enginId) {
            throw new Error(`Invalid search engine name: ${engineName}`);
        }

        // Prepare search data
        const searchData: SearchDataParam = {
            keywords: keywords,
            engine: engineName,
            num_pages: options?.num_pages ?? 1,
            concurrency: options?.concurrency ?? 1,
            notShowBrowser: options?.notShowBrowser ?? false,
            localBrowser: options?.localBrowser ?? "",
            proxys: options?.proxys ? options.proxys.map(proxy => ({
                host: proxy.host,
                port: proxy.port.toString(),
                user: proxy.user,
                pass: proxy.pass
            })) : undefined,
            accounts: options?.accounts
        };

        // Create the search task
        const taskId = await this.saveSearchtask(searchData);

        // Generate log paths
        const tokenService = new Token();
        let logpath = tokenService.getValue(USERLOGPATH);
        if (!logpath) {
            const useremail = tokenService.getValue(USEREMAIL);
            // Create log path
            logpath = getApplogspath(useremail);
        }
        const uuid = uuidv4({ random: getRandomValues(new Uint8Array(16)) });
        const errorLogfile = path.join(logpath, 'search_' + taskId.toString() + '_' + uuid + '.error.log');
        const runLogfile = path.join(logpath, 'search_' + taskId.toString() + '_' + uuid + '.runtime.log');
        
        // Create log files
        fs.writeFileSync(errorLogfile, '');
        fs.writeFileSync(runLogfile, '');
        
        // Update task with log paths
        await this.updateTaskLog(taskId, runLogfile, errorLogfile);
        
        // Add log paths to searchData
        searchData.error_log = errorLogfile;
        searchData.run_log = runLogfile;

        // Run the search task
        await this.runSearchTask(taskId);

        return taskId;
    }

    //run search function
    public async runSearchTask(taskId:number):Promise<void>{

        //get error log and run log
        const taskEntity=await this.getTaskEntityById(taskId)
        if(!taskEntity){
            throw new Error("task not exist")
        }
        const errorLogfile=taskEntity.error_log
        if(!errorLogfile){
            throw new Error("error log not exist")
        }
        const runLogfile=taskEntity.run_log
        if(!runLogfile){
            throw new Error("run log not exist")
        }
        // Get parent path of errorLogfile
        const errorLogDir = path.dirname(errorLogfile);
        
        // Ensure the directory exists
        if (!fs.existsSync(errorLogDir)) {
            fs.mkdirSync(errorLogDir, { recursive: true });
        }
        
       
        const data:Usersearchdata={
            searchEnginer:taskEntity.engine,
            keywords:taskEntity.keywords,
            num_pages:taskEntity.num_pages??1,
            concurrency:taskEntity.concurrency??1,
            notShowBrowser:taskEntity.notShowBrowser??false,
            proxys:taskEntity.proxys,
            debug_log_path:errorLogDir,
            //useLocalbrowserdata:taskEntity.useLocalbrowserdata?true:false,
            localBrowser:taskEntity.localBrowser?taskEntity.localBrowser:"",
            cookies:taskEntity.cookies
        }

        const childPath = path.join(__dirname, 'taskCode.js')
        if (!fs.existsSync(childPath)) {
            throw new Error("child js path not exist for the path " + childPath);
        }
        const { port1, port2 } = new MessageChannelMain()
       // const tokenService=new Token()
       let twoCaptchaTokenvalue=""
       const twoCaptchaToken=await this.systemSettingGroupModule.getGroupItembyName(twocaptchagroup)
       if(twoCaptchaToken){
        //find 2captcha enable key
        const twocaptchenable=twoCaptchaToken.settings.find((item)=>item.key===twocaptcha_enabled)
        if(twocaptchenable){
        const token=twoCaptchaToken.settings.find((item)=>item.key===twocaptchatoken)
        if(token){
            twoCaptchaTokenvalue=token.value
        }
       }
    }
    let localBrowserexcutepath:string=""
    if(data.localBrowser&&data.localBrowser.length>0){
        const external_system_group=await this.systemSettingGroupModule.getGroupItembyName(external_system)
        if(external_system_group){
            const chromePath=external_system_group.settings.find((item)=>item.key===chrome_path)
            if(chromePath){
                localBrowserexcutepath=chromePath.value
            }
            const firefoxPath=external_system_group.settings.find((item)=>item.key===firefox_path)
            if(firefoxPath){
                localBrowserexcutepath=firefoxPath.value
            }
        }
        if(data.localBrowser=="chrome"&&!localBrowserexcutepath){
            
            const localBrowserexcutepathresult=getChromeExcutepath()
            if(localBrowserexcutepathresult){
                localBrowserexcutepath=localBrowserexcutepathresult
            }

        }else if(data.localBrowser=="firefox"&&!localBrowserexcutepath){
            const localBrowserexcutepathresult=getFirefoxExcutepath()
            if(localBrowserexcutepathresult){
                localBrowserexcutepath=localBrowserexcutepathresult
            }
        }
        if(!localBrowserexcutepath){
            throw new Error("local browser excute path not exist")
        }
    }
    //let userDataDir=""
    // if(data.useLocalbrowserdata){
    //     userDataDir=getChromeUserDataDir()
    //     if(!userDataDir){
    //         throw new Error("user data dir not exist")
    //     }
    // }
       //console.log("two captcha token value is "+twoCaptchaTokenvalue)
       //console.log("local browser excute path is "+localBrowserexcutepath)
       //console.log("user data dir is "+userDataDir)
        const child = utilityProcess.fork(childPath, [],{stdio:"pipe",execArgv:["puppeteer-cluster:*"],env:{
            ...process.env,
            NODE_OPTIONS: "",
            TWOCAPTCHA_TOKEN: twoCaptchaTokenvalue,
            LOCAL_BROWSER_EXCUTE_PATH: localBrowserexcutepath,
            //USEDATADIR: userDataDir
        }} )
        child.on("spawn", () => {
            console.log("child process satart, pid is"+child.pid)
            this.updateTaskStatus(taskId,SearchTaskStatus.Processing)
            child.postMessage(JSON.stringify({action:"searchscraper",data:data}),[port1])
           // this.searhModel.updateTaskLog(taskId,runLogfile,errorLogfile)
        })
        
        child.stdout?.on('data', (data) => {
            console.log(`Received data chunk ${data}`)
            WriteLog(runLogfile,data)
           // child.kill()
        })
        child.stderr?.on('data', (data) => {
            const ingoreStr=["Debugger attached","Waiting for the debugger to disconnect","Most NODE_OPTIONs are not supported in packaged apps"]
            if(!ingoreStr.some((value)=>data.includes(value))){
                    
            // seModel.saveTaskerrorlog(taskId,data)
            console.log(`Received error chunk ${data}`)
            WriteLog(errorLogfile,data)
            this.updateTaskStatus(taskId,SearchTaskStatus.Error)
            //child.kill()
            }
            
        })
        child.on("exit", (code) => {
            if (code !== 0) {
                console.error(`Child process exited with code ${code}`);
                this.updateTaskStatus(taskId,SearchTaskStatus.Error)
            } else {
                this.updateTaskStatus(taskId,SearchTaskStatus.Complete)
                console.log('Child process exited successfully');
            }
        })
        child.on('message', (message) => {
            console.log("get message from child")
            console.log('Message from child:', JSON.parse(message));
            const childdata=JSON.parse(message)
            if(childdata.action=="savesearchresult"){
                //save result
                this.saveSearchResult(childdata.data,taskId)
                this.updateTaskStatus(taskId,SearchTaskStatus.Complete)
                child.kill()
            }
        });
    }

    //save search task, call it when user start search keyword
    public async saveSearchtask(data: SearchDataParam): Promise<number> {
        console.log("save search task")
        // const tokenService = new Token()
        // const dbpath = await tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        //const searchtask = new SearchTaskdb(this.dbpath)
        const enginId = this.convertSEtoNum(data.engine)
        console.log("enginId is"+enginId)
        if (!enginId) {
            throw new Error("enginerId empty")
        }
        const taskId = await this.taskdbModel.saveSearchTask(enginId, data.num_pages, data.concurrency, data.notShowBrowser, data.localBrowser)
        //const searshdb = new SearchKeyworddb(this.dbpath)
        for (const keyword of data.keywords) {
            await this.serKeywordModel.saveSearchKeyword(keyword, Number(taskId))
        }
        if (data.proxys) {
            for (const proxy of data.proxys) {
                const proxyEntity = new SearchTaskProxyEntity()
                proxyEntity.task_id = Number(taskId)

                proxyEntity.host = proxy.host
                proxyEntity.port = proxy.port
                proxyEntity.user = proxy.user ? proxy.user : ''
                proxyEntity.pass = proxy.pass ? proxy.pass : ''

                await this.searchTaskProxyModel.create(proxyEntity)
            }
        }
        if (data.accounts) {
            for (const account of data.accounts) {
                const accountEntity = new SearchAccountEntity()
                accountEntity.task_id = Number(taskId)
                accountEntity.account_id = account
                await this.searchAccountModel.create(accountEntity)
            }
        }
        return Number(taskId)
    }

    /**
     * Save search task without running it (status: Not Start)
     * @param data Search task parameters
     * @returns The ID of the created task
     */
    public async saveSearchtaskOnly(data: SearchDataParam): Promise<number> {
        console.log("save search task only")
        const enginId = this.convertSEtoNum(data.engine)
        console.log("enginId is"+enginId)
        if (!enginId) {
            throw new Error("enginerId empty")
        }
        const taskId = await this.taskdbModel.saveSearchTaskOnly(enginId, data.num_pages, data.concurrency, data.notShowBrowser, data.localBrowser)
        
        for (const keyword of data.keywords) {
            await this.serKeywordModel.saveSearchKeyword(keyword, Number(taskId))
        }
        if (data.proxys) {
            for (const proxy of data.proxys) {
                const proxyEntity = new SearchTaskProxyEntity()
                proxyEntity.task_id = Number(taskId)

                proxyEntity.host = proxy.host
                proxyEntity.port = proxy.port
                proxyEntity.user = proxy.user ? proxy.user : ''
                proxyEntity.pass = proxy.pass ? proxy.pass : ''

                await this.searchTaskProxyModel.create(proxyEntity)
            }
        }
        if (data.accounts) {
            for (const account of data.accounts) {
                const accountEntity = new SearchAccountEntity()
                accountEntity.task_id = Number(taskId)
                accountEntity.account_id = account
                await this.searchAccountModel.create(accountEntity)
            }
        }
        return Number(taskId)
    }
    //convert search enginer name to number
    public convertSEtoNum(enginerName: string): number | undefined {
        // const SeachEnginArr = ToArray(SearhEnginer)
        // let enginer = 0
        // SeachEnginArr.forEach((value, key) => {
        //     if (enginerName == value) {
        //         enginer = key
        //     }
        // })
        const enginId = getEnumKeyByValue(SearhEnginer, enginerName)
        return enginId
    }
    //convert search enginer number to name
    public convertNumtoSE(enginerNum: number): string | undefined {
        // const SeachEnginArr = ToArray(SearhEnginer)
        // let enginer = ""
        // SeachEnginArr.forEach((value, key) => {
        //     if (enginerNum == key) {
        //         enginer = value
        //     }
        // })
        const enginerName = getEnumValueByNumber(SearhEnginer, enginerNum)
        return enginerName
    }
    //save search result
    public async saveSearchResult(data: Array<ResultParseItemType>, taskId: number) {
        // console.log("save search result")
        // console.log(`data: ${data}`);
        // const resultsMap = new Map(Object.entries(data.results));
        // console.log(resultsMap);
        for (const item of data) {
            // for (const [key, value] of resultsMap) {
            let keywordId = await this.serKeywordModel.getKeywordId(item.keyword, taskId)
            if (!keywordId) {
                //save keyword
                await this.serKeywordModel.saveSearchKeyword(item.keyword, taskId)
                keywordId = await this.serKeywordModel.getKeywordId(item.keyword, taskId)
            }
            //console.log(value)
            //const resval = new Map(Object.entries(value));
            const linkearr: Array<string> = []
            //    for (const [rvkey, rvvalue] of resval) {
            //console.log(rvkey)
            //console.log(rvvalue.value)
            //if(rvvalue.value){
            if (item.results && item.results.length > 0) {
                for (const sitem of item.results) {
                    //    console.log(`item: ${item}`);
                    if (sitem.link && sitem.link.length > 0) {
                        if (!linkearr.includes(sitem.link)) {
                            //    console.log(`item.link: ${sitem.link}`);
                            const reEntity: SearchResEntity = {
                                keyword_id: Number(keywordId),
                                link: sitem.link,
                                title: sitem.title,
                                snippet: sitem.snippet,
                                visible_link: sitem.visible_link,
                            }
                            const res = await this.serResultModel.saveResult(reEntity)
                            console.log(`save result is: ${res}`);
                            linkearr.push(sitem.link)
                        }
                    }
                }
            }
        }
        //console.log(`Saving result for key: ${key}, value: ${value}`);
        //}
    }

    public async saveTaskerrorlog(taskId: number, errorLog: string) {
        // const tokenService = new Token()
        // const dbpath = await tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        //const taskdbModel=new SearchTaskdb(this.dbpath)
        this.taskdbModel.updateTaskLog(taskId, errorLog)
    }
    //return data for search list 
    public async listSearchtask(page: number, size: number, sortBy?: SortBy): Promise<SearchtaskEntityNum> {
        // const tokenService = new Token()
        // const dbpath = await tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        //const taskdbModel=new SearchTaskdb(this.dbpath)
        const tasklist = await this.taskdbModel.listTask(page, size, sortBy)
        // const searchKeydb=new SearchKeyworddb(this.dbpath)
        const taskdata: Array<SearchtaskItem> = []

        //convert task list to search item list

        for (const item of tasklist) {
            //console.log("item is follow")
            //console.log(item)
            const keywords = await this.serKeywordModel.getKeywordsByTask(item.id)
            const data: SearchtaskItem = {
                id: item.id,
                enginer_name: this.convertNumtoSE(Math.round(item.enginer_id)),
                status: this.taskdbModel.taskStatusToString(item.status),
                keywords: keywords,
                record_time: item.record_time
            }
            data.keywordline = data.keywords.join(',')

            taskdata.push(data)
        }
        //check number
        const number = await this.taskdbModel.getTaskTotal()
        const data: SearchtaskEntityNum = {
            total: number,
            records: taskdata
        }
        return data
    }
    //upate task status
    public async updateTaskStatus(taskId: number, status: SearchTaskStatus) {
        await this.taskdbModel.updateTaskStatus(taskId, status)
    }

    //get search result list by task id
    public async listSearchResult(taskId: number, page: number, size: number): Promise<Array<SearchResEntity>> {
        const keyarr = await this.getKeywrodsbyTask(taskId)
        return await this.serResultModel.listSearchresult(keyarr, page, size)
    }

    public async countSearchResult(taskId: number): Promise<number> {
        const keyarr = await this.getKeywrodsbyTask(taskId)
        return await this.serResultModel.countSearchResult(keyarr)
    }

    //get keywords id by task id
    public async getKeywrodsbyTask(taskId: number): Promise<Array<number>> {
        const keywordEnArr = await this.serKeywordModel.getKeywordsEntityByTask(taskId)
        return keywordEnArr.map(item => item.id)
    }
    //update task runtime log and error log path
    public async updateTaskLog(taskId: number, runtimeLog: string, errorLog: string) {
        if (runtimeLog) {
            await this.taskdbModel.updateRuntimeLog(taskId, runtimeLog)
        }
        if (errorLog) {
            await this.taskdbModel.updateTaskLog(taskId, errorLog)
        }
    }
    //get task log by task id
    public async getTaskErrorLog(taskId: number): Promise<string> {
        const task = await this.taskdbModel.getTaskEntity(taskId)
        if (!task) {
            throw new Error("task not exist")
        }
        try {
            console.log(task)
            const absolutePath = path.resolve(task.error_log);
            const content = fs.readFileSync(absolutePath, 'utf-8');
            return content;
        } catch (error) {
            console.error(`Error reading file at ${task.error_log}:`, error);
            throw error;
        }


    }
    //get search task entity by id
    public async getkeywrodsEntitybyId(keywordId: number) {
        return await this.serKeywordModel.getKeywordsEntityById(keywordId)
    }
    //get task entity by id
    public async getTaskEntityById(taskId: number): Promise<SearchDataParam | null> {

        const taskEntity = await this.taskdbModel.getTaskEntity(taskId)
        if (!taskEntity) {
            return null
        }
        const keywords = await this.serKeywordModel.getKeywordsEntityByTask(taskId)
        const proxys = await this.searchTaskProxyModel.getItemsByTaskId(taskId)

        //get accounts by task id
        const accounts = await this.searchAccountModel.getAccountByTaskId(taskId)
        const accountList = accounts.map(item => item.account_id)

        const cookiesArray: Array<Array<CookiesType>> = []
        if (accounts) {
            for (const account of accountList) {
                const cookies = await this.accountCookiesModule.getAccountCookies(account)
                if (cookies) {
                    const cookiesits: Array<CookiesType> = JSON.parse(cookies.cookies)
                    cookiesArray.push(cookiesits)
                }
            }
        }
        //get accounts by task id
        const data: SearchDataParam = {
            engine: taskEntity.enginer_id.toString(),
            keywords: keywords.map(item => item.keyword),
            num_pages: taskEntity.num_pages,
            concurrency: taskEntity.concurrency,
            notShowBrowser: taskEntity.notShowBrowser ? true : false,
            //useLocalbrowserdata:taskEntity.useLocalbrowserdata?true:false,
            localBrowser: taskEntity.localBrowser ? taskEntity.localBrowser : "",
            proxys: proxys.map(item => {
                return {
                    host: item.host,
                    port: item.port,
                    user: item.user,
                    pass: item.pass
                }
            }),
            error_log: taskEntity.error_log,
            run_log: taskEntity.runtime_log,
            accounts: accountList,
            cookies: cookiesArray
        }
        return data
    }

    /**
     * Update search task with new parameters
     * @param taskId The task ID to update
     * @param updates The updated task parameters
     * @returns True if update was successful
     */
    public async updateSearchTask(taskId: number, updates: SearchTaskUpdateData): Promise<boolean> {
        // Check if task exists and is editable
        const isEditable = await this.taskdbModel.isTaskEditable(taskId);
        if (!isEditable) {
            throw new Error("search.task_cannot_be_edited");
        }

        // Get current task entity
        const currentTask = await this.taskdbModel.getTaskEntity(taskId);
        if (!currentTask) {
            throw new Error("Task not found");
        }

        // Prepare updates for the main task entity
        const taskUpdates: SearchTaskUpdateFields = {};
        
        if (updates.num_pages !== undefined) {
            taskUpdates.num_pages = updates.num_pages;
        }
        
        if (updates.concurrency !== undefined) {
            taskUpdates.concurrency = updates.concurrency;
        }
        
        if (updates.notShowBrowser !== undefined) {
            taskUpdates.notShowBrowser = updates.notShowBrowser ? 1 : 0;
        }
        
        if (updates.localBrowser !== undefined) {
            taskUpdates.localBrowser = updates.localBrowser;
        }

        // Update record time to indicate modification
        taskUpdates.record_time = getRecorddatetime();

        // Convert engine name to engine id
        if (updates.engine) {
            const engineId = await this.convertSEtoNum(updates.engine);
            if (engineId) {
                taskUpdates.enginer_id = engineId;
            }
        }

        // Update the main task entity
        const taskUpdateSuccess = await this.taskdbModel.updateSearchTask(taskId, taskUpdates);
        if (!taskUpdateSuccess) {
            throw new Error("Failed to update task entity");
        }

        // Update keywords if provided
        if (updates.keywords !== undefined) {
            // Get existing keywords for this task
            const existingKeywords = await this.serKeywordModel.getKeywordsByTask(taskId);
            const newKeywords = updates.keywords;
            
            // Find keywords to add (new keywords that don't exist)
            const keywordsToAdd = newKeywords.filter(keyword => !existingKeywords.includes(keyword));
            
            // Find keywords to remove (existing keywords that are not in new submission)
            const keywordsToRemove = existingKeywords.filter(keyword => !newKeywords.includes(keyword));
            
            // Add new keywords
            for (const keyword of keywordsToAdd) {
                await this.serKeywordModel.saveSearchKeyword(keyword, taskId);
            }
            
            // Remove keywords that are no longer in the submission
            for (const keyword of keywordsToRemove) {
                await this.serKeywordModel.deleteKeyword(keyword, taskId);
            }
        }

        // Update proxies if provided
        if (updates.proxys !== undefined) {
            // For proxies, we'll recreate them
            for (const proxy of updates.proxys) {
                const proxyEntity = new SearchTaskProxyEntity();
                proxyEntity.task_id = taskId;
                proxyEntity.host = proxy.host;
                proxyEntity.port = proxy.port.toString();
                proxyEntity.user = proxy.user || '';
                proxyEntity.pass = proxy.pass || '';
                await this.searchTaskProxyModel.create(proxyEntity);
            }
        }

        // Update accounts if provided
        if (updates.accounts !== undefined) {
            // For accounts, we'll recreate them
            for (const accountId of updates.accounts) {
                const accountEntity = new SearchAccountEntity();
                accountEntity.task_id = taskId;
                accountEntity.account_id = accountId as number;
                await this.searchAccountModel.create(accountEntity);
            }
        }
       

        // Reset task status to NotStart since it's been modified
        await this.taskdbModel.updateTaskStatus(taskId, SearchTaskStatus.NotStart);

        return true;
    }

    /**
     * Check if a task is editable based on its status
     * @param taskId The task ID
     * @returns True if the task can be edited
     */
    public async isTaskEditable(taskId: number): Promise<boolean> {
        return await this.taskdbModel.isTaskEditable(taskId);
    }

    /**
     * Get task status by task ID
     * @param taskId The task ID
     * @returns The task status or null if task doesn't exist
     */
    public async getTaskStatus(taskId: number): Promise<SearchTaskStatus | null> {
        const taskEntity = await this.taskdbModel.getTaskEntity(taskId);
        return taskEntity ? taskEntity.status : null;
    }

    /**
     * Get task details for editing
     * @param taskId The task ID
     * @returns Task details suitable for editing
     */
    public async getTaskDetailsForEdit(taskId: number): Promise<TaskDetailsForEdit> {
        const taskEntity = await this.taskdbModel.getTaskEntity(taskId);
        if (!taskEntity) {
            throw new Error("Task not found");
        }

        const keywords = await this.serKeywordModel.getKeywordsEntityByTask(taskId);
        const proxys = await this.searchTaskProxyModel.getItemsByTaskId(taskId);
        const accounts = await this.searchAccountModel.getAccountByTaskId(taskId);
        const engineName=this.convertNumtoSE(Number(taskEntity.enginer_id))
        return {
            id: taskEntity.id,
            engine: Number(taskEntity.enginer_id),
            engineName:engineName,
            keywords: keywords.map(item => item.keyword),
            num_pages: taskEntity.num_pages,
            concurrency: taskEntity.concurrency,
            notShowBrowser: taskEntity.notShowBrowser ? true : false,
            localBrowser: taskEntity.localBrowser || "",
            proxys: proxys.map(item => ({
                host: item.host,
                port: parseInt(item.port, 10),
                user: item.user,
                pass: item.pass
            })),
            accounts: accounts.map(item => item.account_id),
            status: taskEntity.status,
            record_time: taskEntity.record_time
        };
    }


}
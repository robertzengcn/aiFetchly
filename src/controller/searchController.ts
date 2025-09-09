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
import {SearchModule} from "@/modules/searchModule"
import { Token } from "@/modules/token"
// import {USERSDBPATH} from '@/config/usersetting';
import {SearchDataParam,SearchResEntityDisplay,SearchResEntityRecord} from "@/entityTypes/scrapeType"
import {TaskDetailsForEdit} from "@/modules/searchModule"
// import {SEARCHEVENT} from "@/config/channellist"
// import { SearchTaskStatus } from "@/model/SearchTask.model"
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
import { 
    MCPRequest, 
    MCPResponse, 
    MCPSearchRequest, 
    MCPSearchData, 
    MCPSearchResult, 
    MCPSearchMetadata,
    MCPTaskCreateRequest,
    MCPTaskUpdateRequest,
    MCPTask,
    MCPTaskListData,
    MCPPaginationParams,
    createMCPSuccessResponse,
    createMCPErrorResponse,
    createMCPError,
    MCPErrorCode
} from '@/mcp-server/types/mcpTypes';
export class SearchController {
    private searchModel:SearchModule;
    // private accountCookiesModule: AccountCookiesModule;
   //private systemSettingGroupModule: SystemSettingGroupModule
    constructor() {
        // this.accountCookiesModule=new AccountCookiesModule()
        this.searchModel=new SearchModule()
        //this.systemSettingGroupModule=new SystemSettingGroupModule()
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
    public async listSearchresult(page:number,size:number,sortBy?:SortBy):Promise<SearchtaskEntityNum>{
        // const seModel=new searhModel()
        // await seModel.init();
        const res=await this.searchModel.listSearchtask(page,size, sortBy)
        return res;
    }   
    //list task search result
    public async listtaskSearchResult(taskId:number,page:number,size:number):Promise<SearchResEntityRecord>{
        // const seModel=new searhModel()
        const res=await this.searchModel.listSearchResult(taskId,page,size)

        const datas: Array<SearchResEntityDisplay> = []
        //const SearchKeyDb=new SearchKeyworddb(this.dbpath)

        res.forEach(async (item) => {
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
        })
        //return datas

        const total=await this.searchModel.countSearchResult(taskId)
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
     * Handle MCP requests for search functionality
     * This method acts as an adapter between MCP requests and the existing search business logic
     */
    public async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            const { tool, parameters } = request;

            switch (tool) {
                case 'search_google':
                case 'search_bing':
                    return await this.handleSearchRequest(parameters as MCPSearchRequest, tool);
                
                case 'create_search_task':
                    return await this.handleCreateTaskRequest(parameters as MCPTaskCreateRequest);
                
                case 'list_search_tasks':
                    return await this.handleListTasksRequest(parameters as MCPPaginationParams);
                
                case 'get_search_task':
                    return await this.handleGetTaskRequest(parameters.taskId as number);
                
                case 'update_search_task':
                    return await this.handleUpdateTaskRequest(parameters as MCPTaskUpdateRequest);
                
                case 'get_search_results':
                    return await this.handleGetSearchResultsRequest(parameters as { taskId: number } & MCPPaginationParams);
                
                case 'retry_search_task':
                    return await this.handleRetryTaskRequest(parameters.taskId as number);
                
                case 'get_task_error_log':
                    return await this.handleGetTaskErrorLogRequest(parameters.taskId as number);
                
                case 'get_task_details_for_edit':
                    return await this.handleGetTaskDetailsForEditRequest(parameters.taskId as number);
                
                default:
                    return createMCPErrorResponse(
                        createMCPError(MCPErrorCode.INVALID_PARAMETERS, `Unknown search tool: ${tool}`),
                        'Invalid search tool requested'
                    );
            }
        } catch (error) {
            console.error('Error in SearchController.handleMCPRequest:', error);
            return createMCPErrorResponse(
                createMCPError(
                    MCPErrorCode.INTERNAL_ERROR,
                    'Internal error occurred while processing search request',
                    error instanceof Error ? error.message : String(error),
                    error instanceof Error ? error.stack : undefined
                ),
                'Failed to process search request'
            );
        }
    }

    /**
     * Handle search engine requests (Google/Bing)
     */
    private async handleSearchRequest(params: MCPSearchRequest, engine: string): Promise<MCPResponse<MCPSearchData>> {
        try {
            // Convert MCP search parameters to internal format
            const searchParams: Usersearchdata = {
                searchEnginer: engine === 'search_google' ? 'google' : 'bing',
                keywords: [params.query], // Convert single query to array
                num_pages: params.pages || 1,
                concurrency: 1, // Default concurrency
                notShowBrowser: true, // Default to headless
                localBrowser: 'chrome' // Default browser
            };

            // Create and run the search task
            const taskId = await this.createTask({
                engine: engine === 'search_google' ? 'google' : 'bing',
                keywords: [params.query]
            } as SearchDataParam);

            await this.runSearchTask(taskId);

            // Get the search results
            const results = await this.listtaskSearchResult(taskId, 1, 100); // Get first 100 results

            // Convert to MCP format
            const mcpResults: MCPSearchResult[] = results.record.map((record, index) => ({
                title: record.title || '',
                url: record.link || '',
                description: record.snippet || '',
                position: index + 1,
                domain: record.link ? new URL(record.link).hostname : '',
                type: 'organic' as const,
                snippet: record.snippet || undefined,
                publishedDate: record.record_time || undefined
            }));

            const mcpSearchData: MCPSearchData = {
                results: mcpResults,
                metadata: {
                    query: params.query,
                    totalResults: results.total,
                    processingTime: 0, // This would need to be tracked
                    page: 1,
                    engine: engine,
                    timestamp: new Date().toISOString()
                }
            };

            return createMCPSuccessResponse(mcpSearchData, 'Search completed successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle create task requests
     */
    private async handleCreateTaskRequest(params: MCPTaskCreateRequest): Promise<MCPResponse<MCPTask>> {
        try {
            // Convert MCP task parameters to internal format
            const searchData: SearchDataParam = {
                engine: params.parameters.engine as string,
                keywords: params.parameters.keywords as string[] || []
            };

            const taskId = await this.createTask(searchData);

            // Convert to MCP task format
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: params.name,
                description: params.description,
                type: params.type,
                status: 'pending',
                parameters: params.parameters,
                priority: params.priority || 'medium',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            return createMCPSuccessResponse(mcpTask, 'Task created successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle list tasks requests
     */
    private async handleListTasksRequest(params: MCPPaginationParams): Promise<MCPResponse<MCPTaskListData>> {
        try {
            const page = params.page || 1;
            const size = params.size || 20;
            const sortBy: SortBy | undefined = params.sortBy ? {
                key: params.sortBy,
                order: params.sortOrder || 'desc'
            } : undefined;

            const result = await this.listSearchresult(page, size, sortBy);

            // Convert to MCP format
            const mcpTasks: MCPTask[] = result.records.map(task => ({
                id: task.id.toString(),
                name: `Search Task ${task.id}`,
                description: `Keywords: ${task.keywords.join(', ')}`,
                type: 'search',
                status: this.mapTaskStatus(task.status),
                parameters: {
                    keywords: task.keywords,
                    engine: task.enginer_name
                },
                priority: 'medium',
                createdAt: task.record_time || new Date().toISOString(),
                updatedAt: task.record_time || new Date().toISOString()
            }));

            const taskListData: MCPTaskListData = {
                tasks: mcpTasks,
                pagination: {
                    items: mcpTasks,
                    total: result.total,
                    page: page,
                    size: size,
                    totalPages: Math.ceil(result.total / size)
                }
            };

            return createMCPSuccessResponse(taskListData, 'Tasks retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get task requests
     */
    private async handleGetTaskRequest(taskId: number): Promise<MCPResponse<MCPTask>> {
        try {
            const taskDetails = await this.getTaskDetailsForEdit(taskId);
            
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: `Search Task ${taskId}`,
                description: `Keywords: ${taskDetails.keywords.join(', ')}`,
                type: 'search',
                status: this.mapTaskStatus(taskDetails.status.toString()),
                parameters: {
                    keywords: taskDetails.keywords,
                    engine: taskDetails.engineName,
                    concurrency: taskDetails.concurrency,
                    numPages: taskDetails.num_pages,
                    showBrowser: !taskDetails.notShowBrowser
                },
                priority: 'medium',
                createdAt: taskDetails.record_time || new Date().toISOString(),
                updatedAt: taskDetails.record_time || new Date().toISOString()
            };

            return createMCPSuccessResponse(mcpTask, 'Task retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle update task requests
     */
    private async handleUpdateTaskRequest(params: MCPTaskUpdateRequest): Promise<MCPResponse<MCPTask>> {
        try {
            const taskId = parseInt(params.taskId);
            
            // Convert MCP update parameters to internal format
            const updates: any = {};
            if (params.name) updates.name = params.name;
            if (params.description) updates.description = params.description;
            if (params.parameters) {
                if (params.parameters.keywords) updates.keywords = params.parameters.keywords;
                if (params.parameters.concurrency) updates.concurrency = params.parameters.concurrency;
                if (params.parameters.numPages) updates.num_pages = params.parameters.numPages;
                if (params.parameters.showBrowser !== undefined) updates.notShowBrowser = !params.parameters.showBrowser;
            }

            await this.updateSearchTask(taskId, updates);

            // Get updated task details
            const taskDetails = await this.getTaskDetailsForEdit(taskId);
            
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: params.name || `Search Task ${taskId}`,
                description: params.description || `Keywords: ${taskDetails.keywords.join(', ')}`,
                type: 'search',
                status: this.mapTaskStatus(taskDetails.status.toString()),
                parameters: {
                    keywords: taskDetails.keywords,
                    engine: taskDetails.engineName,
                    concurrency: taskDetails.concurrency,
                    numPages: taskDetails.num_pages,
                    showBrowser: !taskDetails.notShowBrowser
                },
                priority: 'medium',
                createdAt: taskDetails.record_time || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            return createMCPSuccessResponse(mcpTask, 'Task updated successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get search results requests
     */
    private async handleGetSearchResultsRequest(params: { taskId: number } & MCPPaginationParams): Promise<MCPResponse<MCPSearchData>> {
        try {
            const page = params.page || 1;
            const size = params.size || 20;
            
            const results = await this.listtaskSearchResult(params.taskId, page, size);

            // Convert to MCP format
            const mcpResults: MCPSearchResult[] = results.record.map((record, index) => ({
                title: record.title || '',
                url: record.link || '',
                description: record.snippet || '',
                position: (page - 1) * size + index + 1,
                domain: record.link ? new URL(record.link).hostname : '',
                type: 'organic' as const,
                snippet: record.snippet || undefined,
                publishedDate: record.record_time || undefined
            }));

            const searchData: MCPSearchData = {
                results: mcpResults,
                metadata: {
                    query: '', // This would need to be retrieved from task details
                    totalResults: results.total,
                    processingTime: 0,
                    page: page,
                    engine: 'unknown',
                    timestamp: new Date().toISOString()
                }
            };

            return createMCPSuccessResponse(searchData, 'Search results retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle retry task requests
     */
    private async handleRetryTaskRequest(taskId: number): Promise<MCPResponse> {
        try {
            await this.retryTask(taskId);
            return createMCPSuccessResponse(null, 'Task retry initiated successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get task error log requests
     */
    private async handleGetTaskErrorLogRequest(taskId: number): Promise<MCPResponse<{ log: string }>> {
        try {
            const log = await this.getTaskErrorlog(taskId);
            return createMCPSuccessResponse({ log }, 'Error log retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get task details for edit requests
     */
    private async handleGetTaskDetailsForEditRequest(taskId: number): Promise<MCPResponse<TaskDetailsForEdit>> {
        try {
            const taskDetails = await this.getTaskDetailsForEdit(taskId);
            return createMCPSuccessResponse(taskDetails, 'Task details retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Helper method to map internal engine names to IDs
     */
    private getEngineId(engine: string): number {
        switch (engine.toLowerCase()) {
            case 'google':
                return 1;
            case 'bing':
                return 2;
            default:
                return 1; // Default to Google
        }
    }

    /**
     * Helper method to map internal task status to MCP status
     */
    private mapTaskStatus(status: string): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' {
        switch (status.toLowerCase()) {
            case 'notstart':
            case 'pending':
                return 'pending';
            case 'processing':
            case 'running':
                return 'running';
            case 'complete':
            case 'completed':
                return 'completed';
            case 'error':
            case 'failed':
                return 'failed';
            case 'cancel':
            case 'cancelled':
                return 'cancelled';
            default:
                return 'pending';
        }
    }


}
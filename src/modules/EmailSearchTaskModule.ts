//import { Token } from "@/modules/token"
//import { USERSDBPATH } from '@/config/usersetting';
import { EmailsearchTaskModel } from '@/model/EmailsearchTask.model'
import { EmailsearchTaskUrlModel } from '@/model/EmailsearchTaskUrl.model'
import { EmailResult, EmailResultDisplay } from "@/entityTypes/emailextraction-type"
import { EmailsearchResultModel } from "@/model/EmailsearchResult.model"
import { EmailsearchResultDetailModel } from "@/model/EmailsearchResultDetail.model"
import { EmailExtractionTypes } from "@/config/emailextraction"
import { SortBy, TaskStatus } from "@/entityTypes/commonType"
import {EmailItem} from '@/entityTypes/emailmarketingType'
import { BaseModule } from "@/modules/baseModule";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";
import { EmailSearchResultDetailEntity } from "@/entity/EmailSearchResultDetail.entity";
import { EmailsearchTaskEntity, EmailsearchTaskStatus } from "@/model/emailsearchTaskdb";
import { EmailsearchUrlEntity } from "@/model/emailsearchUrldb";
import {EmailsControldata} from "@/entityTypes/emailextraction-type"
import { AggregatedCount } from "@/entityTypes/dashboardType";
import {WriteLog,getApplogspath,getRandomValues, readLogFile} from "@/modules/lib/function"
import * as path from 'path';
import * as fs from 'fs';
import { MessageChannelMain } from 'electron';
import { Token } from '@/modules/token';
import { USERLOGPATH, USEREMAIL } from '@/config/usersetting';
import { utilityProcess } from 'electron';
import { ProcessMessage } from '@/entityTypes/processMessage-type';
import { v4 as uuidv4 } from 'uuid';
import { twocaptchagroup, twocaptcha_enabled, twocaptchatoken } from '@/config/settinggroupInit';
import { SystemSettingGroupModule } from '@/modules/SystemSettingGroupModule';
import { EmailSearchTaskEntity } from '@/entity/EmailSearchTask.entity'
import { IEmailSearchTaskProxyModuleInterface } from './interface/IEmailSearchTaskProxyModuleInterface'
import { EmailSearchTaskProxyModule } from './EmailSearchTaskProxyModule'
import { ProxyEntity } from '@/entity/Proxy.entity'

export class EmailSearchTaskModule extends BaseModule{
    //private dbpath: string
    private emailsearchTaskdb: EmailsearchTaskModel
    private emailsearchUrldb: EmailsearchTaskUrlModel
    private emailsearchresultdb: EmailsearchResultModel
    private emailsearchResultDetaildb: EmailsearchResultDetailModel
    private systemSettingGroupModule: SystemSettingGroupModule
    private emailsearchTaskProxydb: IEmailSearchTaskProxyModuleInterface
    constructor() {
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        super();
        // this.dbpath = dbpath
        this.emailsearchTaskdb = new EmailsearchTaskModel(this.dbpath);
        this.emailsearchUrldb = new EmailsearchTaskUrlModel(this.dbpath)
        this.emailsearchresultdb = new EmailsearchResultModel(this.dbpath)
        this.emailsearchResultDetaildb = new EmailsearchResultDetailModel(this.dbpath)
        this.systemSettingGroupModule = new SystemSettingGroupModule()
    this.emailsearchTaskProxydb=new EmailSearchTaskProxyModule()
    }
    public async getEmailContoldata(taskid:number):Promise<EmailsControldata>{
        const task=await this.emailsearchTaskdb.getTaskById(taskid)
        if(!task){
            throw new Error("task not found")
        }
        const urls=await this.emailsearchUrldb.getAllUrlsByTaskId(taskid)
        const urlsArr:string[]=[]
        for(const url of urls){
            urlsArr.push(url.url)
        }
        //get email search task proxy
        const  proxy=await this.emailsearchTaskProxydb.getEmailSearchTaskProxiesByTaskId(taskid)
        const proxyArr:ProxyEntity[]=[]
        for(const p of proxy){
            proxyArr.push(p.proxy)
        }
        const data:EmailsControldata={
            searchResultId:task.search_result_id,
            validUrls:urlsArr,
            concurrency:task.concurrency,
            pagelength:task.page_length,
            notShowBrowser:task.notShowBrowser,
            proxys:proxyArr,
            type:task.type_id,
            processTimeout:task.processTimeout,
            maxPageNumber:task.maxPageNumber
        }
        return data
    }
    public async searchEmail(taskId: number) {
        //save search email task
       // const taskId=await this.saveSearchtask(data)
       const data=await this.getEmailContoldata(taskId)
        const childPath = path.join(__dirname, 'taskCode.js')
        if (!fs.existsSync(childPath)) {
            throw new Error("child js path not exist for the path " + childPath);
        }

        const { port1, port2 } = new MessageChannelMain()
        const tokenService=new Token()

        let twoCaptchaTokenvalue = ""
                const twoCaptchaToken = await this.systemSettingGroupModule.getGroupItembyName(twocaptchagroup)
                if (twoCaptchaToken) {
                    //find 2captcha enable key
                    const twocaptchenable = twoCaptchaToken.settings.find((item) => item.key === twocaptcha_enabled)
                    if (twocaptchenable) {
                        const token = twoCaptchaToken.settings.find((item) => item.key === twocaptchatoken)
                        if (token) {
                            twoCaptchaTokenvalue = token.value
                        }
                    }
                }
        
        const child = utilityProcess.fork(childPath, [],{stdio:"pipe",execArgv:["--inspect"],env:{
            ...process.env,
            NODE_OPTIONS: "",
             TWOCAPTCHA_TOKEN: twoCaptchaTokenvalue
        }} )
        // console.log(path.join(__dirname, 'utilityCode.js'))
        let logpath=tokenService.getValue(USERLOGPATH)
        if(!logpath){
            const useremail=tokenService.getValue(USEREMAIL)
            //create log path
            logpath=getApplogspath(useremail)
        }
        // console.log(logpath)
        const uuid=uuidv4({random: getRandomValues(new Uint8Array(16))})
        const errorLogfile=path.join(logpath,'emailsearch',taskId.toString()+'_'+uuid+'.error.log')
        const runLogfile=path.join(logpath,'emailsearch',taskId.toString()+'_'+uuid+'.runtime.log')

        child.on("spawn", () => {
            console.log("child process satart, pid is"+child.pid)
            child.postMessage(JSON.stringify({action:"searchEmail",data:data}),[port1])
            this.updateTaskLog(taskId,runLogfile,errorLogfile)
        })
        
        child.stdout?.on('data', (data) => {
            console.log(`Received data chunk ${data}`)
            WriteLog(runLogfile,data)
           // child.kill()
        })
        child.stderr?.on('data', (data) => {
            const ingoreStr=["Debugger attached","Waiting for the debugger to disconnect",
                "Most NODE_OPTIONs are not supported in packaged apps",
               
            ]
            if(!ingoreStr.some((value)=>data.includes(value))){
                    
            // seModel.saveTaskerrorlog(taskId,data)
            console.log(`Received error chunk ${data}`)
            WriteLog(errorLogfile,data)
            //this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Error)
            //child.kill()
            }
            
        })
        child.on("exit", (code) => {
            if (code !== 0) {
                console.error(`Child process exited with code ${code}`);
                this.updateTaskStatus(taskId,TaskStatus.Error)
            } else {
                console.log('Child process exited successfully');
                this.updateTaskStatus(taskId,TaskStatus.Complete)
            }
        })
        child.on('message', (message) => {
            console.log("get message from child")
            console.log('Message from child:', JSON.parse(message));
            const childdata=JSON.parse(message) as ProcessMessage<EmailResult>
            if(childdata.action=="saveres"){
                if(childdata.data){
                //save result
                this.saveSearchResult(taskId,childdata.data)
                
                }
                //child.kill()
            }
        });
    }
    //save search task, call it when user start search email
    public async saveSearchtask(data:EmailsControldata): Promise<number> {
        console.log("save search task")
        // 
        const task=new EmailSearchTaskEntity()
        task.status=TaskStatus.Processing
        task.type_id=data.type
        task.processTimeout=data.processTimeout
        task.maxPageNumber=data.maxPageNumber||0
        task.page_length=data.pagelength||0
        task.concurrency=data.concurrency||0
        task.is_active=true
        task.notShowBrowser=data.notShowBrowser
        task.search_result_id=data.searchResultId||0
        const taskId = await this.emailsearchTaskdb.createTask(task)
        //console.log("task id is" + taskId)
        for (let i = 0; i < data.validUrls.length; i++) {
            // console.log("url is" + urls[i])
            const urltask: EmailsearchUrlEntity = {
                task_id: taskId,
                url: data.validUrls[i],
            }
            await this.emailsearchUrldb.create(urltask)
        }
        // urls.forEach((url: string) => {
        //     const urltask: EmailsearchUrlEntity = {
        //         task_id: taskId,
        //         url: url,
        //     }
        //     this.emailsearchUrldb.create(urltask)
        // })
        return Number(taskId)
    }

    /**
     * Create and execute a search task from a URL list
     * 
     * This method creates a new email search task with the provided URLs and configuration,
     * then immediately starts executing the search task.
     * 
     * @param urls - Array of URLs to search for emails
     * @param options - Optional configuration parameters
     * @param options.type - Email extraction type (default: ManualInputUrl)
     * @param options.concurrency - Number of concurrent requests (default: 1)
     * @param options.pagelength - Page length limit (default: 0)
     * @param options.notShowBrowser - Whether to hide browser (default: false)
     * @param options.proxys - Array of proxy entities (optional)
     * @param options.processTimeout - Process timeout in seconds (default: 30)
     * @param options.maxPageNumber - Maximum number of pages to crawl (default: 0)
     * @param options.searchResultId - Search result ID (optional)
     * @returns Promise resolving to the created task ID
     * @throws {Error} When URLs array is empty or invalid
     * 
     * @example
     * ```typescript
     * const taskId = await emailSearchTaskModule.createAndExecuteTask(
     *   ['https://example.com', 'https://test.com'],
     *   {
     *     concurrency: 2,
     *     notShowBrowser: true,
     *     processTimeout: 60
     *   }
     * );
     * ```
     */
    public async createAndExecuteTask(
        urls: string[],
        options?: {
            type?: EmailExtractionTypes;
            concurrency?: number;
            pagelength?: number;
            notShowBrowser?: boolean;
            proxys?: ProxyEntity[];
            processTimeout?: number;
            maxPageNumber?: number;
            searchResultId?: number;
        }
    ): Promise<number> {
        // Validate URLs
        if (!urls || urls.length === 0) {
            throw new Error('URL list cannot be empty');
        }

        // Filter out empty or invalid URLs
        const validUrls = urls.filter(url => url && url.trim().length > 0);
        if (validUrls.length === 0) {
            throw new Error('No valid URLs provided');
        }

        // Create EmailsControldata with defaults
        const taskData: EmailsControldata = {
            validUrls: validUrls,
            type: options?.type ?? EmailExtractionTypes.ManualInputUrl,
            concurrency: options?.concurrency ?? 1,
            pagelength: options?.pagelength ?? 0,
            notShowBrowser: options?.notShowBrowser ?? false,
            proxys: options?.proxys,
            processTimeout: options?.processTimeout ?? 30,
            maxPageNumber: options?.maxPageNumber ?? 0,
            searchResultId: options?.searchResultId
        };

        // Create the task
        const taskId = await this.saveSearchtask(taskData);

        // Execute the search task
        await this.searchEmail(taskId);

        return taskId;
    }

    //update task runtime log and error log path
    public async updateTaskLog(taskId: number, runtimeLog: string, errorLog: string) {
        if (runtimeLog) {
            await this.emailsearchTaskdb.updateruntimelog(taskId, runtimeLog)
        }
        if (errorLog) {
            await this.emailsearchTaskdb.updatetasklog(taskId, errorLog)
        }
    }
    //upate task status
    public async updateTaskStatus(taskId: number, status: TaskStatus) {
        await this.emailsearchTaskdb.updateTaskStatus(taskId, status)
    }
    //save search result
    public async saveSearchResult(taskId: number, res: EmailResult) {
        //convert url to domain
        const url = new URL(res.url);
        const domain = url.hostname;
        const data = new EmailSearchResultEntity()
        data.task_id = taskId
        data.url = domain
        data.title = res.pageTitle
        const resultId = await this.emailsearchresultdb.create(data)
        if (!resultId) {
            throw new Error("save search result failed")
        }
        //save email result detail
        for (const email of res.emails) {
            const emailData = new EmailSearchResultDetailEntity();
            emailData.result_id = resultId;
            emailData.email = email;
            await this.emailsearchResultDetaildb.create(emailData);
        }
    }
    //list email search task
    public async listSearchtask(page: number, size: number, sortby?: SortBy): Promise<{ records: EmailSearchTaskEntity[], total: number }> {
        return await this.emailsearchTaskdb.listSearchtask(page, size, sortby)
    }
    //convert task status to string
    public taskstatusConvert(status: TaskStatus): string {
        return this.emailsearchTaskdb.statusConvert(status)
    }
    public taskTypeconvert(typeId: EmailExtractionTypes): string {
        return this.emailsearchTaskdb.convertType(typeId)
    }
    //get task urls
    public async getTaskurls(taskId: number, page: number, size: number): Promise<string[]> {
        const res = await this.emailsearchUrldb.getUrls(taskId, page, size)
        const urls: string[] = []
        for (const value of res) {
            urls.push(value.url)
        }
        return urls
    }
    //get task result
    public async getTaskResult(taskId: number, page: number, size: number): Promise<EmailResultDisplay[]> {
        console.log("get task result,task id is" + taskId)
        const res = await this.emailsearchresultdb.getTaskResult(taskId, page, size)
        const result: EmailResultDisplay[] = []
        for (const value of res) {
            if (!value.id) {
                value.id = 0
            }
            const emails = await this.emailsearchResultDetaildb.getItemsByResultId(value.id)
            const emailsArr: string[] = []
            for (const email of emails) {
                emailsArr.push(email.email)
            }
            if (!value.title) {
                value.title = ""
            }
            // if (!value.record_time) {
            //     value.record_time = ""
            // }

            const item: EmailResultDisplay = {
                id: value.id,
                url: value.url,
                pageTitle: value.title,
                emails: emailsArr,
                recordTime: value.createdAt ? this.formatDateTime(value.createdAt) : ""
            }
            result.push(item)
        }

        return result
    }
    //get all task results for export (no pagination)
    public async getAllTaskResults(taskId: number): Promise<EmailResultDisplay[]> {
        console.log("get all task results for export, task id is" + taskId)
        const res = await this.emailsearchresultdb.getAllResultsByTaskId(taskId)
        const result: EmailResultDisplay[] = []
        for (const value of res) {
            if (!value.id) {
                value.id = 0
            }
            const emails = await this.emailsearchResultDetaildb.getItemsByResultId(value.id)
            const emailsArr: string[] = []
            for (const email of emails) {
                emailsArr.push(email.email)
            }
            if (!value.title) {
                value.title = ""
            }

            const item: EmailResultDisplay = {
                id: value.id,
                url: value.url,
                pageTitle: value.title,
                emails: emailsArr,
                recordTime: value.createdAt ? this.formatDateTime(value.createdAt) : ""
            }
            result.push(item)
        }

        return result
    }
    //get task detail count
    public async getTaskResultCount(taskId: number): Promise<number> {
        return await this.emailsearchresultdb.getTaskResultCount(taskId)
    }
    public async countAllResults(): Promise<number> {
        return this.emailsearchresultdb.countAll();
    }
    public async countResultsByDateRange(startDate: Date, endDate: Date): Promise<number> {
        return this.emailsearchresultdb.countByDateRange(startDate, endDate);
    }
    public async aggregateResultsByDateRange(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<AggregatedCount[]> {
        const rows = await this.emailsearchresultdb.aggregateByDateRange(startDate, endDate, granularity);
        return rows.map(row => ({ date: row.date, count: row.count }));
    }
    //get all email in email search task
    public async getAllEmails(taskId: number): Promise<EmailItem[]> {
        const res = await this.emailsearchresultdb.getTaskResultCount(taskId)
        const emails: EmailItem[] = []
        const loopNum = 100
        for (let i = 0; i < res; i = i + loopNum) {
            const result = await this.emailsearchresultdb.getTaskResult(taskId, i, loopNum)
            for (const value of result) {
                if(value.id){
                    const emailsArr = await this.emailsearchResultDetaildb.getItemsByResultId(value.id)
                    for (const email of emailsArr) {
                        const emailItem: EmailItem = {
                            title: value.title,
                            address: email.email,
                            source: value.url
                        }
                        emails.push(emailItem)
                    }
                }
            }
        }
        return emails
    }
    //get task detail by task id
    public async getTaskDetail(taskId: number): Promise<EmailSearchTaskEntity | undefined> {
        return await this.emailsearchTaskdb.getTaskById(taskId);
    }

    // Get task proxies
    public async getTaskProxies(taskId: number): Promise<ProxyEntity[]> {
        const proxies = await this.emailsearchTaskProxydb.getEmailSearchTaskProxiesByTaskId(taskId)
        const proxyEntities: ProxyEntity[] = []
        for (const proxy of proxies) {
            proxyEntities.push(proxy.proxy)
        }
        return proxyEntities
    }

    // Update task
    public async updateTask(taskId: number, data: EmailsControldata): Promise<void> {
        // Update main task data
        const task = await this.emailsearchTaskdb.getTaskById(taskId)
        if (task) {
            task.search_result_id = data.searchResultId || 0
            task.concurrency = data.concurrency || 0
            task.page_length = data.pagelength || 0
            task.notShowBrowser = data.notShowBrowser
            task.type_id = data.type
            task.processTimeout = data.processTimeout || 30
            task.maxPageNumber = data.maxPageNumber || 0
            await this.emailsearchTaskdb.updateTask(task)
        }

        // Update URLs - delete existing and create new ones
        const existingUrls = await this.emailsearchUrldb.getAllUrlsByTaskId(taskId)
        for (const url of existingUrls) {
            if (url.id) {
                await this.emailsearchUrldb.delete(url.id)
            }
        }
        
        if (data.validUrls && data.validUrls.length > 0) {
            for (const url of data.validUrls) {
                await this.emailsearchUrldb.create({
                    task_id: taskId,
                    url: url
                })
            }
        }

        // Update proxies
        await this.emailsearchTaskProxydb.deleteEmailSearchTaskProxyByTaskId(taskId)
        if (data.proxys && data.proxys.length > 0) {
            for (const proxy of data.proxys) {
                if (proxy.id) {
                    await this.emailsearchTaskProxydb.createEmailSearchTaskProxy(taskId, proxy.id)
                }
            }
        }
    }

    // Delete task
    public async deleteTask(taskId: number): Promise<void> {
        // Delete task results first
        const results = await this.emailsearchresultdb.getTaskResult(taskId, 0, 1000)
        for (const result of results) {
            if (result.id) {
                // Delete result details
                const details = await this.emailsearchResultDetaildb.getItemsByResultId(result.id)
                for (const detail of details) {
                    if (detail.id) {
                        await this.emailsearchResultDetaildb.delete(detail.id)
                    }
                }
            }
        }
        
        // Delete task results
        for (const result of results) {
            if (result.id) {
                await this.emailsearchresultdb.delete(result.id)
            }
        }

        // Delete task URLs
        const urls = await this.emailsearchUrldb.getAllUrlsByTaskId(taskId)
        for (const url of urls) {
            if (url.id) {
                await this.emailsearchUrldb.delete(url.id)
            }
        }

        // Delete task proxies
        await this.emailsearchTaskProxydb.deleteEmailSearchTaskProxyByTaskId(taskId)

        // Delete main task
        await this.emailsearchTaskdb.deleteTask(taskId)
    }

    /**
     * Formats a Date object to "MM/DD/YYYY, HH:MM:SS AM/PM" format
     * @param date - The date to format
     * @returns Formatted date string
     */
    private formatDateTime(date: Date): string {
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const day = date.getDate().toString().padStart(2, '0')
        const year = date.getFullYear()
        
        let hours = date.getHours()
        const minutes = date.getMinutes().toString().padStart(2, '0')
        const seconds = date.getSeconds().toString().padStart(2, '0')
        const ampm = hours >= 12 ? 'PM' : 'AM'
        hours = hours % 12
        hours = hours ? hours : 12 // the hour '0' should be '12'
        const hoursStr = hours.toString().padStart(2, '0')
        
        return `${month}/${day}/${year}, ${hoursStr}:${minutes}:${seconds} ${ampm}`
    }

}
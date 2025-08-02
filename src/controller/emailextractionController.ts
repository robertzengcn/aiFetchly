import { EmailsControldata,EmailResult,EmailsearchTaskEntityDisplay,EmailResultDisplay} from '@/entityTypes/emailextraction-type'
import {EmailSearchTaskModule} from "@/modules/EmailSearchTaskModule"
// import { utilityProcess, MessageChannelMain} from "electron";
// import { Token } from "@/modules/token"
// import * as path from 'path';
import * as fs from 'fs';
// import {USERLOGPATH,USEREMAIL} from '@/config/usersetting';
import {readLogFile} from "@/modules/lib/function"
// import { v4 as uuidv4 } from 'uuid';
// import {EmailsearchTaskStatus} from '@/model/emailsearchTaskdb'
// import {ProcessMessage} from "@/entityTypes/processMessage-type"
import { SortBy } from "@/entityTypes/commonType"
// import { SystemSettingGroupModule } from '@/modules/SystemSettingGroupModule';
// import {twocaptchagroup,twocaptchatoken,twocaptcha_enabled} from '@/config/settinggroupInit'


export class EmailextractionController {
       private emailSeachTaskModule:EmailSearchTaskModule
       //private systemSettingGroupModule: SystemSettingGroupModule 
       constructor() {
       this.emailSeachTaskModule=new EmailSearchTaskModule()
       //this.systemSettingGroupModule=new SystemSettingGroupModule()
    }
    //search email 
    public async searchEmail(data: EmailsControldata) {
        const taskId=await this.emailSeachTaskModule.saveSearchtask(data)
        this.emailSeachTaskModule.searchEmail(taskId)
    }

    // public async searchEmail(data: EmailsControldata) {
    //     //save search email task
    //     const taskId=await this.emailSeachTaskModule.saveSearchtask(data)
    //     const childPath = path.join(__dirname, 'taskCode.js')
    //     if (!fs.existsSync(childPath)) {
    //         throw new Error("child js path not exist for the path " + childPath);
    //     }

    //     const { port1, port2 } = new MessageChannelMain()
    //     const tokenService=new Token()

    //     let twoCaptchaTokenvalue = ""
    //             const twoCaptchaToken = await this.systemSettingGroupModule.getGroupItembyName(twocaptchagroup)
    //             if (twoCaptchaToken) {
    //                 //find 2captcha enable key
    //                 const twocaptchenable = twoCaptchaToken.settings.find((item) => item.key === twocaptcha_enabled)
    //                 if (twocaptchenable) {
    //                     const token = twoCaptchaToken.settings.find((item) => item.key === twocaptchatoken)
    //                     if (token) {
    //                         twoCaptchaTokenvalue = token.value
    //                     }
    //                 }
    //             }
        
    //     const child = utilityProcess.fork(childPath, [],{stdio:"pipe",execArgv:["--inspect"],env:{
    //         ...process.env,
    //         NODE_OPTIONS: "",
    //          TWOCAPTCHA_TOKEN: twoCaptchaTokenvalue
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
    //     const errorLogfile=path.join(logpath,'emailsearch',taskId.toString()+'_'+uuid+'.error.log')
    //     const runLogfile=path.join(logpath,'emailsearch',taskId.toString()+'_'+uuid+'.runtime.log')

    //     child.on("spawn", () => {
    //         console.log("child process satart, pid is"+child.pid)
    //         child.postMessage(JSON.stringify({action:"searchEmail",data:data}),[port1])
    //         this.emailSeachTaskModule.updateTaskLog(taskId,runLogfile,errorLogfile)
    //     })
        
    //     child.stdout?.on('data', (data) => {
    //         console.log(`Received data chunk ${data}`)
    //         WriteLog(runLogfile,data)
    //        // child.kill()
    //     })
    //     child.stderr?.on('data', (data) => {
    //         const ingoreStr=["Debugger attached","Waiting for the debugger to disconnect",
    //             "Most NODE_OPTIONs are not supported in packaged apps",
               
    //         ]
    //         if(!ingoreStr.some((value)=>data.includes(value))){
                    
    //         // seModel.saveTaskerrorlog(taskId,data)
    //         console.log(`Received error chunk ${data}`)
    //         WriteLog(errorLogfile,data)
    //         //this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Error)
    //         //child.kill()
    //         }
            
    //     })
    //     child.on("exit", (code) => {
    //         if (code !== 0) {
    //             console.error(`Child process exited with code ${code}`);
    //             this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Error)
    //         } else {
    //             console.log('Child process exited successfully');
    //             this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Complete)
    //         }
    //     })
    //     child.on('message', (message) => {
    //         console.log("get message from child")
    //         console.log('Message from child:', JSON.parse(message));
    //         const childdata=JSON.parse(message) as ProcessMessage<EmailResult>
    //         if(childdata.action=="saveres"){
    //             if(childdata.data){
    //             //save result
    //             this.emailSeachTaskModule.saveSearchResult(taskId,childdata.data)
                
    //             }
    //             //child.kill()
    //         }
    //     });
    // }
    //list email search task
    public async listEmailSearchtasks(page:number,size:number,sortby?:SortBy): Promise<{records:EmailsearchTaskEntityDisplay[],total:number}> {
        const res = await this.emailSeachTaskModule.listSearchtask(page, size, sortby)
       const displayRes:EmailsearchTaskEntityDisplay[]=[]
        // res.records.forEach(async (value)=>{
        for(let i=0;i<res.records.length;i++){
            const value=res.records[i]
            if(value.id){

            const taskStatus=this.emailSeachTaskModule.taskstatusConvert(value.status)
            const taskType=this.emailSeachTaskModule.taskTypeconvert(value.type_id)
            const urls=await this.emailSeachTaskModule.getTaskurls(value.id,0,10)
            const displayValue:EmailsearchTaskEntityDisplay={
                id:value.id,
                record_time:value.record_time,
                statusName:taskStatus,
                typeName:taskType,  
                urls:urls
            }
            displayRes.push(displayValue)
            }
        }

        return {records:displayRes,total:res.total}
    }
    //get email search task result
    public async Emailtaskresult(taskId:number,page:number,size:number):Promise<EmailResultDisplay[]>{ 
        const res=await this.emailSeachTaskModule.getTaskResult(taskId,page,size)
        return res
    }
    public async EmailtaskresultCount(taskId:number):Promise<number>{
        const res=await this.emailSeachTaskModule.getTaskResultCount(taskId)
        return res
    }

    public async readTaskErrorlog(taskId: number): Promise<string> {
        const task = await this.emailSeachTaskModule.getTaskDetail(taskId)
        if (!task) {
            throw new Error("task info not found")
        }
        let content = ""
        if (task.error_log) {
            //check file exist
            if (fs.existsSync(task.error_log)) {
                content = await readLogFile(task.error_log)
            } else {
                throw new Error("task error file log not found")
            }
        } else {
            throw new Error("task error file log not found")
        }
        console.log(content)
        return content
    }

    /**
     * Retrieves a single email extraction task by ID for editing purposes
     * @param taskId - The unique identifier of the task to retrieve
     * @returns Promise that resolves to the complete task data including URLs and proxies
     * @throws Error if the task is not found
     */
    public async getEmailSearchTask(taskId: number): Promise<any> {
        const task = await this.emailSeachTaskModule.getTaskDetail(taskId)
        if (!task) {
            throw new Error("Task not found")
        }

        // Get task URLs
        const urls = await this.emailSeachTaskModule.getTaskurls(taskId, 0, 1000)
        
        // Get task proxies
        const proxies = await this.emailSeachTaskModule.getTaskProxies(taskId)

        // Convert status to string for frontend
        const taskStatus = this.emailSeachTaskModule.taskstatusConvert(task.status)
        const taskType = this.emailSeachTaskModule.taskTypeconvert(task.type_id)

        return {
            id: task.id,
            searchResultId: task.search_result_id,
            type_id: task.type_id,
            typeName: taskType,
            concurrency: task.concurrency,
            pagelength: task.pagelength,
            notShowBrowser: task.notShowBrowser,
            processTimeout: task.processTimeout,
            maxPageNumber: task.maxPageNumber,
            status: task.status,
            statusName: taskStatus,
            record_time: task.record_time,
            urls: urls,
            proxies: proxies
        }
    }

    /**
     * Updates an existing email extraction task with new data
     * @param taskId - The unique identifier of the task to update
     * @param data - The updated task data including URLs, settings, and configuration
     * @returns Promise that resolves when the task is updated successfully
     * @throws Error if the task is not found or cannot be edited (e.g., running/completed tasks)
     */
    public async updateEmailSearchTask(taskId: number, data: EmailsControldata): Promise<void> {
        // Validate task exists and can be edited
        const task = await this.emailSeachTaskModule.getTaskDetail(taskId)
        if (!task) {
            throw new Error("Task not found")
        }

        // Only allow editing pending or error tasks
        if (task.status !== 0 && task.status !== 2) { // 0 = pending, 2 = error
            throw new Error("Cannot edit task with current status")
        }

        // Update the task
        await this.emailSeachTaskModule.updateTask(taskId, data)
    }

    /**
     * Deletes an email extraction task and all its associated data
     * @param taskId - The unique identifier of the task to delete
     * @returns Promise that resolves when the task is deleted successfully
     * @throws Error if the task is not found or cannot be deleted (e.g., running tasks)
     */
    public async deleteEmailSearchTask(taskId: number): Promise<void> {
        // Validate task exists and can be deleted
        const task = await this.emailSeachTaskModule.getTaskDetail(taskId)
        if (!task) {
            throw new Error("Task not found")
        }

        // Only allow deleting pending or error tasks
        if (task.status !== 0 && task.status !== 2) { // 0 = pending, 2 = error
            throw new Error("Cannot delete task with current status")
        }

        // Delete the task
        await this.emailSeachTaskModule.deleteTask(taskId)
    }
  
    
}
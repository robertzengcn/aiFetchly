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
import { 
    MCPRequest, 
    MCPResponse, 
    MCPEmailExtractionRequest, 
    MCPEmailExtractionData, 
    MCPExtractedEmail,
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

    /**
     * Handle MCP requests for email extraction functionality
     * This method acts as an adapter between MCP requests and the existing email extraction business logic
     */
    public async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            const { tool, parameters } = request;

            switch (tool) {
                case 'extract_emails_from_website':
                    return await this.handleExtractEmailsRequest(parameters as MCPEmailExtractionRequest);
                
                case 'create_email_extraction_task':
                    return await this.handleCreateEmailTaskRequest(parameters as MCPTaskCreateRequest);
                
                case 'list_email_extraction_tasks':
                    return await this.handleListEmailTasksRequest(parameters as MCPPaginationParams);
                
                case 'get_email_extraction_task':
                    return await this.handleGetEmailTaskRequest(parameters.taskId as number);
                
                case 'update_email_extraction_task':
                    return await this.handleUpdateEmailTaskRequest(parameters as MCPTaskUpdateRequest);
                
                case 'delete_email_extraction_task':
                    return await this.handleDeleteEmailTaskRequest(parameters.taskId as number);
                
                case 'get_email_extraction_results':
                    return await this.handleGetEmailResultsRequest(parameters as { taskId: number } & MCPPaginationParams);
                
                case 'get_email_task_error_log':
                    return await this.handleGetEmailTaskErrorLogRequest(parameters.taskId as number);
                
                case 'get_email_task_count':
                    return await this.handleGetEmailTaskCountRequest(parameters.taskId as number);
                
                default:
                    return createMCPErrorResponse(
                        createMCPError(MCPErrorCode.INVALID_PARAMETERS, `Unknown email extraction tool: ${tool}`),
                        'Invalid email extraction tool requested'
                    );
            }
        } catch (error) {
            console.error('Error in EmailextractionController.handleMCPRequest:', error);
            return createMCPErrorResponse(
                createMCPError(
                    MCPErrorCode.INTERNAL_ERROR,
                    'Internal error occurred while processing email extraction request',
                    error instanceof Error ? error.message : String(error),
                    error instanceof Error ? error.stack : undefined
                ),
                'Failed to process email extraction request'
            );
        }
    }

    /**
     * Handle extract emails from website requests
     */
    private async handleExtractEmailsRequest(params: MCPEmailExtractionRequest): Promise<MCPResponse<MCPEmailExtractionData>> {
        try {
            // Convert MCP parameters to internal format
            const emailData: EmailsControldata = {
                validUrls: params.websites,
                concurrency: 1, // Default concurrency
                pagelength: params.maxDepth || 1,
                notShowBrowser: true, // Default to headless
                type: 'website' as any, // Assuming this is a valid type
                processTimeout: params.timeout || 30000, // 30 seconds default
                maxPageNumber: params.maxDepth || 1
            };

            // Create and run the email extraction task
            const taskId = await this.emailSeachTaskModule.saveSearchtask(emailData);
            await this.emailSeachTaskModule.searchEmail(taskId);

            // Get the results
            const results = await this.Emailtaskresult(taskId, 1, 1000); // Get up to 1000 results

            // Convert to MCP format
            const extractedEmails: MCPExtractedEmail[] = results.map(result => ({
                email: result.emails[0] || '', // Take first email if multiple
                website: result.url,
                context: result.pageTitle,
                confidence: 0.8, // Default confidence
                source: 'website_scraping'
            }));

            const emailExtractionData: MCPEmailExtractionData = {
                emails: extractedEmails,
                totalFound: extractedEmails.length,
                processedWebsites: params.websites.length,
                failedWebsites: [], // This would need to be tracked
                processingTime: 0 // This would need to be tracked
            };

            return createMCPSuccessResponse(emailExtractionData, 'Email extraction completed successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle create email extraction task requests
     */
    private async handleCreateEmailTaskRequest(params: MCPTaskCreateRequest): Promise<MCPResponse<MCPTask>> {
        try {
            // Convert MCP task parameters to internal format
            const emailData: EmailsControldata = {
                validUrls: params.parameters.websites as string[] || [],
                concurrency: params.parameters.concurrency as number || 1,
                pagelength: params.parameters.maxDepth as number || 1,
                notShowBrowser: !(params.parameters.showBrowser as boolean) || true,
                type: 'website' as any,
                processTimeout: params.parameters.timeout as number || 30000,
                maxPageNumber: params.parameters.maxDepth as number || 1
            };

            const taskId = await this.emailSeachTaskModule.saveSearchtask(emailData);

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

            return createMCPSuccessResponse(mcpTask, 'Email extraction task created successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle list email extraction tasks requests
     */
    private async handleListEmailTasksRequest(params: MCPPaginationParams): Promise<MCPResponse<MCPTaskListData>> {
        try {
            const page = params.page || 1;
            const size = params.size || 20;
            const sortBy: SortBy | undefined = params.sortBy ? {
                key: params.sortBy,
                order: params.sortOrder || 'desc'
            } : undefined;

            const result = await this.listEmailSearchtasks(page, size, sortBy);

            // Convert to MCP format
            const mcpTasks: MCPTask[] = result.records.map(task => ({
                id: task.id.toString(),
                name: `Email Extraction Task ${task.id}`,
                description: `URLs: ${task.urls.join(', ')}`,
                type: 'email_extraction',
                status: this.mapTaskStatus(task.statusName),
                parameters: {
                    urls: task.urls,
                    type: task.typeName
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

            return createMCPSuccessResponse(taskListData, 'Email extraction tasks retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get email extraction task requests
     */
    private async handleGetEmailTaskRequest(taskId: number): Promise<MCPResponse<MCPTask>> {
        try {
            const task = await this.getEmailSearchTask(taskId);
            
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: `Email Extraction Task ${taskId}`,
                description: `Type: ${task.typeName}`,
                type: 'email_extraction',
                status: this.mapTaskStatus(task.statusName),
                parameters: {
                    urls: task.urls || [],
                    type: task.typeName,
                    concurrency: task.concurrency,
                    pagelength: task.pagelength,
                    showBrowser: !task.notShowBrowser,
                    processTimeout: task.processTimeout,
                    maxPageNumber: task.maxPageNumber
                },
                priority: 'medium',
                createdAt: task.record_time || new Date().toISOString(),
                updatedAt: task.record_time || new Date().toISOString()
            };

            return createMCPSuccessResponse(mcpTask, 'Email extraction task retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle update email extraction task requests
     */
    private async handleUpdateEmailTaskRequest(params: MCPTaskUpdateRequest): Promise<MCPResponse<MCPTask>> {
        try {
            const taskId = parseInt(params.taskId);
            
            // Convert MCP update parameters to internal format
            const emailData: EmailsControldata = {
                validUrls: params.parameters?.websites as string[] || [],
                concurrency: params.parameters?.concurrency as number || 1,
                pagelength: params.parameters?.maxDepth as number || 1,
                notShowBrowser: !(params.parameters?.showBrowser as boolean) || true,
                type: 'website' as any,
                processTimeout: params.parameters?.timeout as number || 30000,
                maxPageNumber: params.parameters?.maxDepth as number || 1
            };

            await this.updateEmailSearchTask(taskId, emailData);

            // Get updated task details
            const task = await this.getEmailSearchTask(taskId);
            
            const mcpTask: MCPTask = {
                id: taskId.toString(),
                name: params.name || `Email Extraction Task ${taskId}`,
                description: params.description || `Type: ${task.typeName}`,
                type: 'email_extraction',
                status: this.mapTaskStatus(task.statusName),
                parameters: {
                    urls: task.urls || [],
                    type: task.typeName,
                    concurrency: task.concurrency,
                    pagelength: task.pagelength,
                    showBrowser: !task.notShowBrowser,
                    processTimeout: task.processTimeout,
                    maxPageNumber: task.maxPageNumber
                },
                priority: 'medium',
                createdAt: task.record_time || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            return createMCPSuccessResponse(mcpTask, 'Email extraction task updated successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle delete email extraction task requests
     */
    private async handleDeleteEmailTaskRequest(taskId: number): Promise<MCPResponse> {
        try {
            await this.deleteEmailSearchTask(taskId);
            return createMCPSuccessResponse(null, 'Email extraction task deleted successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get email extraction results requests
     */
    private async handleGetEmailResultsRequest(params: { taskId: number } & MCPPaginationParams): Promise<MCPResponse<MCPEmailExtractionData>> {
        try {
            const page = params.page || 1;
            const size = params.size || 20;
            
            const results = await this.Emailtaskresult(params.taskId, page, size);

            // Convert to MCP format
            const extractedEmails: MCPExtractedEmail[] = results.map(result => ({
                email: result.emails[0] || '', // Take first email if multiple
                website: result.url,
                context: result.pageTitle,
                confidence: 0.8, // Default confidence
                source: 'website_scraping'
            }));

            const emailExtractionData: MCPEmailExtractionData = {
                emails: extractedEmails,
                totalFound: extractedEmails.length,
                processedWebsites: 1, // This would need to be tracked
                failedWebsites: [],
                processingTime: 0
            };

            return createMCPSuccessResponse(emailExtractionData, 'Email extraction results retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get email task error log requests
     */
    private async handleGetEmailTaskErrorLogRequest(taskId: number): Promise<MCPResponse<{ log: string }>> {
        try {
            const log = await this.readTaskErrorlog(taskId);
            return createMCPSuccessResponse({ log }, 'Error log retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get email task count requests
     */
    private async handleGetEmailTaskCountRequest(taskId: number): Promise<MCPResponse<{ count: number }>> {
        try {
            const count = await this.EmailtaskresultCount(taskId);
            return createMCPSuccessResponse({ count }, 'Email count retrieved successfully');
        } catch (error) {
            throw error;
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
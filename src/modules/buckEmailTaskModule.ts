import { Token } from "@/modules/token"
import { USERSDBPATH } from '@/config/usersetting';
import { BuckemailEntity, BuckEmailType } from "@/model/buckEmailTaskdb"
import { BuckEmailTaskModel } from "@/model/BuckEmailTask.model"
import { TaskStatus } from "@/entityTypes/commonType"
import { SortBy } from "@/entityTypes/commonType"
import { BaseModule } from "@/modules/baseModule";
import { BuckemailTaskEntity } from "@/entity/BuckemailTask.entity";
import { Buckemailstruct, EmailItem } from "@/entityTypes/emailmarketingType";
import { EmailTemplateRespdata, EmailFilterdata, EmailServiceEntitydata, Buckemailremotedata } from "@/entityTypes/emailmarketingType";
import { EmailMarketingTemplateApi } from "@/api/emailMarketingTemplateApi";
import { USERLOGPATH, USEREMAIL } from '@/config/usersetting';
import { EmailMarketingFilterApi } from "@/api/emailMarketingFilterApi";
import { EmailServiceApi } from "@/api/emailServiceApi";
import { WriteLog, getApplogspath, getRandomValues, getRecorddatetime } from "@/modules/lib/function"
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { utilityProcess, MessageChannelMain } from "electron";
import { ProcessMessage } from "@/entityTypes/processMessage-type"
import { EmailSendResult } from "@/entityTypes/emailmarketingType"
import { SendStatus } from "@/model/emailMarketingSendLog.model"
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity"
import { EmailMarketingSendLogModule } from "@/modules/emailMarketingSendLogModule";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import {EmailTemplateTaskRelationModule} from "@/modules/EmailTemplateTaskRelationModule"
import { EmailTemplateTaskRelationEntity } from "@/entity/EmailTemplateTaskRelation.entity";
import { EmailFilterTaskRelationEntity } from "@/entity/EmailFilterTaskRelation.entity";
import{EmailFilterTaskRelationModule} from "@/modules/EmailFilterTaskRelationModule"
import {EmailServiceTaskRelationEntity} from "@/entity/EmailServiceTaskRelation.entity"
import { EmailServiceTaskRelationModule } from "./emailServiceTaskRelationModule";



export class BuckEmailTaskModule extends BaseModule {
    //private dbpath: string
    private buckEmailTaskModel: BuckEmailTaskModel
    private emailtemAPI: EmailMarketingTemplateApi
    private emailfilterAPI: EmailMarketingFilterApi
    private emailserviceAPI: EmailServiceApi
    private emailMarketingSendlogModule: EmailMarketingSendLogModule
    private emailTemplateTaskRelationModule: EmailTemplateTaskRelationModule
    private emailFilterTaskRelationModule: EmailFilterTaskRelationModule
    private emailServiceTaskRelationModule: EmailServiceTaskRelationModule
    constructor() {
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        super();
        // this.dbpath = dbpath
        this.buckEmailTaskModel = new BuckEmailTaskModel(this.dbpath);
        this.emailtemAPI = new EmailMarketingTemplateApi()
        this.emailfilterAPI = new EmailMarketingFilterApi()
        this.emailserviceAPI = new EmailServiceApi()
        this.emailTemplateTaskRelationModule = new EmailTemplateTaskRelationModule()
    }

    //convert local number array to list
    public async prepareData(taskId:number): Promise<Buckemailremotedata> {
        const emailtemplist: EmailTemplateRespdata[] = []
        const emailfilterlist: EmailFilterdata[] = []
        const emailservicelist: EmailServiceEntitydata[] = []
        let emailList: EmailItem[] = []
        const emailsearModuel = new EmailSearchTaskModule()
        //if (param.EmailtaskentityId) {
            emailList = await emailsearModuel.getAllEmails(taskId)
            if (emailList.length == 0) {
                throw new Error("email list is empty")
            }
        //}
        //get email template list
        const emailTemplateList=await this.emailTemplateTaskRelationModule.getEmailTemplatesByBuckemailTaskId(taskId)
        for(let i=0;i<emailTemplateList.length;i++){
            const element=emailTemplateList[i]
            const res=await this.emailtemAPI.readTemplate(element.emailTemplateId.toString())
            if(res.data){
                emailtemplist.push(res.data)
            }
        }

        //get email filter list
        const emailFilterList=await this.emailFilterTaskRelationModule.getEmailFiltersByBuckemailTaskId(taskId)
        for(let i=0;i<emailFilterList.length;i++){
            const element=emailFilterList[i]
            const res=await this.emailfilterAPI.getEmailFilterById(element.emailFilterId.toString())
            if(res.data){
                emailfilterlist.push(res.data)
            }
        }
        //get email service list
        const emailServiceList=await this.emailServiceTaskRelationModule.getEmailServicesByTaskId(taskId)
        for(let i=0;i<emailServiceList.length;i++){
            const element=emailServiceList[i]
            const res=await this.emailserviceAPI.getEmailServiceById(element.id.toString())
            if(res.data){
                emailservicelist.push(res.data)
            }
        }
        //get buck email task entity
        const buckemailTaskEntity=await this.read(taskId)
        if(!buckemailTaskEntity){
            throw new Error("buck email task entity not found")
        }
        const notDuplicate=buckemailTaskEntity.notduplicate==1?true:false
        //check if need to remove duplicate email receiver
        if (notDuplicate) {
            //remove duplicate email

            const newEmailList = emailList.filter((value, index, self) => self.indexOf(value) === index)
            emailList = newEmailList
        }

        const data: Buckemailremotedata = {
            Receiverlist: emailList,
            Emailtemplist: emailtemplist,
            Emailfilterlist: emailfilterlist,
            Emailservicelist: emailservicelist
        }
        return data
    }
    //start buck email task
    public async startBuckEmailTask(param: Buckemailstruct): Promise<number> {
        const taskId = await this.createBuckEmailTask(param)
        return await this.buckEmailsend(taskId)
    }
    //create buck email task
    public async createBuckEmailTask(param: Buckemailstruct): Promise<number> {
        const buckentity = new BuckemailTaskEntity()
        buckentity.type = param.EmailBtype
        buckentity.status = TaskStatus.Notstart
        buckentity.emailtaskentityId = param.EmailtaskentityId || 0
        buckentity.notduplicate = param.NotDuplicate ? 1 : 0
        buckentity.record_time = getRecorddatetime()
        buckentity.log_file = ''

        const taskId = await this.create(buckentity)

        //save email template list to local db
        for (let i = 0; i < param.EmailTemplateslist.length; i++) {
            const relation = new EmailTemplateTaskRelationEntity()
            relation.emailTemplateId = param.EmailTemplateslist[i]
            relation.buckemailTaskId = taskId
            relation.status = 1
            await this.emailTemplateTaskRelationModule.create(relation)
        }

        //save email filter list to local db
        for (let i = 0; i < param.EmailFilterlist.length; i++) {
            const relation = new EmailFilterTaskRelationEntity()
            relation.emailFilterId = param.EmailFilterlist[i]
            relation.buckemailTaskId = taskId
            relation.status = 1
            await this.emailFilterTaskRelationModule.create(relation)
        }
        //save email service list to local db
        for (let i = 0; i < param.EmailServicelist.length; i++) {
            const relation = new EmailServiceTaskRelationEntity()
            relation.emailServiceId = param.EmailServicelist[i]
            relation.buckemailTaskId = taskId
            relation.status = 1
            await this.emailServiceTaskRelationModule.createEmailServiceTaskRelation(relation)
        }

        return taskId
        // switch (param.EmailBtype) {
        //     case 1: {
        //         if (!param.EmailtaskentityId || param.EmailtaskentityId == 0) {
        //             throw new Error("email task entity id is empty")

        //         }
        //         const emailsearModuel = new EmailSearchTaskModule()
        //         const emailList = await emailsearModuel.getAllEmails(param.EmailtaskentityId)
        //         if (emailList.length == 0) {
        //             throw new Error("email list is empty")
        //         }

        //     }
        // }

    }

    //send email
    public async buckEmailsend(taskId: number): Promise<number> {

        //console.log(param)
        const data = await this.prepareData(taskId)
        console.log(data)
        const tokenService = new Token()
        // console.log(path.join(__dirname, 'utilityCode.js'))
        let logpath = tokenService.getValue(USERLOGPATH)
        if (!logpath) {
            const useremail = tokenService.getValue(USEREMAIL)
            //create log path
            logpath = getApplogspath(useremail)
        }
        // console.log(logpath)
        const uuid = uuidv4({ random: getRandomValues(new Uint8Array(16)) })
        const errorLogfile = path.join(logpath, 'emailsend_' + '_' + uuid + '.error.log')
        const runLogfile = path.join(logpath, 'emailsend_' + uuid + '.runtime.log')
        //create buck email task
        // const entity: BuckemailEntity = {
        //     type: param.EmailBtype,
        //     status: TaskStatus.Processing,
        //     log_file: errorLogfile,
        //     error_file: runLogfile
        // }
        // //create task
        // const taskId = await this.create(entity)

        const childPath = path.join(__dirname, 'taskCode.js')
        if (!fs.existsSync(childPath)) {
            throw new Error("child js path not exist for the path " + childPath);
        }
        const { port1, port2 } = new MessageChannelMain()


        const child = utilityProcess.fork(childPath, [], {
            stdio: "pipe",
            execArgv: ["puppeteer-cluster:*"],
            env: {
                ...process.env,
                NODE_OPTIONS: ""
            }
        })



        child.on("spawn", () => {
            console.log("child process satart, pid is" + child.pid)
            child.postMessage(JSON.stringify({ action: "sendEmail", data: data }), [port1])

        })

        child.stdout?.on('data', (data) => {
            console.log(`Received data chunk ${data}`)
            WriteLog(runLogfile, data)
            // child.kill()
        })
        child.stderr?.on('data', (data) => {
            const ingoreStr = ["Debugger attached", "Waiting for the debugger to disconnect", "Most NODE_OPTIONs are not supported in packaged apps"]
            if (!ingoreStr.some((value) => data.includes(value))) {

                // seModel.saveTaskerrorlog(taskId,data)
                console.log(`Received error chunk ${data}`)
                WriteLog(errorLogfile, data)
                // this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Error)
                //child.kill()
            }

        })
        child.on("exit", (code) => {
            if (code !== 0) {
                console.error(`Child process exited with code ${code}`);
                this.updateTaskStatus(taskId, TaskStatus.Error)
            } else {
                console.log('Child process exited successfully');
                this.updateTaskStatus(taskId, TaskStatus.Complete)
            }

        })
        child.on('message', (message) => {
            console.log("get message from child")
            console.log('Message from child:', JSON.parse(message));
            // const childdata=JSON.parse(message) as ProcessMessage<EmailResult>
            const childdata = JSON.parse(message) as ProcessMessage<EmailSendResult>
            switch (childdata.action) {
                case 'EmailSendSuccess': {
                    // const emailMarketLog: EmailMarketingSendLogEntity = {
                    //     task_id: taskId,
                    //     status: SendStatus.Success,
                    //     receiver: message.data.receiver,
                    //     title: message.data.title,
                    //     content: message.data.content,
                    // }
                    const emailMarketLog = new EmailMarketingSendLogEntity()
                    emailMarketLog.task_id = taskId
                    emailMarketLog.status = SendStatus.Success
                    emailMarketLog.receiver = message.data.receiver
                    emailMarketLog.title = message.data.title
                    emailMarketLog.content = message.data.content
                    emailMarketLog.log = message.data.info ? message.data.info : ""
                    //update send log
                    this.emailMarketingSendlogModule.createItem(emailMarketLog)
                }
                    break;
                case 'EmailSendFailure': {
                    // const emailMarketLog: EmailMarketingSendLogEntity = {
                    //     task_id: taskId,
                    //     status: SendStatus.Failure,
                    //     receiver: message.data.receiver,
                    //     title: message.data.title,
                    //     content: message.data.content,
                    //     log: message.data.info
                    // }
                    const emailMarketLog = new EmailMarketingSendLogEntity()
                    emailMarketLog.task_id = taskId
                    emailMarketLog.status = SendStatus.Failure
                    emailMarketLog.receiver = message.data.receiver
                    emailMarketLog.title = message.data.title
                    emailMarketLog.content = message.data.content
                    emailMarketLog.log = message.data.info ? message.data.info : ""
                    //update send log
                    this.emailMarketingSendlogModule.createItem(emailMarketLog)
                }
                    break;
                case 'sendEmailEnd': {
                    this.updateTaskStatus(taskId, TaskStatus.Complete)
                }
                    break;
            }
        });
        return taskId
    }
    /**
     * Create a new buck email task
     * @param task The buck email task entity
     * @returns The ID of the created task
     */
    async create(task: BuckemailTaskEntity): Promise<number> {
        return await this.buckEmailTaskModel.create(task);
    }
    /**
     * Get a buck email task by ID
     * @param id The task ID
     * @returns The buck email task entity
     */
    async read(id: number): Promise<BuckemailTaskEntity | undefined> {
        return await this.buckEmailTaskModel.read(id);
    }
    /**
     * Update a buck email task
     * @param id The task ID
     * @param task The buck email task entity to update
     */
    async update(id: number, task: BuckemailEntity): Promise<void> {
        return await this.buckEmailTaskModel.update(id, task);
    }
    /**
     * Delete a buck email task
     * @param id The task ID
     */
    async delete(id: number): Promise<void> {
        return await this.buckEmailTaskModel.delete(id);
    }
    /**
     * Update task log files
     * @param id The task ID
     * @param runtimeLog The runtime log content
     * @param errorLog The error log content
     */
    async updateTaskLogfile(id: number, runtimeLog: string, errorLog: string): Promise<void> {
        return await this.buckEmailTaskModel.updateTaskLogfile(id, runtimeLog, errorLog);
    }
    /**
     * Update task status
     * @param id The task ID
     * @param status The new status
     */
    async updateTaskStatus(id: number, status: TaskStatus): Promise<void> {
        return await this.buckEmailTaskModel.updateTaskStatus(id, status);
    }
    /**
     * List buck email tasks with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns Array of buck email task entities
     */
    async listBuckEmailTasks(page: number, size: number, sort?: SortBy): Promise<BuckemailEntity[]> {
        return await this.buckEmailTaskModel.listBuckEmailtask(page, size, sort);
    }
    /**
     * Get total number of buck email tasks
     * @returns Total count of tasks
     */
    async countBuckEmailTasks(): Promise<number> {
        return await this.buckEmailTaskModel.countBuckEmailTask();
    }
    /**
     * Get buck email status name from status enum
     * @param taskStatus The task status enum value
     * @returns String representation of the status
     */
    getBuckEmailStatusName(taskStatus: TaskStatus): string {
        return this.buckEmailTaskModel.getBuckEmailStatusName(taskStatus);
    }
    /**
     * Get buck email type name from type enum
     * @param type The buck email type enum value
     * @returns String representation of the type
     */
    getBuckEmailTypeName(type: BuckEmailType): string {
        return this.buckEmailTaskModel.getBuckEmailTypeName(type);
    }
}
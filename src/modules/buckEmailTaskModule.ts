import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import { BuckemailTaskEntity } from "@/entity/BuckemailTask.entity";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import { BuckEmailTaskModel } from "@/model/BuckEmailTask.model";
import { TaskStatus } from "@/entityTypes/commonType";
import { SortBy } from "@/entityTypes/commonType";
import { BaseModule } from "@/modules/baseModule";
import { EmailItem } from "@/entityTypes/emailmarketingType";
import {
  Buckemailstruct,
  EmailTemplateRespdata,
  EmailFilterdata,
  EmailServiceEntitydata,
  Buckemailremotedata,
} from "@/entityTypes/emailmarketingType";
import { EmailMarketingTemplateApi } from "@/api/emailMarketingTemplateApi";
import { USERLOGPATH, USEREMAIL } from "@/config/usersetting";
import { EmailMarketingFilterApi } from "@/api/emailMarketingFilterApi";
import { EmailServiceApi } from "@/api/emailServiceApi";
import {
  WriteLog,
  getApplogspath,
  getRandomValues,
  getRecorddatetime,
} from "@/modules/lib/function";
import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import * as fs from "fs";
import { utilityProcess, MessageChannelMain, app } from "electron";
import { ProcessMessage } from "@/entityTypes/processMessage-type";
import { EmailSendResult } from "@/entityTypes/emailmarketingType";
import { SendStatus } from "@/model/emailMarketingSendLog.model";
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import { EmailMarketingSendLogModule } from "@/modules/emailMarketingSendLogModule";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { EmailTemplateTaskRelationModule } from "@/modules/EmailTemplateTaskRelationModule";
import { EmailTemplateTaskRelationEntity } from "@/entity/EmailTemplateTaskRelation.entity";
import { EmailFilterTaskRelationEntity } from "@/entity/EmailFilterTaskRelation.entity";
import { EmailFilterTaskRelationModule } from "@/modules/EmailFilterTaskRelationModule";
import { EmailServiceTaskRelationEntity } from "@/entity/EmailServiceTaskRelation.entity";
import { EmailServiceTaskRelationModule } from "./emailServiceTaskRelationModule";
import { dedupeEmailList } from "@/service/EmailMarketingAiTools";

export class BuckEmailTaskModule extends BaseModule {
  //private dbpath: string
  private buckEmailTaskModel: BuckEmailTaskModel;
  private emailtemAPI: EmailMarketingTemplateApi;
  private emailfilterAPI: EmailMarketingFilterApi;
  private emailserviceAPI: EmailServiceApi;
  private emailMarketingSendlogModule: EmailMarketingSendLogModule;
  private emailTemplateTaskRelationModule: EmailTemplateTaskRelationModule;
  private emailFilterTaskRelationModule: EmailFilterTaskRelationModule;
  private emailServiceTaskRelationModule: EmailServiceTaskRelationModule;
  constructor() {
    // const tokenService = new Token()
    // const dbpath = tokenService.getValue(USERSDBPATH)
    // if (!dbpath) {
    //     throw new Error("user path not exist")
    // }
    super();
    // this.dbpath = dbpath
    this.buckEmailTaskModel = new BuckEmailTaskModel(this.dbpath);
    this.emailtemAPI = new EmailMarketingTemplateApi();
    this.emailfilterAPI = new EmailMarketingFilterApi();
    this.emailserviceAPI = new EmailServiceApi();
    this.emailMarketingSendlogModule = new EmailMarketingSendLogModule();
    this.emailTemplateTaskRelationModule =
      new EmailTemplateTaskRelationModule();
    this.emailFilterTaskRelationModule = new EmailFilterTaskRelationModule();
    this.emailServiceTaskRelationModule = new EmailServiceTaskRelationModule();
  }

  private isEmailItem(value: unknown): value is EmailItem {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const item = value as Partial<EmailItem>;
    return (
      typeof item.address === "string" &&
      item.address.trim().length > 0 &&
      typeof item.source === "string" &&
      item.source.trim().length > 0 &&
      (item.title === undefined || typeof item.title === "string")
    );
  }

  private serializeEmailList(emailList?: EmailItem[]): string | null {
    if (!emailList || emailList.length === 0) {
      return null;
    }

    const normalizedEmails = emailList
      .map((item) => ({
        title: item.title,
        address: item.address.trim(),
        source: item.source.trim(),
      }))
      .filter((item) => item.address.length > 0 && item.source.length > 0);

    return normalizedEmails.length > 0
      ? JSON.stringify(normalizedEmails)
      : null;
  }

  private parseEmailListJson(emailListJson: string | null): EmailItem[] {
    if (!emailListJson) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(emailListJson);
    } catch {
      console.warn(
        "parseEmailListJson: failed to parse email_list_json, returning empty list"
      );
      return [];
    }

    if (!Array.isArray(parsed)) {
      console.warn(
        "parseEmailListJson: email_list_json is not an array, returning empty list"
      );
      return [];
    }

    const validItems: EmailItem[] = [];
    let droppedCount = 0;
    for (const item of parsed) {
      if (this.isEmailItem(item)) {
        validItems.push(item);
      } else {
        droppedCount++;
      }
    }
    if (droppedCount > 0) {
      console.warn(
        `parseEmailListJson: dropped ${droppedCount} invalid email item(s) from stored JSON`
      );
    }

    return validItems;
  }

  private formatEmailSendFailureLog(result: EmailSendResult): string {
    const lines = [
      "Email send failure",
      `Receiver: ${result.receiver}`,
      `Title: ${result.title}`,
      `Error: ${result.info ?? ""}`,
    ];

    return lines.join("\n");
  }

  //convert local number array to list
  public async prepareData(taskId: number): Promise<Buckemailremotedata> {
    const emailtemplist: EmailTemplateRespdata[] = [];
    const emailfilterlist: EmailFilterdata[] = [];
    const emailservicelist: EmailServiceEntitydata[] = [];
    let emailList: EmailItem[] = [];
    const buckemailTaskEntity = await this.read(taskId);
    if (!buckemailTaskEntity) {
      throw new Error("buck email task entity not found");
    }

    if (
      buckemailTaskEntity.emailtaskentityId &&
      buckemailTaskEntity.emailtaskentityId > 0
    ) {
      const emailSearchModule = new EmailSearchTaskModule();
      emailList = await emailSearchModule.getAllEmails(
        buckemailTaskEntity.emailtaskentityId
      );
    } else {
      emailList = this.parseEmailListJson(buckemailTaskEntity.email_list_json);
    }

    if (emailList.length === 0) {
      throw new Error("email list is empty");
    }

    //get email template list (optional when using inline email_content)
    const emailTemplateList =
      await this.emailTemplateTaskRelationModule.getEmailTemplatesByBuckemailTaskId(
        taskId
      );
    for (let i = 0; i < emailTemplateList.length; i++) {
      const element = emailTemplateList[i];
      const res = await this.emailtemAPI.readTemplate(
        element.emailTemplateId.toString()
      );
      if (res.data) {
        emailtemplist.push(res.data);
      }
    }

    //get email filter list
    const emailFilterList =
      await this.emailFilterTaskRelationModule.getEmailFiltersByBuckemailTaskId(
        taskId
      );
    for (let i = 0; i < emailFilterList.length; i++) {
      const element = emailFilterList[i];
      const res = await this.emailfilterAPI.getEmailFilterById(
        element.emailFilterId.toString()
      );
      if (res.data) {
        emailfilterlist.push(res.data);
      }
    }
    //get email service list
    const emailServiceList =
      await this.emailServiceTaskRelationModule.getEmailServicesByTaskId(
        taskId
      );
    for (let i = 0; i < emailServiceList.length; i++) {
      const element = emailServiceList[i];
      const res = await this.emailserviceAPI.getEmailServiceById(
        element.id.toString()
      );
      if (res.data) {
        emailservicelist.push(res.data);
      }
    }

    const notDuplicate = buckemailTaskEntity.notduplicate === 1;
    //check if need to remove duplicate email receiver
    if (notDuplicate) {
      emailList = dedupeEmailList(emailList, true);
    }

    const data: Buckemailremotedata = {
      Receiverlist: emailList,
      Emailtemplist: emailtemplist,
      Emailfilterlist: emailfilterlist,
      Emailservicelist: emailservicelist,
    };

    if (buckemailTaskEntity?.email_subject?.trim()) {
      data.email_subject = buckemailTaskEntity.email_subject.trim();
    }
    if (buckemailTaskEntity?.email_html_content?.trim()) {
      data.email_html_content = buckemailTaskEntity.email_html_content.trim();
    }

    return data;
  }

  private async loadTemplateEmail(
    remotedata: Buckemailremotedata,
    taskId: number
  ): Promise<EmailTemplateRespdata> {
    if (remotedata.Emailtemplist.length > 0) {
      const templateId =
        remotedata.Emailtemplist[
          Math.floor(Math.random() * remotedata.Emailtemplist.length)
        ].TplId;
      const res = await this.emailtemAPI.readTemplate(String(templateId));
      if (!res.data) {
        throw new Error(`Email template ${templateId} not found`);
      }
      return res.data;
    }

    const subject = remotedata.email_subject?.trim() ?? "";
    const content = remotedata.email_html_content?.trim() ?? "";

    if (!subject || !content) {
      const buckemailTaskEntity = await this.read(taskId);
      const fallbackSubject = buckemailTaskEntity?.email_subject?.trim() ?? "";
      const fallbackContent =
        buckemailTaskEntity?.email_html_content?.trim() ?? "";
      if (!fallbackSubject || !fallbackContent) {
        throw new Error(
          "Bulk email send requires templates or email_content with subject and content"
        );
      }
      return {
        TplId: 0,
        TplTitle: fallbackSubject,
        TplContent: fallbackContent,
        TplDescription: "",
      };
    }

    return {
      TplId: 0,
      TplTitle: subject,
      TplContent: content,
      TplDescription: "",
    };
  }
  //start buck email task
  public async startBuckEmailTask(
    param: BuckemailTaskEntity,
    options?: { waitForExit?: boolean }
  ): Promise<number> {
    const taskId = await this.createBuckEmailTaskFromEntity(param);
    return await this.buckEmailsend(taskId, options);
  }

  //create buck email task from entity (direct DB entity)
  private async createBuckEmailTaskFromEntity(
    param: BuckemailTaskEntity
  ): Promise<number> {
    const buckentity = new BuckemailTaskEntity();
    buckentity.type = param.type;
    buckentity.status = TaskStatus.Notstart;
    buckentity.emailtaskentityId = param.emailtaskentityId ?? 0;
    buckentity.email_list_json = param.email_list_json ?? null;
    if (
      param.email_subject !== null &&
      param.email_subject !== undefined &&
      param.email_subject.trim().length > 0
    ) {
      buckentity.email_subject = param.email_subject.trim();
    }
    if (
      param.email_html_content !== null &&
      param.email_html_content !== undefined &&
      param.email_html_content.trim().length > 0
    ) {
      buckentity.email_html_content = param.email_html_content.trim();
    }
    buckentity.notduplicate = param.notduplicate ? 1 : 0;
    buckentity.record_time = getRecorddatetime();
    buckentity.log_file = "";

    const taskId = await this.create(buckentity);

    return taskId;
  }

  //create buck email task from struct (IPC/AI tool input)
  public async createBuckEmailTask(param: Buckemailstruct): Promise<number> {
    const buckentity = new BuckemailTaskEntity();
    buckentity.type = param.EmailBtype;
    buckentity.status = TaskStatus.Notstart;
    buckentity.emailtaskentityId = param.EmailtaskentityId ?? 0;
    buckentity.email_list_json = this.serializeEmailList(param.EmailList);
    if (
      param.email_subject !== undefined &&
      param.email_subject.trim().length > 0
    ) {
      buckentity.email_subject = param.email_subject.trim();
    }
    if (
      param.email_html_content !== undefined &&
      param.email_html_content.trim().length > 0
    ) {
      buckentity.email_html_content = param.email_html_content.trim();
    }
    buckentity.notduplicate = param.NotDuplicate ? 1 : 0;
    buckentity.record_time = getRecorddatetime();
    buckentity.log_file = "";

    const taskId = await this.create(buckentity);

    if (param.EmailTemplateslist) {
      for (const templateId of param.EmailTemplateslist) {
        const relation = new EmailTemplateTaskRelationEntity();
        relation.emailTemplateId = templateId;
        relation.buckemailTaskId = taskId;
        relation.status = 1;
        await this.emailTemplateTaskRelationModule.create(relation);
      }
    }

    if (param.EmailFilterlist) {
      for (let i = 0; i < param.EmailFilterlist.length; i++) {
        const relation = new EmailFilterTaskRelationEntity();
        relation.emailFilterId = param.EmailFilterlist[i];
        relation.buckemailTaskId = taskId;
        relation.status = 1;
        await this.emailFilterTaskRelationModule.create(relation);
      }
    }

    if (param.EmailServicelist) {
      for (let i = 0; i < param.EmailServicelist.length; i++) {
        const relation = new EmailServiceTaskRelationEntity();
        relation.emailServiceId = param.EmailServicelist[i];
        relation.buckemailTaskId = taskId;
        relation.status = 1;
        await this.emailServiceTaskRelationModule.createEmailServiceTaskRelation(
          relation
        );
      }
    }

    return taskId;
  }

  //send email
  public async buckEmailsend(
    taskId: number,
    options?: { waitForExit?: boolean }
  ): Promise<number> {
    //console.log(param)
    const data = await this.prepareData(taskId);
    const tokenService = new Token();
    // console.log(path.join(__dirname, 'utilityCode.js'))
    let logpath = tokenService.getValue(USERLOGPATH);
    if (!logpath) {
      const useremail = tokenService.getValue(USEREMAIL);
      //create log path
      logpath = getApplogspath(useremail);
    }
    // console.log(logpath)
    const uuid = uuidv4({ random: getRandomValues(new Uint8Array(16)) });
    const errorLogfile = path.join(
      logpath,
      "emailsend_" + "_" + uuid + ".error.log"
    );
    const runLogfile = path.join(logpath, "emailsend_" + uuid + ".runtime.log");

    const childPath = path.join(__dirname, "taskCode.js");
    if (!fs.existsSync(childPath)) {
      throw new Error("child js path not exist for the path " + childPath);
    }
    const { port1, port2 } = new MessageChannelMain();

    const child = utilityProcess.fork(childPath, [], {
      stdio: "pipe",
      execArgv: ["puppeteer-cluster:*"],
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        ELECTRON_APP_NAME: app.getName(),
        ELECTRON_USER_DATA_PATH: app.getPath("userData"),
      },
    });

    child.on("spawn", () => {
      console.log("child process satart, pid is" + child.pid);
      child.postMessage(JSON.stringify({ action: "sendEmail", data: data }), [
        port1,
      ]);
    });

    child.stdout?.on("data", (data) => {
      WriteLog(runLogfile, data);
      // child.kill()
    });
    child.stderr?.on("data", (data) => {
      const ingoreStr = [
        "Debugger attached",
        "Waiting for the debugger to disconnect",
        "Most NODE_OPTIONs are not supported in packaged apps",
      ];
      if (!ingoreStr.some((value) => data.includes(value))) {
        // seModel.saveTaskerrorlog(taskId,data)
        WriteLog(errorLogfile, data);
        // this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Error)
        //child.kill()
      }
    });
    const waitForExit = options?.waitForExit === true;
    let settled = false;
    let resolveWait: ((taskId: number) => void) | undefined;
    let rejectWait: ((error: Error) => void) | undefined;

    const settleSuccess = () => {
      if (!waitForExit || settled) {
        return;
      }
      settled = true;
      resolveWait?.(taskId);
    };

    const settleFailure = (error: Error) => {
      if (!waitForExit || settled) {
        return;
      }
      settled = true;
      rejectWait?.(error);
    };

    const waitPromise = waitForExit
      ? new Promise<number>((resolve, reject) => {
          resolveWait = resolve;
          rejectWait = reject;
        })
      : undefined;

    child.on("error", (error) => {
      console.error("Child process failed:", error);
      WriteLog(errorLogfile, `Child process failed: ${error.message}`);
      this.updateTaskErrorFile(taskId, errorLogfile);
      this.updateTaskStatus(taskId, TaskStatus.Error);
      settleFailure(error);
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        const message = `Child process exited with code ${code}`;
        console.error(message);
        WriteLog(errorLogfile, message);
        this.updateTaskErrorFile(taskId, errorLogfile);
        this.updateTaskStatus(taskId, TaskStatus.Error);
        settleFailure(new Error(`${message}; task_id=${taskId}`));
      } else {
        console.log("Child process exited successfully");
        this.updateTaskStatus(taskId, TaskStatus.Complete);
        settleSuccess();
      }
    });
    child.on("message", async (message: unknown) => {
      try {
        const msg = message as { data?: string };
        if (!msg || !msg.data || typeof msg.data !== "string") {
          console.error("Invalid message from child process:", message);
          return;
        }
        console.log("get message from child");
        // const childdata=JSON.parse(message.data) as ProcessMessage<EmailResult>
        const childdata = JSON.parse(
          msg.data
        ) as ProcessMessage<EmailSendResult>;
        console.log("Message from child:", childdata);
        switch (childdata.action) {
          case "EmailSendSuccess":
            {
              // const emailMarketLog: EmailMarketingSendLogEntity = {
              //     task_id: taskId,
              //     status: SendStatus.Success,
              //     receiver: message.data.receiver,
              //     title: message.data.title,
              //     content: message.data.content,
              // }
              if (!childdata.data) {
                console.error("EmailSendSuccess: childdata.data is undefined");
                break;
              }
              const emailMarketLog = new EmailMarketingSendLogEntity();
              emailMarketLog.task_id = taskId;
              emailMarketLog.status = SendStatus.Success;
              emailMarketLog.receiver = childdata.data.receiver;
              emailMarketLog.title = childdata.data.title;
              emailMarketLog.content = childdata.data.content;
              emailMarketLog.log = childdata.data.info
                ? childdata.data.info
                : "";
              //update send log
              this.emailMarketingSendlogModule.createItem(emailMarketLog);
            }
            break;
          case "EmailSendFailure":
            {
              // const emailMarketLog: EmailMarketingSendLogEntity = {
              //     task_id: taskId,
              //     status: SendStatus.Failure,
              //     receiver: message.data.receiver,
              //     title: message.data.title,
              //     content: message.data.content,
              //     log: message.data.info
              // }
              if (!childdata.data) {
                console.error("EmailSendFailure: childdata.data is undefined");
                break;
              }
              const emailMarketLog = new EmailMarketingSendLogEntity();
              emailMarketLog.task_id = taskId;
              emailMarketLog.status = SendStatus.Failure;
              emailMarketLog.receiver = childdata.data.receiver;
              emailMarketLog.title = childdata.data.title;
              emailMarketLog.content = childdata.data.content;
              emailMarketLog.log = childdata.data.info
                ? childdata.data.info
                : "";
              WriteLog(
                errorLogfile,
                this.formatEmailSendFailureLog(childdata.data)
              );
              await this.updateTaskErrorFile(taskId, errorLogfile);
              //update send log
              this.emailMarketingSendlogModule.createItem(emailMarketLog);
            }
            break;
          case "sendEmailEnd":
            {
              this.updateTaskStatus(taskId, TaskStatus.Complete);
            }
            break;
        }
      } catch (error) {
        console.error("Failed to parse message from child process:", error);
        if (error instanceof Error) {
          console.error("Error details:", error.message);
        }
      }
    });
    if (!waitForExit) {
      return taskId;
    }

    return await waitPromise!;
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
  async update(id: number, task: BuckemailTaskEntity): Promise<void> {
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
  async updateTaskLogfile(
    id: number,
    runtimeLog: string,
    errorLog: string
  ): Promise<void> {
    return await this.buckEmailTaskModel.updateTaskLogfile(
      id,
      runtimeLog,
      errorLog
    );
  }
  /**
   * Update task error file path
   * @param id The task ID
   * @param errorLog The error log file path
   */
  async updateTaskErrorFile(id: number, errorLog: string): Promise<void> {
    return await this.buckEmailTaskModel.updateTaskErrorFile(id, errorLog);
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
  async listBuckEmailTasks(
    page: number,
    size: number,
    sort?: SortBy
  ): Promise<BuckemailTaskEntity[]> {
    const rows = await this.buckEmailTaskModel.listBuckEmailtask(
      page,
      size,
      sort
    );
    return rows as BuckemailTaskEntity[];
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

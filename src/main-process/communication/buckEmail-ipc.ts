import { BuckemailController } from "@/controller/buckemailController"
import { BUCKEMAILSEND } from "@/config/channellist";
import { ipcMain } from 'electron';
import { EmailMarketingsubdata, EmailItem } from '@/entityTypes/emailmarketingType'
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { BUCKEMAILSENDMESSAGE, BUCKEMAILTASKLIST, BUCKEMAILTASKSENDLOG } from "@/config/channellist"
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule"
import { Buckemailstruct } from "@/entityTypes/emailmarketingType"
import { BuckEmailType } from "@/model/buckEmailTaskdb"
import { ItemSearchparam } from "@/entityTypes/commonType"
import { CommonResponse } from "@/entityTypes/commonType"
import { BuckEmailListType,BuckEmailTasklogQueryType,EmailMarketingSendLogListDisplay } from "@/entityTypes/buckemailType"
import { EmailMarketingSendLogEntity} from "@/model/emailMarketingSendLogdb"
/**
 * buck send email ipc
 */
export function registerBuckEmailIpcHandlers() {
    
    ipcMain.on(BUCKEMAILSEND, async (event, data) => {
        const buckemailCon = new BuckemailController()
        const qdata = JSON.parse(data) as EmailMarketingsubdata;
        switch (qdata.sourceType) {
            case 1: {
                if (!qdata.emailtaskentityId) {
                    const comMsgs: CommonDialogMsg = {
                        status: false,
                        code: 20241108110518,
                        data: {
                            action: "error",
                            title: "buckemailsend.email_souce_empty",
                            content: "buckemailsend.check_email_souce"
                        }
                    }
                    event.sender.send(BUCKEMAILSENDMESSAGE, JSON.stringify(comMsgs))
                    return
                }
                //get email address in search result
                // const emailList:Array<EmailItem>=[]
                const emailsearModuel = new EmailSearchTaskModule()
                const emailList = await emailsearModuel.getAllEmails(qdata.emailtaskentityId)
                if (emailList.length == 0) {
                    const comMsgs: CommonDialogMsg = {
                        status: false,
                        code: 20241108151239,
                        data: {
                            action: "error",
                            title: "buckemailsend.receiver_email_list_empty",
                            content: "buckemailsend.receiver_email_list_empty"
                        }
                    }
                    event.sender.send(BUCKEMAILSENDMESSAGE, JSON.stringify(comMsgs))
                    return
                }
                const bucketEmailData: Buckemailstruct = {
                    EmailBtype: BuckEmailType.EXTRACTEMAIL,
                    //EmailList: emailList,
                    EmailtaskentityId: qdata.emailtaskentityId,
                    EmailTemplateslist: qdata.EmailTemplateslist,
                    EmailFilterlist: qdata.EmailFilterlist,
                    EmailServicelist: qdata.EmailServicelist,
                    NotDuplicate: qdata.NotDuplicate
                }

                const taskid = await buckemailCon.startBuckEmailTask(bucketEmailData)
                const comMsgs: CommonDialogMsg = {
                    status: true,
                    code: 20241108151239,
                    data: {
                        action: "success",
                        title: "buckemailsend.start_send_email",
                        content: taskid.toString()
                    }
                }
                event.sender.send(BUCKEMAILSENDMESSAGE, JSON.stringify(comMsgs))
            }
                break;
        }
    })
    //get buck email task lis´
    ipcMain.handle(BUCKEMAILTASKLIST, async (event, data) => {
        const qdata = JSON.parse(data) as ItemSearchparam;
        if (!Object.prototype.hasOwnProperty.call(qdata, "page")) {
            qdata.page = 0;
        }
        if (!Object.prototype.hasOwnProperty.call(qdata, "size")) {
            qdata.size = 100;
        }
        const buckemailCon = new BuckemailController()
        const res = await buckemailCon.getBuckEmailTaskList(qdata.page, qdata.size, qdata.sortby)
        const resp: CommonResponse<BuckEmailListType> = {
            status: true,
            msg: "",
            data: {
                records: res.records,
                num: res.total
            }
        }
        return resp
    })
    //get buck email task log
    ipcMain.handle(BUCKEMAILTASKSENDLOG, async (event, data) => {
        const qdata = JSON.parse(data) as BuckEmailTasklogQueryType;
        if (!Object.prototype.hasOwnProperty.call(qdata, "TaskId")) {
            const resp: CommonResponse<null> = {
                status: false,
                msg: "taskid is empty"
            }
            return resp
        }
        if (!Object.prototype.hasOwnProperty.call(qdata, "page")) {
            qdata.page = 0;
        }
        if (!Object.prototype.hasOwnProperty.call(qdata, "size")) {
            qdata.size = 100;
        }
        const buckemailCon = new BuckemailController()
        const res=await buckemailCon.getBuckEmailSendLog(qdata.TaskId, qdata.page, qdata.size, qdata.where,qdata.sortby)
        const resp: CommonResponse<EmailMarketingSendLogListDisplay> = {
            status: true,
            msg: "",
            data: {
                records: res.records,
                num: res.total
            }
        }
        return resp
    })
}
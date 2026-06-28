import { BuckemailController } from "@/controller/buckemailController";
import { BUCKEMAILSEND } from "@/config/channellist";
import { ipcMain } from "electron";
import {
  EmailMarketingsubdata,
  EmailItem,
  Buckemailstruct,
} from "@/entityTypes/emailmarketingType";
import { CommonDialogMsg } from "@/entityTypes/commonType";
import {
  BUCKEMAILSENDMESSAGE,
  BUCKEMAILTASKLIST,
  BUCKEMAILTASKSENDLOG,
} from "@/config/channellist";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import {
  BuckemailTaskStartInput,
  mapBuckemailTaskStartInputToEntity,
} from "@/entityTypes/emailmarketingType";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import { ItemSearchparam } from "@/entityTypes/commonType";
import { CommonResponse } from "@/entityTypes/commonType";
import {
  BuckEmailListType,
  BuckEmailTasklogQueryType,
  EmailMarketingSendLogListDisplay,
} from "@/entityTypes/buckemailType";
import { EmailMarketingSendLogEntity } from "@/model/emailMarketingSendLogdb";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  buckEmailTaskListInputSchema,
  buckEmailTaskSendLogInputSchema,
} from "@/schemas/ipc/buckEmail";
/**
 * buck send email ipc
 */
export function registerBuckEmailIpcHandlers() {
  ipcMain.on(BUCKEMAILSEND, async (event, data: unknown) => {
    const buckemailCon = new BuckemailController();
    const qdata = JSON.parse(data as string) as EmailMarketingsubdata;
    switch (qdata.sourceType) {
      case 1:
        {
          if (!qdata.emailtaskentityId) {
            const comMsgs: CommonDialogMsg = {
              status: false,
              code: 20241108110518,
              data: {
                action: "error",
                title: "buckemailsend.email_souce_empty",
                content: "buckemailsend.check_email_souce",
              },
            };
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(BUCKEMAILSENDMESSAGE, JSON.stringify(comMsgs));
            return;
          }
          //get email address in search result
          // const emailList:Array<EmailItem>=[]
          const emailsearModuel = new EmailSearchTaskModule();
          const emailList = await emailsearModuel.getAllEmails(
            qdata.emailtaskentityId
          );
          if (emailList.length == 0) {
            const comMsgs: CommonDialogMsg = {
              status: false,
              code: 20241108151239,
              data: {
                action: "error",
                title: "buckemailsend.receiver_email_list_empty",
                content: "buckemailsend.receiver_email_list_empty",
              },
            };
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(BUCKEMAILSENDMESSAGE, JSON.stringify(comMsgs));
            return;
          }
          const bucketEmailData: Buckemailstruct = {
            EmailBtype: BuckEmailType.EXTRACTEMAIL,
            EmailtaskentityId: qdata.emailtaskentityId,
            EmailList: emailList,
            EmailTemplateslist: qdata.EmailTemplateslist ?? [],
            EmailFilterlist: qdata.EmailFilterlist ?? [],
            EmailServicelist: qdata.EmailServicelist ?? [],
            NotDuplicate: qdata.NotDuplicate,
            email_subject: qdata.email_subject,
            email_html_content: qdata.email_html_content,
          };

          const taskid = await buckemailCon.startBuckEmailTask(bucketEmailData);
          const comMsgs: CommonDialogMsg = {
            status: true,
            code: 20241108151239,
            data: {
              action: "success",
              title: "buckemailsend.start_send_email",
              content: taskid.toString(),
            },
          };
          (
            event as {
              sender: { send: (channel: string, message: string) => void };
            }
          ).sender.send(BUCKEMAILSENDMESSAGE, JSON.stringify(comMsgs));
        }
        break;
    }
  });
  //get buck email task lis´
  registerValidatedHandler(
    BUCKEMAILTASKLIST,
    buckEmailTaskListInputSchema,
    async (input) => {
      const buckemailCon = new BuckemailController();
      const res = await buckemailCon.getBuckEmailTaskList(
        input.page ?? 0,
        input.size ?? 100,
        input.sortby
      );
      // Wrapper wraps this in {status: true, msg: 'ok', data: {...}},
      // matching the original CommonResponse<BuckEmailListType> wire shape
      // (just msg: '' replaced with msg: 'ok', safe for frontend).
      return {
        records: res.records,
        num: res.total,
      };
    }
  );
  //get buck email task log
  registerValidatedHandler(
    BUCKEMAILTASKSENDLOG,
    buckEmailTaskSendLogInputSchema,
    async (input) => {
      // Original: if TaskId missing -> {status:false, msg:'taskid is empty'}.
      // Schema now requires TaskId as positive int; missing/invalid is
      // rejected at boundary by the wrapper with a clear zod message.
      const buckemailCon = new BuckemailController();
      const res = await buckemailCon.getBuckEmailSendLog(
        input.TaskId,
        input.page ?? 0,
        input.size ?? 100,
        input.where,
        input.sortby
      );
      return {
        records: res.records,
        num: res.total,
      };
    }
  );
}

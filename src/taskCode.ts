"use strict";
export {};
import { ProcessMessage } from "@/entityTypes/processMessage-type";
import { EmailSearch } from "@/childprocess/emailSearch";
import {
  EmailsControldata,
  EmailResult,
} from "@/entityTypes/emailextraction-type";
import {
  EmailSendResult,
  Buckemailremotedata,
} from "@/entityTypes/emailmarketingType";
import { EmailSend } from "@/childprocess/emailSend";
import { Proxy } from "@/entityTypes/proxyType";
// import { VideoDownloadFactory } from "@/modules/videodownload/VideoDownloadFactory"
// import { VideodoanloadSuccessCall, VideoCaptionGenerateParam, CookiesProxy, processVideoDownloadParam, VideodownloadMsg, VideodownloadTaskMsg } from "@/entityTypes/videoType"
// import { VideoCaptionFactory } from "@/modules/videoCaption/VideoCaptionFactory"
// import { VideoCaptionImpl } from '@/modules/interface/VideoCaptionImpl';
// import { extraFileEntity, VideoCaptionMsg,VideoPublishMsg } from "@/entityTypes/videoType";
import { TransItemsParam } from "@/entityTypes/translateType";
// import { VideoTranslateItem } from "@/entityTypes/videoType";
import { TranslateProducer } from "@/modules/TranslateProducer";
// import { VideoDownloadTagEntity } from "@/entity/VideoDownloadTag.entity"
import { CommonMessage } from "@/entityTypes/commonType";
import { Usersearchdata } from "@/entityTypes/searchControlType";
import { UserSearch } from "@/childprocess/userSearch";
import { ResultParseItemType } from "@/entityTypes/scrapeType";
import { CookiesType } from "@/entityTypes/cookiesType";
import { AIRecoveryResponse } from "@/entityTypes/processMessage-type";
import { handleAIRecoveryResponse } from "@/childprocess/utils/AIRecoveryBridge";
import { handleAiSupportResponse } from "@/childprocess/utils/AiSupportBridge";
import type { AiSupportResponseMessage } from "@/modules/interface/BackgroundProcessMessages";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
// import { VideoPublishParam } from "./entityTypes/videoPublishType";
// import { VideoPublishService } from "./service/VideoPublishService";

// Type for cookies update message
type CookiesUpdateData = {
  accountId: number;
  cookies: Array<CookiesType>;
};

// process.parentPort is available in Worker Threads
const parentPort = (
  process as unknown as {
    parentPort?: {
      on: (event: string, handler: (e: { data: string }) => void) => void;
      postMessage: (message: string) => void;
    };
  }
).parentPort;
if (parentPort) {
  parentPort.on("message", async (e) => {
    //console.log(e.data)
    const pme = JSON.parse(e.data) as ProcessMessage<unknown> & {
      type?: string;
    };
    if (pme && pme.type === "AI_SUPPORT_RESPONSE") {
      // Check AI enable before processing AI messages
      const tokenService = new Token();
      const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
      if (aiEnabled !== "true") {
        console.warn("AI features are disabled. Ignoring AI_SUPPORT_RESPONSE.");
        return;
      }
      handleAiSupportResponse(pme as unknown as AiSupportResponseMessage);
      return;
    }
    switch (pme.action) {
      //check action
      case "searchscraper": {
        const userSearchdata = pme.data as Usersearchdata;
        if (!userSearchdata) {
          console.log("data is empty");
          return;
        }
        const userSer = new UserSearch();
        //const res = await userSer.searchData(userSearchdata)
        //console.log(res)
        // const message: ProcessMessage<SearchDataRun> = {
        //     action: "saveres",
        //     data: res
        // }
        await userSer
          .searchData(
            userSearchdata,
            function (result) {
              console.log(result);
              const message: ProcessMessage<ResultParseItemType> = {
                action: "savesearchresult",
                data: result,
              };
              parentPort.postMessage(JSON.stringify(message));
            },
            function (accountId, cookies) {
              // Send updated cookies back to main process
              console.log(
                `Sending updated cookies for account ${accountId} to main process`
              );
              const cookiesMessage: ProcessMessage<CookiesUpdateData> = {
                action: "updateaccountcookies",
                data: {
                  accountId: accountId,
                  cookies: cookies,
                },
              };
              parentPort.postMessage(JSON.stringify(cookiesMessage));
            }
          )
          .then(() => {
            // Send completion message after all results are sent
            const completeMessage: ProcessMessage<null> = {
              action: "searchcomplete",
              data: null,
            };
            parentPort.postMessage(JSON.stringify(completeMessage));
          })
          .catch((error) => {
            // Send error message if search fails
            const errorMessage: ProcessMessage<{ error: string }> = {
              action: "searcherror",
              data: {
                error: error instanceof Error ? error.message : String(error),
              },
            };
            parentPort.postMessage(JSON.stringify(errorMessage));
          });
        //console.log(port)
        //process.parentPort.postMessage(JSON.stringify(message))
        //});
        break;
      }
      case "sendEmail":
        {
          const emailsendModel = new EmailSend();
          if (!pme.data) {
            console.error("data is null");
            return;
          }
          await emailsendModel
            .send(
              pme.data as Buckemailremotedata,
              (receiver, title, content) => {
                const senddata: EmailSendResult = {
                  receiver: receiver,
                  status: true,
                  title: title,
                  content: content,
                };
                const message: ProcessMessage<EmailSendResult> = {
                  action: "EmailSendSuccess",
                  data: senddata,
                };
                parentPort.postMessage(JSON.stringify(message));
              },
              (receiver, info, title, content) => {
                const senddata: EmailSendResult = {
                  receiver: receiver,
                  status: false,
                  info: info,
                  title: title,
                  content: content,
                };
                const message: ProcessMessage<EmailSendResult> = {
                  action: "EmailSendFailure",
                  data: senddata,
                };
                parentPort.postMessage(JSON.stringify(message));
              }
            )
            .then(() => {
              const message: ProcessMessage<null> = {
                action: "sendEmailEnd",
              };
              parentPort.postMessage(JSON.stringify(message));
            });
        }
        break;
      case "searchEmail": {
        const userEmaildata = pme.data as EmailsControldata;

        if (!userEmaildata) {
          console.error("data is empty");
          return;
        }
        const emailSearchModel = new EmailSearch();
        await emailSearchModel.searchEmail(userEmaildata, (res) => {
          const message: ProcessMessage<EmailResult> = {
            action: "saveres",
            data: res,
          };

          parentPort.postMessage(JSON.stringify(message));
        });
        break;
      }
      case "aiRecoveryResponse": {
        // Check AI enable before processing AI recovery messages
        const tokenService = new Token();
        const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
        if (aiEnabled !== "true") {
          console.warn(
            "AI features are disabled. Ignoring aiRecoveryResponse."
          );
          break;
        }
        const response = pme.data as AIRecoveryResponse;
        handleAIRecoveryResponse(response);
        break;
      }
    }
  });
}

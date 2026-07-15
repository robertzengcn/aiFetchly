import { ipcMain, BrowserWindow, dialog } from 'electron'
//import { UserController, userResponse, userlogin } from '@/controller/UserController'
import { CampaignController } from '@/controller/campaignController'
// import { campaignResponse } from '@/modules/campaign'
import { SocialTaskController } from '@/controller/socialtask-controller'
import { SocialTaskResponse, SocialTaskInfoResponse, SocialTaskTypeResponse, TagResponse, SaveSocialTaskResponse } from '@/entityTypes/socialtask-type'
import { SocialTaskRun } from "@/modules/socialtaskrun"
import { SocialTaskResult } from '@/modules/socialtaskResult'
import { User } from '@/modules/user'
import { MainProcessAppInfoModule } from '@/modules/MainProcessAppInfoModule'

// import { ProxyApi } from '@/modules/proxy_api'
// import { ProxyController } from '@/controller/proxy-controller'
// import { ProxyParseItem } from '@/entityTypes/proxyType'
import { CommonMessage, CommonResponse } from "@/entityTypes/commonType"
import { campaignEntity } from "@/entityTypes/campaign-type"
import { OPENDIRECTORY, CHOOSEFILEDIALOG, GET_APP_INFO } from "@/config/channellist"
import { log } from "@/modules/Logger";
import { AppInfo } from '@/modules/AppInfoModule'
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { noInputSchema, byIdInputSchema } from "@/schemas/ipc/_shared/common";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

const taskListSchema = lazySchema(() =>
  z.object({ id: z.number().int(), page: z.number().int().optional(), size: z.number().int().optional() })
);


export default function SyncMsg(mainWindow: BrowserWindow) {
  log.info("SyncMsg");
  

 
  ipcMain.handle("campaign:list", async (event, data) => {
    //console.log("handle campaign:list")
    const camControl = new CampaignController()
    const res = await camControl.getCampaignlist(data as string).then(function (res) {
      return res
      // return {
      //   status: true,
      //   msg: "get campaign list success",
      //   data: res
      // };
    }).catch(function (err) {
      log.info(err);
      if (err instanceof Error) {
        return {
          status: false,
          msg: err.message,
        };
      } else {
        return {
          status: false,
          msg: "unknow error",
        };
      }
    });
    log.info(res)
    return res as CommonResponse<campaignEntity>;
  });
  //get social task list
  registerValidatedHandler("socialtask:list", taskListSchema, async (input) => {
    const socialControl = new SocialTaskController()
    const res = await socialControl.getSocialTasklist(input.id, input.page ?? 0, input.size ?? 0)
    if (!res.status) throw new Error(res.msg || "Unknown error")
    return res.data
  });
  //get social task info
  registerValidatedHandler("socialtask:info", byIdInputSchema, async (input) => {
    const socialControl = new SocialTaskController()
    const res = await socialControl.getSocialTaskinfo(input.id)
    if (!res.status) throw new Error(res.msg || "Unknown error")
    return res.data
  });

  //get social task type list
  registerValidatedHandler("socialtasktype:list", noInputSchema, async () => {
    const socialControl = new SocialTaskController()
    const res = await socialControl.getSocialTaskType()
    if (!res.status) throw new Error(res.msg || "Unknown error")
    return res.data
  });
  //get tag list
  registerValidatedHandler("tag:list", noInputSchema, async () => {
    const socialControl = new SocialTaskController()
    const res = await socialControl.getTaglist()
    if (!res.status) throw new Error(res.msg || "Unknown error")
    return res.data
  });
  //save social task
  registerValidatedHandler("socialtask:save", lazySchema(() => z.object({}).passthrough()), async (input) => {
    const socialControl = new SocialTaskController()
    const res = await socialControl.saveSocialTask(input as never)
    if (!res.status) throw new Error(res.msg || "Unknown error")
    return res.data
  });

  registerValidatedHandler("socialtaskrun:list", taskListSchema, async (input) => {
    const stkrunModel = new SocialTaskRun()
    const reslist = await stkrunModel.getrunlist(input.id, input.page ?? 10, input.size ?? 10)
    return reslist
  });
  registerValidatedHandler("socialtaskresult:list", taskListSchema, async (input) => {
    const socialtaskres = new SocialTaskResult()
    const reslist = socialtaskres.gettaskresultlist(input.id, input.page ?? 10, input.size ?? 10, null)
    return reslist
  })

  registerValidatedHandler(GET_APP_INFO, noInputSchema, async () => {
    const appInfo = new MainProcessAppInfoModule()
    return await appInfo.getAppInfo()
  })


  registerValidatedHandler(OPENDIRECTORY, noInputSchema, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (canceled) {
      throw new Error("canceled")
    }
    return filePaths[0]
  })
  //choose file dialog
  registerValidatedHandler(CHOOSEFILEDIALOG, lazySchema(() => z.object({
    title: z.string().optional(),
    filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional(),
    properties: z.array(z.string()).optional(),
  }).passthrough()), async (input) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: input.title,
      filters: input.filters,
      properties: input.properties ?? ['openFile', 'openDirectory'],
    })
    if (canceled) {
      throw new Error("canceled")
    }
    return filePaths[0]
  })



}
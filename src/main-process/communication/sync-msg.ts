import { ipcMain, dialog, BrowserWindow } from 'electron'
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
import { AppInfo } from '@/modules/AppInfoModule'


export default function SyncMsg(mainWindow: BrowserWindow) {
  console.log("SyncMsg");
  

 
  ipcMain.handle("campaign:list", async (event, data) => {
    //console.log("handle campaign:list")
    const camControl = new CampaignController()
    const res = await camControl.getCampaignlist(data).then(function (res) {
      return res
      // return {
      //   status: true,
      //   msg: "get campaign list success",
      //   data: res
      // };
    }).catch(function (err) {
      console.log(err);
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
    console.log(res)
    return res as CommonResponse<campaignEntity>;
  });
  //get social task list
  ipcMain.handle("socialtask:list", async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    const socialControl = new SocialTaskController()
    const res = await socialControl.getSocialTasklist(qdata.id, qdata.page, qdata.size).then(function (res) {
      // console.log(res);
      return res;
    }).catch(function (err) {
      console.log(err);
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
    console.log(res)
    return res as SocialTaskResponse;
  });
  //get social task info
  ipcMain.handle("socialtask:info", async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    const socialControl = new SocialTaskController()
    const res = await socialControl.getSocialTaskinfo(qdata.id).then(function (res) {
      // console.log(res);
      return res;
    }).catch(function (err) {
      console.log(err);
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
    console.log(res)
    return res as SocialTaskInfoResponse;
  });

  //get social task type list
  ipcMain.handle("socialtasktype:list", async (event, data) => {

    const socialControl = new SocialTaskController()
    const res = await socialControl.getSocialTaskType().then(function (res) {
      // console.log(res);
      return res;
    }).catch(function (err) {
      console.log(err);
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
    console.log(res)
    return res as SocialTaskTypeResponse;
  });
  //get tag list
  ipcMain.handle("tag:list", async (event, data) => {

    const socialControl = new SocialTaskController()
    const res = await socialControl.getTaglist().then(function (res) {
      // console.log(res);
      return res;
    }).catch(function (err) {
      console.log(err);
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
    console.log(res)
    return res as TagResponse;
  });
  //save social task
  ipcMain.handle("socialtask:save", async (event, data) => {
    const qdata = JSON.parse(data);

    const socialControl = new SocialTaskController()
    const res = await socialControl.saveSocialTask(qdata).then(function (res) {
      // console.log(res);
      return res;
    }).catch(function (err) {
      // console.log(err);
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
    console.log(res)
    return res as SaveSocialTaskResponse;
  });

  ipcMain.handle("socialtaskrun:list", async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    if (!("page" in qdata)) {
      qdata.page = 10;
    }
    if (!("size" in qdata)) {
      qdata.size = 10;
    }
    const stkrunModel = new SocialTaskRun()
    // const res = await stkrunModel.getrunlist(qdata.id).then(function (res) {
    //   // console.log(res);
    const reslist = stkrunModel.getrunlist(qdata.id, qdata.page, qdata.size)
    console.log(reslist)
    return { status: true, msg: "", data: reslist };
    //   // return {status:true,msg:"",data:res};
    // }).catch(function (err) {
    //   console.log(err);
    //   if (err instanceof Error) {
    //     return {
    //       status: false,
    //       msg: err.message,
    //     };
    //   } else {
    //     return {
    //       status: false,
    //       msg: "unknow error",
    //     };
    //   }
    // });
    // console.log(res)
    // return res as SocialTaskResponse;
  });
  ipcMain.handle("socialtaskresult:list", async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    if (!("page" in qdata)) {
      qdata.page = 10;
    }
    if (!("size" in qdata)) {
      qdata.size = 10;
    }
    const socialtaskres = new SocialTaskResult()
    const reslist = socialtaskres.gettaskresultlist(qdata.id, qdata.page, qdata.size, null)
    return { status: true, msg: "", data: reslist };
  })

  ipcMain.handle(GET_APP_INFO, async () => {
    const appInfo = new MainProcessAppInfoModule()
    const res = await appInfo.getAppInfo()
    const result:CommonMessage<AppInfo> = {
      status: true,
      msg: "get app info success",
      data: res
    }
    return result
  })


  ipcMain.handle(OPENDIRECTORY, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (canceled) {
      return { status: false, msg: "canceled" }
    } else {
      return { status: true, data: filePaths[0] }
    }
  })
  //choose file dialog
  ipcMain.handle(CHOOSEFILEDIALOG, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'openDirectory']
    })
    if (canceled) {
      return { status: false, msg: "canceled" }
    } else {
      return { status: true, data: filePaths[0] }
    }
  })



}
import { ipcMain } from 'electron';
import { EXTRAMODULECHANNE_LIST, EXTRAMODULECHANNE_INSTALL, EXTRAMODULECHANNE_UNINSTALL, EXTRAMODULECHANNE_MESSAGE,EXTRAMODULE_UPGRADE,EXTRAMODULE_UPGRAD_MESSAGE } from "@/config/channellist";
import { ExtraModuleController } from "@/controller/extramoduleController";
import { CommonResponse,CommonDialogMsg } from "@/entityTypes/commonType"
import { ExtraModule } from "@/entityTypes/extramoduleType"
export function registerExtraModulesIpcHandlers() {
  console.log("extramodules list register")
 
  ipcMain.handle(EXTRAMODULECHANNE_LIST, async (event, arg) => {
    const qdata = JSON.parse(arg);
    if (!Object.prototype.hasOwnProperty.call(qdata, "page")) {
      qdata.page = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(qdata, "size")) {
      qdata.size = 100;
    }
    // const extraModules = new ExtraModuleController()
    // Handle IPC call
    const extraModulesCtrl = new ExtraModuleController()
    const extra = await extraModulesCtrl.getExtraModuleList(qdata.page, qdata.size);

    const res: CommonResponse<ExtraModule> = {
      status: true,
      msg: "",
      data: extra
    }
    return res
  });

  ipcMain.on(EXTRAMODULECHANNE_INSTALL, async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("name" in qdata)) {
      throw new Error("name not found");
    }
    // const extraCtrl = new ExtraModuleController()
    try {
      const extraModulesCtrl = new ExtraModuleController()
      await extraModulesCtrl.installExtraModule(qdata.name, function () {
        
        event.sender.send(EXTRAMODULECHANNE_MESSAGE, JSON.stringify({
          status: true,
          msg: "success",
          data: {
            name: qdata.name,
            message: ""
          }
        }))
      }, function (error) {
        if (error.message.length > 0) {
          event.sender.send(EXTRAMODULECHANNE_MESSAGE, JSON.stringify({
            status: false,
            msg: error.message
          }))
        }
      })
    } catch (error) {
      if (error instanceof Error) {
        event.sender.send(EXTRAMODULECHANNE_MESSAGE, JSON.stringify({
          status: false,
          msg: error.message
        }))
      }
    }
  });

  ipcMain.on(EXTRAMODULECHANNE_UNINSTALL, async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("name" in qdata)) {
      throw new Error("name not found");
    }
    // const extraCtrl = new ExtraModuleController()
    try {
      const extraModulesCtrl = new ExtraModuleController()
      extraModulesCtrl.removeExtraModule(qdata.name, function () {
        event.sender.send(EXTRAMODULECHANNE_MESSAGE, JSON.stringify({
          status: true,
          msg: "success",
          data: {
            name: qdata.name,
            message: ""
          }
        }))
      }, function (message) {
        if (message.length > 0) {
          event.sender.send(EXTRAMODULECHANNE_MESSAGE, JSON.stringify({
            status: false,
            msg: "failed"
          }))
        }
      })
    } catch (error) {
      if (error instanceof Error) {
        event.sender.send(EXTRAMODULECHANNE_MESSAGE, JSON.stringify({
          status: false,
          msg: error.message
        }))
      }
    }
  });
  ipcMain.on(EXTRAMODULE_UPGRADE, async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("name" in qdata)) {
      throw new Error("name not found");
    }
    const extraModulesCtrl = new ExtraModuleController()
    await extraModulesCtrl.upgradePackage(qdata.name,()=>{
      
      const msgData:CommonDialogMsg={
        status: true,
        code:0,
        msg: "success",
      }
      event.sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData))
    },(errormsg)=>{
      const msgData:CommonDialogMsg={
        status: false,
        code:0,
        msg: errormsg,
      }
      event.sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData))
    }).catch((error) => {
      if (error instanceof Error) {
        const msgData:CommonDialogMsg={
          status: false,
          code:0,
          msg: error.message,
        }
        event.sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData))
      }
    }).then(() => {
      const msgData:CommonDialogMsg={
        status: true,
        code:0,
        msg: "success",
      }
      event.sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData))
    })

  })
}
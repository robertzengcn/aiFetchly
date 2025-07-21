import { ipcMain, dialog, BrowserWindow } from 'electron'
import { SOCIALPLATFORM_LIST, SOCIALACCOUNTlIST, SOCIALACCOUNTDETAIL, SOCIAL_ACCOUNT_LOGIN, SOCIALACCOUNTSAVE, SOCIAL_ACCOUNT_LOGIN_MESSSAGE, SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES,SOCIAL_ACCOUNT_CLEAN_COOKIES,SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE } from "@/config/channellist"
import { SocialAccount } from '@/modules/socialaccount'
import { SocialPlatform } from "@/modules/social_platform"
import { SocialAccountController } from '@/controller/socialaccount-controller'
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { RequireCookiesParam,RequireCookiesMsgbox } from "@/entityTypes/cookiesType"
import fs from "fs";
//import {} from "@/config/channellist"
// import { ItemSearchparam } from "@/entityTypes/commonType"
export function registerSocialAccountIpcHandlers(mainWindow: BrowserWindow) {

  ipcMain.handle(SOCIALACCOUNTlIST, async (event, data) => {
    const qdata = JSON.parse(data);

    if (!("page" in qdata)) {
      qdata.page = 10;
    }
    if (!("size" in qdata)) {
      qdata.size = 10;
    }
    if (!("search" in qdata)) {
      qdata.search = "";
    }

    let platformId = 0
    const socialaccount = new SocialAccount()
    if (qdata.where) {
      try {
       
       
        platformId = socialaccount.convertPlatform(qdata.where)
      } catch (e) {
        if (e instanceof Error) {
          return {
            status: false,
            msg: e.message,
          };
        } else {
          return {
            status: false,
            msg: "unkonw error in covert platform"
          };
        }
      }

    }
    const res = await socialaccount.getSocialaccountlist(qdata.page, qdata.size, qdata.search, platformId).catch(function (err) {
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

    })
    // console.log(res)
    return res
  })
  ipcMain.handle(SOCIALACCOUNTDETAIL, async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    const socialaccount = new SocialAccount()
    //get detail from remote
    // const socialaccount = new SocialAccount()
    const res = await socialaccount.getAccountdetail(qdata.id).catch(function (err) {
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

    })

    return res
  })
  //list social platform
  ipcMain.handle(SOCIALPLATFORM_LIST, async (event, data) => {
    const qdata = JSON.parse(data);

    if (!("page" in qdata)) {
      qdata.page = 10;
    }
    if (!("size" in qdata)) {
      qdata.size = 10;
    }

    const socialPlatform=new SocialPlatform() 
    const res = await socialPlatform.listsocialplatform(qdata.page, qdata.size).catch(function (err) {
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

    })
    // console.log(res)
    return res
  })
  //login social account
  ipcMain.on(SOCIAL_ACCOUNT_LOGIN, async (event, data) => {
    const qdata = JSON.parse(data) as RequireCookiesMsgbox;
    if (!("id" in qdata)) {
      throw new Error("id not found");
    }
    if (!("platform" in qdata)) {
      throw new Error("platform not found");
    }
    //const sac = new SocialAccountController()
    try {
      const sac=new SocialAccountController()
      // event.sender.send('socialaccount:login:msg', JSON.stringify({ msg: "test", status: false }))
      await sac.showSocialaccountMsg(qdata.id, qdata.platform,() => {
        const comMsgs: CommonDialogMsg = {
          status: false,
          code: qdata.id,
          data: {
            action: "uploadfileMsg",
            title: "socialaccount.uploadfilemsg_title",
            content: "socialaccount.uploadfilemsg_content"
          }
        }
        event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
      },()=>{//ask user to manual login
        const comMsgs: CommonDialogMsg = {
          status: false,
          code: qdata.id,
          data: {
            action: "manualLoginMsg",
            title: "socialaccount.manuallogin_title",
            content: "socialaccount.manuallogin_content"
          }
        }
        event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
      },()=>{
        const comMsgs: CommonDialogMsg = {
          status: true,
          code: 0,
          data: {
            action: "saveCookiesSuccess",
            title: "socialaccount.update_cookies_success",
            content: ""
          }
        }
        event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
      }).catch(function (err) {
        if (err instanceof Error) {
          //console log error line
          console.error(err.stack)
          //console.log(error.message)
          const comMsgs: CommonDialogMsg = {
            status: false,
            code: 202412171245163,
            msg: err.message,
           
          }
          event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
        }
      })

    } catch (error) {
      if (error instanceof Error) {
        //console.log(error.message)
        const comMsgs: CommonDialogMsg = {
          status: false,
          code: 202412141226150,
          msg: error.message,
       
        }
        event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
      }
    }
  })
  ipcMain.on(SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE, async (event, data) => {
    const qdata = JSON.parse(data) as RequireCookiesParam;
    if (!("id" in qdata)) {
      throw new Error("id not found");
    }
    try {
      const sac=new SocialAccountController()
      await sac.showSocialmediaWin(qdata.id,undefined,()=>{
        const comMsgs: CommonDialogMsg = {
          status: true,
          code: 0,
          data: {
            action: "saveCookiesSuccess",
            title: "socialaccount.update_cookies_success",
            content: ""
          }
        }
        event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
      })
    } catch (error) {
      if (error instanceof Error) {
        //console.log(error.message)
        const comMsgs: CommonDialogMsg = {
          status: false,
          code: 202412171122188,
          data: {
            action: "error",
            title: "",
            content: error.message
          }
        }
        event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
      }
    }

  })
  ipcMain.handle(SOCIALACCOUNTSAVE, async (event, data) => {
    //save social account
    const qdata = JSON.parse(data);
    const socialaccount = new SocialAccount()
    const res = await socialaccount.saveSocialAccount(qdata).catch(function (err) {
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
    })
    return res
  })
  //delete social account
  ipcMain.handle("socialaccount:delete", async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    //get detail from remote
    const socialaccount = new SocialAccount()
    const res = await socialaccount.deleteAccount(qdata.id).catch(function (err) {
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

    })

    return res
  })
  ipcMain.on(SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES, async (event, data) => {
    const qdata = JSON.parse(data) as RequireCookiesParam
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      const cmsg={
        status: false,
        msg: "id not found",
      } as CommonDialogMsg;
      event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(cmsg))
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Netscape Cookies', extensions: ['txt'] }]
    })
    if (canceled) {
      const cmsg={ status: false, msg: "canceled" } as CommonDialogMsg
      event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(cmsg))
    } else {
      if (filePaths) {
        console.log(filePaths[0])
        fs.access(filePaths[0], fs.constants.W_OK, async (e) => {
          if (e) {
            if (e instanceof Error) {
              const cmsg={ status: false, msg: e.message } as CommonDialogMsg
              event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(cmsg))
            }
          } else {
            const sac=new SocialAccountController()
            const res = await sac.handleCookiesfile(filePaths[0], qdata.id)
            if (res) {
              const comMsgs: CommonDialogMsg = {
                status: true,
                code: qdata.id,
                data: {
                  action: "handleCookiesfile",
                  title: "socialaccount.handleCookiesfileSuccess",
                  content: ""
                }
              }
              event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
            } else {
              const comMsgs: CommonDialogMsg = {
                status: false,
                code: qdata.id,
                data: {
                  action: "handleCookiesfile",
                  title: "socialaccount.handleCookiesfileFailure",
                  content: "socialaccount.insertCookiesFailure"
                }
              }
              event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
            }

          }
      })


      }
      //return { status: true, data: filePaths[0] }
    }
  })
  //remove cookies
  ipcMain.on(SOCIAL_ACCOUNT_CLEAN_COOKIES, async (event, data) => {
    const qdata = JSON.parse(data) as RequireCookiesParam
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    const sac=new SocialAccountController()
    sac.cleanCookies(qdata.id)
    const comMsgs: CommonDialogMsg = {
      status: true,
      code: 0,
      data: {
        action: "deleteCookies",
        title: "",
        content: ""
      }
    }
    event.sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs))
  })
}
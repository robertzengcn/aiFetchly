import { ipcMain, BrowserWindow, dialog } from "electron";
import {
  SOCIALPLATFORM_LIST,
  SOCIALACCOUNTlIST,
  SOCIALACCOUNTDETAIL,
  SOCIALACCOUNTSAVE,
  SOCIALACCOUNTDELETE,
  SOCIAL_ACCOUNT_LOGIN,
  SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
  SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES,
  SOCIAL_ACCOUNT_CLEAN_COOKIES,
  SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE,
} from "@/config/channellist";
import { SocialAccount } from "@/modules/socialaccount";
import { SocialPlatform } from "@/modules/social_platform";
import { SocialAccountController } from "@/controller/socialaccount-controller";
import { CommonDialogMsg } from "@/entityTypes/commonType";
import {
  RequireCookiesParam,
  RequireCookiesMsgbox,
} from "@/entityTypes/cookiesType";
import fs from "fs";
import { SocialAccountDetailData } from "@/entityTypes/socialaccount-type";
import { SocialPlatformList } from "@/config/generate";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  socialAccountListInputSchema,
  socialAccountByIdInputSchema,
  socialPlatformListInputSchema,
  socialAccountSaveInputSchema,
} from "@/schemas/ipc/socialAccount";

export function registerSocialAccountIpcHandlers(mainWindow: BrowserWindow) {
  registerValidatedHandler(
    SOCIALACCOUNTlIST,
    socialAccountListInputSchema,
    async (input) => {
      const socialaccount = new SocialAccountController();
      // Original behavior: where is a platform name string; convertPlatform
      // throws on unknown platform - surface as status:false envelope.
      let platformId = 0;
      if (input.where) {
        platformId = socialaccount.convertPlatform(input.where);
      }
      // Original used page=10 default (likely a typo for 0); preserve to
      // avoid changing pagination behavior the frontend may rely on.
      return socialaccount.getSocialaccountlist(
        input.page ?? 10,
        input.size ?? 10,
        input.search ?? "",
        platformId
      );
    }
  );

  registerValidatedHandler(
    SOCIALACCOUNTDETAIL,
    socialAccountByIdInputSchema,
    async (input) => {
      const socialaccount = new SocialAccountController();
      return socialaccount.getAccountdetail(input.id);
    }
  );

  registerValidatedHandler(
    SOCIALPLATFORM_LIST,
    socialPlatformListInputSchema,
    async (input) => {
      const socialPlatform = new SocialPlatform();
      // Same page=10 default quirk as SOCIALACCOUNTlIST; preserve.
      return socialPlatform.listsocialplatform(
        input.page ?? 10,
        input.size ?? 10
      );
    }
  );
  //login social account
  ipcMain.on(SOCIAL_ACCOUNT_LOGIN, async (event, data) => {
    const qdata = JSON.parse(data as string) as RequireCookiesMsgbox;
    if (!("id" in qdata)) {
      throw new Error("id not found");
    }
    // if (!("platform" in qdata)) {
    //   throw new Error("platform not found");
    // }
    //const sac = new SocialAccountController()
    try {
      let platform = "";
      const sac = new SocialAccountController();
      const accinfo = await sac.getAccountdetail(qdata.id);
      if (accinfo.status) {
        const socialTypeId = accinfo.data.social_type_id;
        //convert social type id to platform
        const platformItem = SocialPlatformList.find(
          (item) => item.id === socialTypeId
        );
        if (platformItem) {
          platform = platformItem.name;
        }
      } else {
        const comMsgs: CommonDialogMsg = {
          status: false,
          code: qdata.id,
          data: {
            action: "error",
            title: "",
            content: accinfo.msg,
          },
        };
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs));
        return;
      }
      // event.sender.send('socialaccount:login:msg', JSON.stringify({ msg: "test", status: false }))
      await sac
        .showSocialaccountMsg(
          qdata.id,
          platform,
          () => {
            const comMsgs: CommonDialogMsg = {
              status: false,
              code: qdata.id,
              data: {
                action: "uploadfileMsg",
                title: "socialaccount.uploadfilemsg_title",
                content: "socialaccount.uploadfilemsg_content",
              },
            };
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(
              SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
              JSON.stringify(comMsgs)
            );
          },
          () => {
            //ask user to manual login
            const comMsgs: CommonDialogMsg = {
              status: false,
              code: qdata.id,
              data: {
                action: "manualLoginMsg",
                title: "socialaccount.manuallogin_title",
                content: "socialaccount.manuallogin_content",
              },
            };
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(
              SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
              JSON.stringify(comMsgs)
            );
          },
          () => {
            const comMsgs: CommonDialogMsg = {
              status: true,
              code: 0,
              data: {
                action: "saveCookiesSuccess",
                title: "socialaccount.update_cookies_success",
                content: "",
              },
            };
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(
              SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
              JSON.stringify(comMsgs)
            );
          }
        )
        .catch(function (err) {
          if (err instanceof Error) {
            //console log error line
            console.error(err.stack);
            //console.log(error.message)
            const comMsgs: CommonDialogMsg = {
              status: false,
              code: 202412171245163,
              msg: err.message,
            };
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(
              SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
              JSON.stringify(comMsgs)
            );
          }
        });
    } catch (error) {
      if (error instanceof Error) {
        //console.log(error.message)
        const comMsgs: CommonDialogMsg = {
          status: false,
          code: 202412141226150,
          msg: error.message,
        };
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs));
      }
    }
  });
  ipcMain.on(SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE, async (event, data) => {
    const qdata = JSON.parse(data as string) as RequireCookiesParam;
    if (!("id" in qdata)) {
      throw new Error("id not found");
    }
    try {
      const sac = new SocialAccountController();
      await sac.showSocialmediaWin(qdata.id, undefined, () => {
        const comMsgs: CommonDialogMsg = {
          status: true,
          code: 0,
          data: {
            action: "saveCookiesSuccess",
            title: "socialaccount.update_cookies_success",
            content: "",
          },
        };
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs));
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.stack);
        //console.log(error.message)
        const comMsgs: CommonDialogMsg = {
          status: false,
          code: 202412171122188,
          data: {
            action: "error",
            title: "",
            content: error.message,
          },
        };
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs));
      }
    }
  });
  registerValidatedHandler(
    SOCIALACCOUNTSAVE,
    socialAccountSaveInputSchema,
    async (input) => {
      const socialaccount = new SocialAccountController();
      return socialaccount.saveSocialAccount(
        input as unknown as SocialAccountDetailData
      );
    }
  );

  //delete social account
  registerValidatedHandler(
    SOCIALACCOUNTDELETE,
    socialAccountByIdInputSchema,
    async (input) => {
      const socialaccount = new SocialAccount();
      return socialaccount.deleteAccount(input.id);
    }
  );
  ipcMain.on(SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES, async (event, data) => {
    const qdata = JSON.parse(data as string) as RequireCookiesParam;
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      const cmsg = {
        status: false,
        msg: "id not found",
      } as CommonDialogMsg;
      (
        event as {
          sender: { send: (channel: string, message: string) => void };
        }
      ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(cmsg));
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Netscape Cookies", extensions: ["txt"] }],
    });
    if (canceled) {
      const cmsg = { status: false, msg: "canceled" } as CommonDialogMsg;
      (
        event as {
          sender: { send: (channel: string, message: string) => void };
        }
      ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(cmsg));
    } else {
      if (filePaths) {
        console.log(filePaths[0]);
        fs.access(filePaths[0], fs.constants.W_OK, async (e) => {
          if (e) {
            if (e instanceof Error) {
              const cmsg = { status: false, msg: e.message } as CommonDialogMsg;
              (
                event as {
                  sender: { send: (channel: string, message: string) => void };
                }
              ).sender.send(
                SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
                JSON.stringify(cmsg)
              );
            }
          } else {
            const sac = new SocialAccountController();
            const res = await sac.handleCookiesfile(filePaths[0], qdata.id);
            if (res) {
              const comMsgs: CommonDialogMsg = {
                status: true,
                code: qdata.id,
                data: {
                  action: "handleCookiesfile",
                  title: "socialaccount.handleCookiesfileSuccess",
                  content: "",
                },
              };
              (
                event as {
                  sender: { send: (channel: string, message: string) => void };
                }
              ).sender.send(
                SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
                JSON.stringify(comMsgs)
              );
            } else {
              const comMsgs: CommonDialogMsg = {
                status: false,
                code: qdata.id,
                data: {
                  action: "handleCookiesfile",
                  title: "socialaccount.handleCookiesfileFailure",
                  content: "socialaccount.insertCookiesFailure",
                },
              };
              (
                event as {
                  sender: { send: (channel: string, message: string) => void };
                }
              ).sender.send(
                SOCIAL_ACCOUNT_LOGIN_MESSSAGE,
                JSON.stringify(comMsgs)
              );
            }
          }
        });
      }
      //return { status: true, data: filePaths[0] }
    }
  });
  //remove cookies
  ipcMain.on(SOCIAL_ACCOUNT_CLEAN_COOKIES, async (event, data) => {
    const qdata = JSON.parse(data as string) as RequireCookiesParam;
    if (!("id" in qdata)) {
      //throw new Error("id not found");
      return {
        status: false,
        msg: "id not found",
      };
    }
    const sac = new SocialAccountController();
    sac.cleanCookies(qdata.id);
    const comMsgs: CommonDialogMsg = {
      status: true,
      code: 0,
      data: {
        action: "deleteCookies",
        title: "",
        content: "",
      },
    };
    (
      event as { sender: { send: (channel: string, message: string) => void } }
    ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(comMsgs));
  });
}

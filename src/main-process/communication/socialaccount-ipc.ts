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
  SOCIAL_ACCOUNT_SESSION_METADATA,
} from "@/config/channellist";
import { SocialAccount } from "@/modules/socialaccount";
import { SocialPlatform } from "@/modules/social_platform";
import { SocialAccountController } from "@/controller/socialaccount-controller";
import { AccountSessionService } from "@/modules/AccountSessionService";
import { log } from "@/modules/Logger";
import { CommonDialogMsg } from "@/entityTypes/commonType";
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
import { sessionMetadataInputSchema } from "@/schemas/ipc/browserProfileImport";
import {
  browserImportAvailabilityInputSchema,
  browserImportStartPairingInputSchema,
  browserImportCancelInputSchema,
} from "@/schemas/ipc/browserProfileImport";
import {
  SOCIAL_ACCOUNT_BROWSER_IMPORT_AVAILABILITY,
  SOCIAL_ACCOUNT_BROWSER_IMPORT_START,
  SOCIAL_ACCOUNT_BROWSER_IMPORT_CANCEL,
} from "@/config/channellist";
import { BrowserImportCoordinator } from "@/main-process/browserProfileImport/BrowserImportCoordinator";

/**
 * Run the legacy-plaintext -> ENC1 cookie migration once per process, after the
 * user secret key is available. Non-blocking: failures only log aggregate safe
 * counts. Re-entry is a no-op. Triggered lazily from the session-metadata
 * handler (the first time the UI asks for cookie status).
 */
let cookieMigrationStarted = false;
function scheduleCookieMigrationOnce(): void {
  if (cookieMigrationStarted) {
    return;
  }
  cookieMigrationStarted = true;
  void (async () => {
    try {
      const summary =
        await new AccountSessionService().migrateLegacySnapshots();
      log.info(
        `[cookie-migration] scanned=${summary.scanned} migrated=${summary.migrated} ` +
          `invalid=${summary.invalid} deferred=${summary.deferredKeyUnavailable} ` +
          `failed=${summary.persistenceFailed} alreadyEncrypted=${summary.alreadyEncrypted}`
      );
    } catch (err) {
      log.warn(
        `[cookie-migration] aborted: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
      // Allow a later retry if the attempt itself blew up before counting.
      cookieMigrationStarted = false;
    }
  })();
}

export function registerSocialAccountIpcHandlers(mainWindow: BrowserWindow) {
  // Browser-profile import coordinator (main-process only; feature-flagged).
  const browserImportCoordinator = new BrowserImportCoordinator();
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

  // Renderer-safe session metadata (no cookie values). Also kicks off the
  // one-time background migration of any legacy plaintext rows.
  registerValidatedHandler(
    SOCIAL_ACCOUNT_SESSION_METADATA,
    sessionMetadataInputSchema,
    async (input) => {
      scheduleCookieMigrationOnce();
      const service = new AccountSessionService();
      return service.getMetadata(input.id);
    }
  );

  // Browser-profile import: availability is resolved in the main process
  // (flag + platform manifest). The renderer can only ask; it cannot choose
  // domains, a platform, or a profile path.
  registerValidatedHandler(
    SOCIAL_ACCOUNT_BROWSER_IMPORT_AVAILABILITY,
    browserImportAvailabilityInputSchema,
    async (input) => browserImportCoordinator.availability(input.id)
  );

  registerValidatedHandler(
    SOCIAL_ACCOUNT_BROWSER_IMPORT_START,
    browserImportStartPairingInputSchema,
    async (input) => browserImportCoordinator.startPairing(input.id)
  );

  registerValidatedHandler(
    SOCIAL_ACCOUNT_BROWSER_IMPORT_CANCEL,
    browserImportCancelInputSchema,
    async (input) => ({
      cancelled: await browserImportCoordinator.cancel(input.requestId),
    })
  );

  //login social account
  ipcMain.on(SOCIAL_ACCOUNT_LOGIN, async (event, data) => {
    const qdata = socialAccountByIdInputSchema().parse(
      JSON.parse(data as string)
    );
    // if (!("platform" in qdata)) {
    //   throw new Error("platform not found");
    // }
    //const sac = new SocialAccountController()
    try {
      let platform = "";
      const sac = new SocialAccountController();
      const accinfo = await sac.getAccountdetail(qdata.id);
      const socialTypeId = accinfo.social_type_id;
      //convert social type id to platform
      const platformItem = SocialPlatformList.find(
        (item) => item.id === socialTypeId
      );
      if (platformItem) {
        platform = platformItem.name;
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
    const qdata = socialAccountByIdInputSchema().parse(
      JSON.parse(data as string)
    );
    try {
      const sac = new SocialAccountController();
      await sac.showSocialmediaWin(qdata.id, () => {
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
    let qdata: { id: number };
    try {
      qdata = socialAccountByIdInputSchema().parse(JSON.parse(data as string));
    } catch {
      const cmsg = {
        status: false,
        msg: "id not found",
      } as CommonDialogMsg;
      (
        event as {
          sender: { send: (channel: string, message: string) => void };
        }
      ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(cmsg));
      return;
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Netscape Cookies", extensions: ["txt"] }],
    });
    if (canceled) {
      const cmsg = {
        status: false,
        msg: "canceled",
        data: { action: "uploadCanceled", title: "", content: "socialaccount.upload_cookies_cancel" },
      } as CommonDialogMsg;
      (
        event as {
          sender: { send: (channel: string, message: string) => void };
        }
      ).sender.send(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, JSON.stringify(cmsg));
    } else {
      if (filePaths) {
        console.log(filePaths[0]);
        fs.access(filePaths[0], fs.constants.R_OK, async (e) => {
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
    let qdata: { id: number };
    try {
      qdata = socialAccountByIdInputSchema().parse(JSON.parse(data as string));
    } catch {
      return { status: false, msg: "id not found" };
    }
    const sac = new SocialAccountController();
    await sac.cleanCookies(qdata.id);
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

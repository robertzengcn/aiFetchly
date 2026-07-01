import { ipcMain } from "electron";
import {
  EXTRAMODULECHANNE_LIST,
  EXTRAMODULECHANNE_INSTALL,
  EXTRAMODULECHANNE_UNINSTALL,
  EXTRAMODULECHANNE_MESSAGE,
  EXTRAMODULE_UPGRADE,
  EXTRAMODULE_UPGRAD_MESSAGE,
} from "@/config/channellist";
import { ExtraModuleController } from "@/controller/extramoduleController";
import { CommonResponse, CommonDialogMsg } from "@/entityTypes/commonType";
import { ExtraModule } from "@/entityTypes/extramoduleType";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { itemSearchParamSchema } from "@/schemas/ipc/_shared/pagination";

export function registerExtraModulesIpcHandlers() {
  console.log("extramodules list register");

  // LIST: schema-validated. The other handlers in this file
  // (INSTALL / UNINSTALL / UPGRADE) use ipcMain.on + event.sender.send,
  // which is a different pattern not yet covered by the validated
  // wrapper. They stay as-is until a streaming/event-push wrapper is
  // introduced.
  // Explicit <TInput, TOutput> annotation: zod v3 + preprocess + .default
  // widens the inferred TInput to unknown, so we pin it via z.infer.
  registerValidatedHandler(
    EXTRAMODULECHANNE_LIST,
    itemSearchParamSchema,
    async (input) => {
      const extraModulesCtrl = new ExtraModuleController();
      // Original behavior: default page=0, size=100 when missing.
      // Wrapper wraps this in {status: true, msg: 'ok', data: extra},
      // matching the original CommonResponse<ExtraModule> wire shape.
      return extraModulesCtrl.getExtraModuleList(
        input.page ?? 0,
        input.size ?? 100
      );
    }
  );

  ipcMain.on(EXTRAMODULECHANNE_INSTALL, async (event, data: unknown) => {
    const qdata = JSON.parse(data as string);
    if (!("name" in qdata)) {
      throw new Error("name not found");
    }
    // const extraCtrl = new ExtraModuleController()
    try {
      const extraModulesCtrl = new ExtraModuleController();
      await extraModulesCtrl.installExtraModule(
        qdata.name,
        function () {
          (
            event as {
              sender: { send: (channel: string, message: string) => void };
            }
          ).sender.send(
            EXTRAMODULECHANNE_MESSAGE,
            JSON.stringify({
              status: true,
              msg: "success",
              data: {
                name: qdata.name,
                message: "",
              },
            })
          );
        },
        function (error) {
          if (error.message.length > 0) {
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(
              EXTRAMODULECHANNE_MESSAGE,
              JSON.stringify({
                status: false,
                msg: error.message,
              })
            );
          }
        }
      );
    } catch (error) {
      if (error instanceof Error) {
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(
          EXTRAMODULECHANNE_MESSAGE,
          JSON.stringify({
            status: false,
            msg: error.message,
          })
        );
      }
    }
  });

  ipcMain.on(EXTRAMODULECHANNE_UNINSTALL, async (event, data: unknown) => {
    const qdata = JSON.parse(data as string);
    if (!("name" in qdata)) {
      throw new Error("name not found");
    }
    // const extraCtrl = new ExtraModuleController()
    try {
      const extraModulesCtrl = new ExtraModuleController();
      extraModulesCtrl.removeExtraModule(
        qdata.name,
        function () {
          (
            event as {
              sender: { send: (channel: string, message: string) => void };
            }
          ).sender.send(
            EXTRAMODULECHANNE_MESSAGE,
            JSON.stringify({
              status: true,
              msg: "success",
              data: {
                name: qdata.name,
                message: "",
              },
            })
          );
        },
        function (message) {
          if (message.length > 0) {
            (
              event as {
                sender: { send: (channel: string, message: string) => void };
              }
            ).sender.send(
              EXTRAMODULECHANNE_MESSAGE,
              JSON.stringify({
                status: false,
                msg: "failed",
              })
            );
          }
        }
      );
    } catch (error) {
      if (error instanceof Error) {
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(
          EXTRAMODULECHANNE_MESSAGE,
          JSON.stringify({
            status: false,
            msg: error.message,
          })
        );
      }
    }
  });
  ipcMain.on(EXTRAMODULE_UPGRADE, async (event, data: unknown) => {
    const qdata = JSON.parse(data as string);
    if (!("name" in qdata)) {
      throw new Error("name not found");
    }
    const extraModulesCtrl = new ExtraModuleController();
    await extraModulesCtrl
      .upgradePackage(
        qdata.name,
        () => {
          const msgData: CommonDialogMsg = {
            status: true,
            code: 0,
            msg: "success",
          };
          (
            event as {
              sender: { send: (channel: string, message: string) => void };
            }
          ).sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData));
        },
        (errormsg) => {
          const msgData: CommonDialogMsg = {
            status: false,
            code: 0,
            msg: errormsg,
          };
          (
            event as {
              sender: { send: (channel: string, message: string) => void };
            }
          ).sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData));
        }
      )
      .catch((error) => {
        if (error instanceof Error) {
          const msgData: CommonDialogMsg = {
            status: false,
            code: 0,
            msg: error.message,
          };
          (
            event as {
              sender: { send: (channel: string, message: string) => void };
            }
          ).sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData));
        }
      })
      .then(() => {
        const msgData: CommonDialogMsg = {
          status: true,
          code: 0,
          msg: "success",
        };
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(EXTRAMODULE_UPGRAD_MESSAGE, JSON.stringify(msgData));
      });
  });
}

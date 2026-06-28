import { ipcMain } from 'electron';
import { CHECKALLPROXY, CHECKALLPROXYMESSAGE, REMOVEFAILUREPROXY,REMOVEFAILUREPROXY_MESSAGE} from "@/config/channellist";
import { ProxyParseItem } from '@/entityTypes/proxyType'
import { ProxyController } from '@/controller/proxy-controller'
import { CommonMessage, NumProcessdata } from "@/entityTypes/commonType"
import {IProxyApi} from "@/modules/interface/IProxyApi"
import {ProxyModule} from "@/modules/ProxyModule"
import {PROXYLIST,PROXYDETAIL,PROXYSAVE,PROXYCHECK,PROXYIMPORT,PROXYDELETE} from "@/config/channellist";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  proxyListInputSchema,
  proxyByIdInputSchema,
  proxySaveInputSchema,
  proxyCheckInputSchema,
  proxyImportInputSchema,
} from "@/schemas/ipc/proxy";

export function registeProxyIpcHandlers() {

  // ── ipcMain.on handlers (push model, out of scope for validated wrapper) ──
  ipcMain.on(CHECKALLPROXY, async (event, data: unknown) => {
    const qdata = JSON.parse(data as string) as { timeout?: number; proxyIds?: number[] };
    const proxyCon = new ProxyController()
    await proxyCon.checkAllproxy(function (num, total) {
      const process = Math.round(num / total * 100)
      const messageData: CommonMessage<NumProcessdata> = {
        status: true,
        msg: "success",
        data: {
          process: process
        }
      };
      (event as { sender: { send: (channel: string, message: string) => void } }).sender.send(CHECKALLPROXYMESSAGE, JSON.stringify(messageData))
    }, function () {
      const finmessageData: CommonMessage<NumProcessdata> = {
        status: true,
        msg: "success",
        data: {
          process: 100
        }
      };
      (event as { sender: { send: (channel: string, message: string) => void } }).sender.send(CHECKALLPROXYMESSAGE, JSON.stringify(finmessageData))
    }, qdata.timeout, qdata.proxyIds)
  })

  ipcMain.on(REMOVEFAILUREPROXY, async (event) => {
    const proxyCon = new ProxyController()
    await proxyCon.removeFailureProxy(function(){
      const messageData: CommonMessage<null> = {
        status: true,
        msg: "success",
      };
      (event as { sender: { send: (channel: string, message: string) => void } }).sender.send(REMOVEFAILUREPROXY_MESSAGE, JSON.stringify(messageData))
    })
  })

  // ── Validated handle handlers ───────────────────────────────────────────
  registerValidatedHandler(
    PROXYDETAIL,
    proxyByIdInputSchema,
    async (input) => {
      const proxyModule: IProxyApi = new ProxyModule();
      return proxyModule.getProxyDetail(input.id);
    },
  );

  registerValidatedHandler(
    PROXYSAVE,
    proxySaveInputSchema,
    async (input) => {
      const proxyModule: IProxyApi = new ProxyModule();
      return proxyModule.saveProxy(input as unknown as ProxyParseItem);
    },
  );

  registerValidatedHandler(
    PROXYCHECK,
    proxyCheckInputSchema,
    async (input) => {
      const proxyCon = new ProxyController();
      return proxyCon.checkProxy(input as unknown as ProxyParseItem, input.timeout);
    },
  );

  registerValidatedHandler(
    PROXYIMPORT,
    proxyImportInputSchema,
    async (input) => {
      const proxyModel: IProxyApi = new ProxyModule();
      return proxyModel.importProxy(input as unknown as ProxyParseItem[]);
    },
  );

  registerValidatedHandler(
    PROXYLIST,
    proxyListInputSchema,
    async (input) => {
      const proxyCon = new ProxyController();
      return proxyCon.getProxylist(
        input.page ?? 0,
        input.size ?? 10,
        input.search ?? "",
      );
    },
  );

  registerValidatedHandler(
    PROXYDELETE,
    proxyByIdInputSchema,
    async (input) => {
      const proxyModule: IProxyApi = new ProxyModule();
      return proxyModule.deleteProxy(input.id);
    },
  );
}

import { ipcMain } from 'electron';
import { CHECKALLPROXY, CHECKALLPROXYMESSAGE, REMOVEFAILUREPROXY,REMOVEFAILUREPROXY_MESSAGE} from "@/config/channellist";
//import { ProxyApi } from '@/api/proxyApi'
import { ProxyParseItem } from '@/entityTypes/proxyType'
import { ProxyController } from '@/controller/proxy-controller'
import { CommonMessage, NumProcessdata } from "@/entityTypes/commonType"
import {IProxyApi} from "@/modules/interface/IProxyApi"
import {ProxyModule} from "@/modules/ProxyModule"
import {PROXYLIST,PROXYDETAIL,PROXYSAVE,PROXYCHECK,PROXYIMPORT,PROXYDELETE} from "@/config/channellist"
export function registeProxyIpcHandlers() {

  ipcMain.on(CHECKALLPROXY, async (event, data) => {
    const proxyCon = new ProxyController()
    await proxyCon.checkAllproxy(function (num, total) {
      const process = Math.round(num / total * 100)
      const messageData: CommonMessage<NumProcessdata> = {
        status: true,
        msg: "success",
        data: {
          // num: num,
          // total: total,
          process: process
        }
      }
      event.sender.send(CHECKALLPROXYMESSAGE, JSON.stringify(messageData))
    }, function () {
      const finmessageData: CommonMessage<NumProcessdata> = {
        status: true,
        msg: "success",
        data: {
          // num: num,
          // total: total,
          process: 100
        }
      }
      event.sender.send(CHECKALLPROXYMESSAGE, JSON.stringify(finmessageData))
    })
  })

  ipcMain.handle(PROXYDETAIL, async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      return {
        status: false,
        msg: "id not found",
      };
    }

    const proxyModule:IProxyApi = new ProxyModule()
    const resp = await proxyModule.getProxyDetail(qdata.id).then(function (res) {
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
    })
    return resp
  })
  ipcMain.handle(PROXYSAVE, async (event, data) => {
    const qdata = JSON.parse(data);
    const proxyModule:IProxyApi = new ProxyModule()
    const pres = await proxyModule.saveProxy(qdata).then(function (res) {
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
    })
    return pres
  })
  //check proxy
  ipcMain.handle(PROXYCHECK, async (event, data) => {
    const qdata = JSON.parse(data) as ProxyParseItem;

    const proxyCon = new ProxyController()
    const res = await proxyCon.checkProxy(qdata).catch(function (err) {
      return { status: false, msg: err.message, data: false };
    })
    return res
  })
  //import proxy
  ipcMain.handle(PROXYIMPORT, async (event, data) => {
    const qdata = JSON.parse(data) as Array<ProxyParseItem>;
    const proxyModel:IProxyApi = new ProxyModule()
    const res = await proxyModel.importProxy(qdata).catch(function (err) {
      return { status: false, msg: err.message, data: false };
    })
    return res
  })
  //get proxy list
  ipcMain.handle(PROXYLIST, async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("page" in qdata)) {
      qdata.page = 0;
    }
    if (!("size" in qdata)) {
      qdata.size = 10;
    }
    if (!("search" in qdata)) {
      qdata.search = "";
    }
    const proxyCon = new ProxyController()
    const res = await proxyCon.getProxylist(qdata.page, qdata.size, qdata.search).then(function (res) {
      return res
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
    })
    return res
  })
  ipcMain.handle(PROXYDELETE, async (event, data) => {
    const qdata = JSON.parse(data);
    if (!("id" in qdata)) {
      return {
        status: false,
        msg: "id not found",
      };
    }

    const proxyModule:IProxyApi = new ProxyModule()
    const resp = await proxyModule.deleteProxy(qdata.id).then(function (res) {
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
    })


    return resp
  })
//remove failure proxy
  ipcMain.on(REMOVEFAILUREPROXY, async (event, data) => {
    const proxyCon = new ProxyController()
    //console.log("removeFailureProxy")
    await proxyCon.removeFailureProxy(function(){
      //remove failure proxy
      const messageData: CommonMessage<null> = {
        status: true,
        msg: "success",
        
      }
      event.sender.send(REMOVEFAILUREPROXY_MESSAGE, JSON.stringify(messageData))
    })
  })
}
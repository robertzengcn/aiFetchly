import {windowInvoke,windowSend,windowReceive} from '@/views/utils/apirequest'
import {SearchResult} from "./types"
import {ProxyEntity,ProxyParseItem,ProxyListEntity} from "@/entityTypes/proxyType"
import {CHECKALLPROXY,CHECKALLPROXYMESSAGE,PROXYLIST,PROXYDETAIL,REMOVEFAILUREPROXY,REMOVEFAILUREPROXY_MESSAGE, PROXYDELETE, PROXYSAVE, PROXYCHECK, PROXYIMPORT} from "@/config/channellist";
// import { CommonMessage,NumProcessdata } from "@/entityTypes/commonType"
import {ItemSearchparam} from "@/entityTypes/commonType"
export async function getProxyList(data: ItemSearchparam): Promise<SearchResult<ProxyListEntity>> {
    const resp=await windowInvoke(PROXYLIST,data);
        
    if(!resp){
       throw new Error("unknow error")
    }
    console.log(resp)
    const sr:SearchResult<ProxyListEntity>={
        data:resp.records,
        total:resp.total,
    }
    return sr
    // return resp as Array<Proxy>;
}
export async function deleteProxy(data: number): Promise<any> {
    const resp=await windowInvoke(PROXYDELETE,{id:data});
        
    // if(!resp){ 
    //    throw new Error("unknow error")
    // }

    return resp;
}
//get proxy detail
export async function getProxy(data: number): Promise<ProxyEntity> {
    const resp=await windowInvoke(PROXYDETAIL,{id:data});
    if(!resp){ 
       throw new Error("unknow error")
    }

    return resp;
}
//save proxy
export async function saveProxy(data: ProxyEntity): Promise<any> {
    const resp=await windowInvoke(PROXYSAVE,data);
    if(!resp){ 
       throw new Error("unknow error")
    }
    console.log(resp)
    return resp;
}
//check proxy valid
export async function checkProxy(data: ProxyEntity): Promise<any> {
    const resp=await windowInvoke(PROXYCHECK,data);
    if(!resp){ 
       throw new Error("unknow error")
    }

    return resp;
}
export async function importProxydata(data: Array<ProxyParseItem>): Promise<boolean> {
    const resp=await windowInvoke(PROXYIMPORT,data);
    // if(!resp){ 
    //    throw new Error("unknow error")
    // }

    return resp;
}
//check all proxy
export async function checkAllproxy(): Promise<void> {
    console.log("checkAllproxy")
    await windowSend(CHECKALLPROXY,{});
}
export function receiveProxycheckMsg(cb:(data:string)=>void){
    windowReceive(CHECKALLPROXYMESSAGE,cb)
}
export async function removeFailureproxy(): Promise<void> {
    
    windowSend(REMOVEFAILUREPROXY,{});
}
export function receiveRemoveproxyMsg(cb:(data:string)=>void){
    windowReceive(REMOVEFAILUREPROXY_MESSAGE,cb)
}
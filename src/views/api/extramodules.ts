import {windowInvoke,windowSend,windowReceive} from '@/views/utils/apirequest'
import {EXTRAMODULECHANNE_LIST,EXTRAMODULECHANNE_INSTALL,EXTRAMODULECHANNE_UNINSTALL,EXTRAMODULECHANNE_MESSAGE,EXTRAMODULE_UPGRADE,EXTRAMODULE_UPGRAD_MESSAGE} from "@/config/channellist";
import {ExtraModule} from "@/entityTypes/extramoduleType"
import {ListData,CommonDialogMsg} from "@/entityTypes/commonType"
import { SearchResult } from '@/views/api/types'
export async function getExtramodulelist(data: any):Promise<SearchResult<ExtraModule>>{
     
        const resp=await windowInvoke(EXTRAMODULECHANNE_LIST,data) as ListData<ExtraModule>;
        
        // console.log(resp)
        if(!resp){
           throw new Error("unknow error")
        }

        const resdata:any={
                data:resp.records,
                total:resp.num,
        }
        return resdata;  
}
export async function installExtramodule(packagename:string){
        windowSend(EXTRAMODULECHANNE_INSTALL,{name:packagename})
}
export function receiveInExtramoduleLog(cb:(data:any)=>void){
        windowReceive(EXTRAMODULECHANNE_MESSAGE,cb)
}
export function removeExtramodule(packagename:string){
        windowSend(EXTRAMODULECHANNE_UNINSTALL,{name:packagename})
}
export function upgradeExtramodule(packagename:string){
        windowSend(EXTRAMODULE_UPGRADE,{name:packagename})
}
export function upgradeExtramoduleMsg(cb:(data:string)=>void){
        windowReceive(EXTRAMODULE_UPGRAD_MESSAGE,cb)
}
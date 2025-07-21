import {windowInvoke} from '@/views/utils/apirequest'
import {SYSTEM_SETTING_LIST,SYSTEM_SETTING_UPDATE} from "@/config/channellist";
import {SystemSettingDisplay,SystemSettingGroupDisplay,OptionSettingDisplay,SetttingUpdate} from "@/entityTypes/systemsettingType";

export async function getSystemSettinglist():Promise<Array<SystemSettingGroupDisplay>>{
    const resp=await windowInvoke(SYSTEM_SETTING_LIST,{});
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    return resp; 

}
export async function updateSystemSetting(id:number, value:string|null):Promise<boolean>{
    const setttingUpdate:SetttingUpdate={id:id,value:value}
    const resp=await windowInvoke(SYSTEM_SETTING_UPDATE,setttingUpdate);
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    return resp; 
}
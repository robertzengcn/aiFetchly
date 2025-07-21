import {SearchResult} from './types'
import {ItemSearchparam} from "@/entityTypes/commonType"
import {windowInvoke,windowSend,windowReceive} from '@/views/utils/apirequest'
import {SocialAccountDetailData,SoASuccessEntity,SoADeleteResp,SocialLoginParam,SocialAccountListData} from "@/entityTypes/socialaccount-type"
import {SOCIALACCOUNTlIST,SOCIAL_ACCOUNT_LOGIN,SOCIALACCOUNTSAVE,SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES,SOCIAL_ACCOUNT_CLEAN_COOKIES,SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE} from "@/config/channellist"
import {RequireCookiesParam,RequireCookiesMsgbox} from "@/entityTypes/cookiesType"


export async function getSocialAccountlist(data: ItemSearchparam):Promise<SearchResult<SocialAccountListData>>{
    const resp=await windowInvoke(SOCIALACCOUNTlIST,data);
        
        if(!resp){
           throw new Error("unknow error")
        }

        const resdata:SearchResult<SocialAccountListData>={
                data:resp.records,
                total:resp.total,
        }
        return resdata;
}
//get social account detail
export async function getSocialaccountinfo(id: number):Promise<SocialAccountDetailData>{
        const resp=await windowInvoke('socialaccount:detail',{id:id});
        console.log(resp)
        if(!resp){
           throw new Error("unknow error")
        }
   
        return resp;
}
//save social account
export async function saveSocialAccount(soc:SocialAccountDetailData):Promise<SoASuccessEntity>{
        const resp=await windowInvoke(SOCIALACCOUNTSAVE,soc);
        return resp;
}
//delete social account
export async function deleteSocialAccount(id:number):Promise<SoADeleteResp>{
        const resp=await windowInvoke('socialaccount:delete',{id:id});
        return resp;
}
export function socialaccountLogin(data:RequireCookiesMsgbox){
        windowSend(SOCIAL_ACCOUNT_LOGIN,data);    
}
export function receiveAccountLoginevent(channel:string,cb:(data:any)=>void){
        windowReceive(channel,cb)
 }
 export async function requireCookiesselecttab(data:RequireCookiesParam){
        await windowSend(SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES,data)   
 }
 export async function cleanCookies(data:RequireCookiesParam){
        await windowSend(SOCIAL_ACCOUNT_CLEAN_COOKIES,data)
 }
 export async function showPlatformpage(data:RequireCookiesParam){
        await windowSend(SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE,data)
 }
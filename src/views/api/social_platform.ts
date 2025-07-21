import {windowInvoke} from '@/views/utils/apirequest'
// import {ItemSearchparam} from "./types"
import {SocialPlatformEntity} from "@/entityTypes/social_platform-type"
import {SOCIALPLATFORM_LIST} from "@/config/channellist"
import {ItemSearchparam} from "@/entityTypes/commonType"
export async function getSocialPlatformlist(data: ItemSearchparam):Promise<Array<SocialPlatformEntity>>{
    const resp=await windowInvoke(SOCIALPLATFORM_LIST,data);
        
        if(!resp){
           throw new Error("unknow error")
        }

        return resp as Array<SocialPlatformEntity>;
}
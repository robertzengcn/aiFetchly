
import {SYSTEM_MESSAGE} from "@/config/channellist";
import {windowReceive} from '@/views/utils/apirequest'
import {CommonDialogMsg} from "@/entityTypes/commonType";

export function receiveSystemMessage(cb:(data:CommonDialogMsg)=>void){
    windowReceive(SYSTEM_MESSAGE,cb)
}
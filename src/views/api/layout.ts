
import {SYSTEM_MESSAGE} from "@/config/channellist";
import {windowReceive} from '@/views/utils/apirequest'
import {CommonDialogMsg} from "@/entityTypes/commonType";

export function receiveSystemMessage(cb:(data:CommonDialogMsg)=>void){
    windowReceive(SYSTEM_MESSAGE,(data: string) => {
        try {
            const decodedData: CommonDialogMsg = JSON.parse(data);
            cb(decodedData);
        } catch (error) {
            console.error('Failed to parse system message JSON:', error);
            console.error('Raw data:', data);
        }
    })
}
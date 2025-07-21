import {EmailscFormdata,EmailResultDisplay,EmailsearchtaskResultquery} from '@/entityTypes/emailextraction-type'
import { windowInvoke,windowReceive,windowSend } from '@/views/utils/apirequest'
import {EMAILEXTRACTIONAPI, EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD} from '@/config/channellist'
import { SearchResult} from '@/views/api/types'
import {ItemSearchparam} from "@/entityTypes/commonType"
import {LISTEMAILSEARCHTASK,EMAILSEARCHTASKRESULT} from "@/config/channellist";
// import { CommonResponse } from "@/entityTypes/commonType"
import {EmailsearchTaskEntityDisplay} from '@/entityTypes/emailextraction-type'

export async function submitScraper(data: EmailscFormdata) {
    
    await windowSend(EMAILEXTRACTIONAPI, data) 
    
    // return resp 
}
//list email search task
export async function listEmailSearchtasks(data: ItemSearchparam): Promise<SearchResult<EmailsearchTaskEntityDisplay>> {
    const resp = await windowInvoke(LISTEMAILSEARCHTASK, data);
    //console.log(resp)
    if (!resp) {
        throw new Error("unknow error")
    }
    const resdata: SearchResult<EmailsearchTaskEntityDisplay> = {
        data: resp.records,
        total: resp.num,
    }
    return resdata;
}
//get email search task detail
export async function getEmailtaskdetail(data: EmailsearchtaskResultquery){
    const resp = await windowInvoke(EMAILSEARCHTASKRESULT, data);
    if (!resp) {
        throw new Error("unknow error")
    }
    // EmailResultDisplay
    const resdata: SearchResult<EmailResultDisplay> = {
        data: resp.records,
        total: resp.num,
    }
    return resdata;

}

export function receiveSearchEmailevent(channel:string,cb:(data:any)=>void){
   
    windowReceive(channel,cb)
}

export async function downloadErrorLog(id: number): Promise<string> {
    try {
        const querydata = { id: id }
        const res = await windowInvoke(EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD, querydata)
        console.log(res)
        return res
        
    } catch (error) {
        console.error('Error downloading log:', error)
        throw error
    }
}
"use strict";

import {windowSend,windowReceive,windowInvoke} from '@/views/utils/apirequest'
import {EmailMarketingsubdata} from '@/entityTypes/emailmarketingType'
import {BUCKEMAILSEND,BUCKEMAILTASKLIST,BUCKEMAILTASKSENDLOG} from '@/config/channellist'
import {SearchResult} from '@/views/api/types'
import {ItemSearchparam} from "@/entityTypes/commonType"
import {BuckEmailListType,BuckEmailTasklogQueryType,EmailMarketingSendLogListDisplay} from "@/entityTypes/buckemailType"
import { EmailMarketingSendLogEntity} from "@/model/emailMarketingSendLogdb"

export async function buckEmailsend(data: EmailMarketingsubdata) {
    
    windowSend(BUCKEMAILSEND, data) 
    
    // return resp 
}
export function receiveBuckEmailevent(channel:string,cb:(data:any)=>void){
   
    windowReceive(channel,cb)
}

//get email service list
export async function getBuckEmailSendtaskList(params: ItemSearchparam): Promise<SearchResult<BuckEmailListType>> {
    const resp= await windowInvoke(BUCKEMAILTASKLIST, params);
    
    if(!resp){
       throw new Error("unknow error")
    }

    const resdata:SearchResult<BuckEmailListType>={
            data:resp.records,
            total:resp.num,
    }
    return resdata;  
}
//get buck email send log
export async function getBuckEmailSendLog(params: BuckEmailTasklogQueryType): Promise<SearchResult<EmailMarketingSendLogListDisplay>> {
    const resp= await windowInvoke(BUCKEMAILTASKSENDLOG, params);
    
    if(!resp){
       throw new Error("unknow error")
    }

    const resdata:SearchResult<EmailMarketingSendLogListDisplay>={
            data:resp.records,
            total:resp.num,
    }
    return resdata;  
}
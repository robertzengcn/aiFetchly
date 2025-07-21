import {SearchResult} from './types'
import {windowInvoke} from '@/views/utils/apirequest'
import {campaignEntity} from "@/entityTypes/campaign-type"
import {ItemSearchparam} from "@/entityTypes/commonType"
export async function getCampaignlist(data: ItemSearchparam):Promise<SearchResult<campaignEntity>>{
     
        const resp=await windowInvoke('campaign:list',data);
        console.log(resp)
        if(!resp){
           throw new Error("unknow error")
        }
        // if(!resp.status){
        //   throw new Error(resp.msg)
        // }

        const resdata:SearchResult<campaignEntity>={
                data:resp.records,
                total:resp.num,
        }
        return resdata;  
}
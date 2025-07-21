import {windowInvoke} from '@/views/utils/apirequest'
import {SearchResult} from '@/views/api/types'
import {EMAILMARKETINGFILTERLIST,EMAILMARKETFILTERDETAIL,EMAILMARKETFILTERUPDATE,EMAILFILTERDELETE} from "@/config/channellist";
import {ItemSearchparam,CommonIdrequest} from "@/entityTypes/commonType"
import {EmailFilterdata} from "@/entityTypes/emailmarketingType"

export async function getEmailfilterlist(data: ItemSearchparam):Promise<SearchResult<EmailFilterdata>>{
     
    const resp=await windowInvoke(EMAILMARKETINGFILTERLIST,data);
    
   console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }

    const resdata:SearchResult<EmailFilterdata>={
            data:resp.records,
            total:resp.num,
    }
    return resdata;  
}
export async function getEmailfilterbyid(data: CommonIdrequest<number>):Promise<EmailFilterdata>{
    const resp=await windowInvoke(EMAILMARKETFILTERDETAIL,data);
    if(!resp){
       throw new Error("unknow error")
    }
    return resp;  
} 
//update email filter
export async function updateEmailfilter(data: EmailFilterdata):Promise<CommonIdrequest<number>>{
    const resp=await windowInvoke(EMAILMARKETFILTERUPDATE,data);
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    return resp;  
} 
export async function deleteEmailFilter(id: number): Promise<CommonIdrequest<number>> {
    const params: CommonIdrequest<number>  = { id:id };
    return windowInvoke(EMAILFILTERDELETE, params);
}
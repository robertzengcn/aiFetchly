import {windowInvoke} from '@/views/utils/apirequest'
import {EMAILMARKETINGTEMPLIST,EMAILMARKETINGTEMPDETAIL,EMAILMARKETINGTEMPREMOVE,
    EMAILMARKETINGTEMPPREVIEW,EMAILMARKETINGTEMPUPDATE} from "@/config/channellist";
import {SearchResult} from '@/views/api/types'
import {EmailTemplateRespdata,EmailTemplatePreviewdata} from "@/entityTypes/emailmarketingType"
import {ItemSearchparam,CommonIdrequest,ListData} from "@/entityTypes/commonType"
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity"
export async function getEmailtemplatelist(data: ItemSearchparam):Promise<SearchResult<EmailTemplateRespdata>>{
     
    const resp=await windowInvoke(EMAILMARKETINGTEMPLIST,data) as ListData<EmailTemplateRespdata>;
    
   
    if(!resp){
       throw new Error("unknow error")
    }

    const resdata:SearchResult<EmailTemplateRespdata>={
            data:resp.records,
            total:resp.num,
    }
    return resdata;  
}
//get email template by id
export async function getEmailtemplatebyid(id:string):Promise<EmailTemplateRespdata>{
    const resp=await windowInvoke(EMAILMARKETINGTEMPDETAIL,{id:id}) as EmailTemplateRespdata;
    if(!resp){
        throw new Error("unknow error")
    }
    return resp;
}
//update template
export async function updateEmailtemplate(data:EmailTemplateRespdata):Promise<CommonIdrequest<number>>{
    const resp=await windowInvoke(EMAILMARKETINGTEMPUPDATE,data);
    if(!resp){
        throw new Error("unknow error")
    }
    return resp;
}
//remove email marketing
export async function removeEmailtemplate(id:number):Promise<CommonIdrequest<number>>{
    const resp=await windowInvoke(EMAILMARKETINGTEMPREMOVE,{id:id});
    if(!resp){
        throw new Error("unknow error")
    }
    return resp;
}
//submit email preview data
export async function submitEmailPreview(data:EmailTemplatePreviewdata):Promise<number>{
    const resp=await windowInvoke(EMAILMARKETINGTEMPPREVIEW,data);
    if(!resp){
        throw new Error("unknow error")
    }
    return resp;
}
import {windowInvoke} from '@/views/utils/apirequest'
import {EMAILMARKETINGTEMPLIST,EMAILMARKETINGTEMPDETAIL,EMAILMARKETINGTEMPREMOVE,
    EMAILMARKETINGTEMPPREVIEW,EMAILMARKETINGTEMPUPDATE} from "@/config/channellist";
import {SearchResult} from '@/views/api/types'
import {EmailTemplateRespdata,EmailTemplatePreviewdata, AIEmailTemplateRequest, AIEmailTemplateResponse} from "@/entityTypes/emailmarketingType"
import {ItemSearchparam,CommonIdrequest,ListData} from "@/entityTypes/commonType"
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity"
import {
    AI_EMAIL_TEMPLATE_GENERATE_STREAM,
    AI_EMAIL_TEMPLATE_GENERATE_CHUNK,
    AI_EMAIL_TEMPLATE_GENERATE_COMPLETE,
    AI_EMAIL_TEMPLATE_ERROR
} from '@/config/channellist';

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

/**
 * Generate an email template using AI
 * 
 * @param data - AI email template generation request
 * @param onChunk - Optional callback for streaming chunk events
 * @returns Promise<AIEmailTemplateResponse> - Generated template with title, content, and variables
 */
export async function generateAIEmailTemplate(
    data: AIEmailTemplateRequest,
    onChunk?: (chunkData: { type: string; content: string; fullContent: string }) => void
): Promise<AIEmailTemplateResponse> {
    return new Promise((resolve, reject) => {
        // Event handlers
        const handleChunk = (_event: unknown, chunkData: { type: string; content: string; fullContent: string }): void => {
            if (onChunk) {
                onChunk(chunkData);
            }
        };

        const handleComplete = (_event: unknown, response: { type: string; status: boolean; data: AIEmailTemplateResponse }): void => {
            if (response.status && response.data) {
                resolve(response.data);
            } else {
                reject(new Error('Generation failed'));
            }
            // Clean up listeners
            cleanup();
        };

        const handleError = (_event: unknown, error: { type: string; status: boolean; msg: string }): void => {
            reject(new Error(error.msg || 'Generation failed'));
            // Clean up listeners
            cleanup();
        };

        const cleanup = (): void => {
            if (window.api) {
                window.api.removeListener(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, handleChunk);
                window.api.removeListener(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, handleComplete);
                window.api.removeListener(AI_EMAIL_TEMPLATE_ERROR, handleError);
            }
        };

        // Register event listeners
        if (window.api) {
            window.api.receive(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, handleChunk);
            window.api.receive(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, handleComplete);
            window.api.receive(AI_EMAIL_TEMPLATE_ERROR, handleError);
        }

        // Send generation request
        try {
            window.api.send(AI_EMAIL_TEMPLATE_GENERATE_STREAM, data);
        } catch (err) {
            cleanup();
            reject(err);
        }
    });
}

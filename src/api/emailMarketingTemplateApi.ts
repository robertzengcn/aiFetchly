"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
import { EmailsTemplagedata, EmailTemplateRespdata } from "@/entityTypes/emailmarketingType"
import { CommonApiresp,ListData,SortBy,CommonIdrequest } from "@/entityTypes/commonType"

// import {CommonIdrequest} from "@/entityTypes/commonType"
export class EmailMarketingTemplateApi {
    private _httpClient: HttpClient;

    constructor() {
        this._httpClient = new HttpClient();

    }

    async createTemplate(templateData: EmailsTemplagedata): Promise<CommonApiresp<CommonIdrequest<number>>> {
        const data = new FormData();
        if (templateData.TplTitle) {
            data.append("email_title", templateData.TplTitle);
        }
        if (templateData.TplContent) {
            data.append("email_content", templateData.TplContent);
        }

        return this._httpClient.post(`/api/emailtpl/create`, data);
    }

    async readTemplate(templateId: string): Promise<CommonApiresp<EmailTemplateRespdata>> {
        // const token = Token.getToken();
        return this._httpClient.get(`/api/emailtpl/${templateId}`);
    }

    async updateTemplate(templateId: string, param: EmailsTemplagedata): Promise<CommonApiresp<CommonIdrequest<number>>> {

        const data = new FormData();
        if(param.TplTitle){
            data.append("email_title", param.TplTitle);
        }
        if(param.TplContent){
            data.append("email_content", param.TplTitle);
        }
        
        return this._httpClient.put(`/api/emailtpl/${templateId}`, data);
    }

    async deleteTemplate(templateId: string): Promise<CommonApiresp<CommonIdrequest<number>>> {

        return this._httpClient.delete(`/api/emailtpl/${templateId}`);
    }
    //list email tpl
    async listTemplate(page: number, size: number, search?: string,sortBy?:SortBy): Promise<CommonApiresp<ListData<EmailTemplateRespdata>>> {
       let resutsort=''
        if(sortBy){
            sortBy.key=sortBy.key.toLowerCase()
            const allowsortby=['tpl_id','tpl_record']
            if(allowsortby.includes(sortBy.key)){
                resutsort=sortBy.key  
            if(sortBy.order){
                if(sortBy.order.toLowerCase()=='desc'){
                    resutsort='-'+resutsort
                }
            }
        }
        }
        return this._httpClient.get(`/api/emailtpl/list?page=${page}&size=${size}&search=${search}&orderby=${resutsort}`);
    }
}
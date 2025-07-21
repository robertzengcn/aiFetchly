"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
import { EmailFilterdata} from "@/entityTypes/emailmarketingType"
import { CommonApiresp,CommonResponse,SortBy,CommonIdrequest } from "@/entityTypes/commonType"
//import {convertJsonToObject} from "@/modules/lib/function"

export class EmailMarketingFilterApi {
    private _httpClient: HttpClient;

    constructor() {
        this._httpClient = new HttpClient();

    }
    async createEmailFilter(data: EmailFilterdata): Promise<CommonApiresp<CommonIdrequest<number>>> {
        return await this._httpClient.put('/api/emailfilter/create', data);
        // return res;
    }

    async getEmailFilterById(id: string): Promise<CommonApiresp<EmailFilterdata>> {
        return await this._httpClient.get(`/api/emailfilter/${id}`);
        // return convertJsonToObject<CommonApiresp<EmailFilterdata>>(res);
    }

    async updateEmailFilter(id: string, data: EmailFilterdata): Promise<CommonApiresp<CommonIdrequest<number>>> {
        return await this._httpClient.postJson(`/api/emailfilter/${id}`, data);
        // return convertJsonToObject<CommonApiresp<CommonIdrequest<number>>>(res);
       
    }
    //delete email filter
    async deleteEmailFilter(id: string): Promise<CommonApiresp<CommonIdrequest<number>>> {
        return await this._httpClient.delete(`/api/emailfilter/${id}`);
        // return convertJsonToObject<CommonApiresp<CommonIdrequest<number>>>(res);
    }
    //list email fileter
    async listEmailFilters( page: number, size: number,search?: string, sortBy?: SortBy): Promise<CommonResponse<EmailFilterdata>> {
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
        const res=await this._httpClient.get(`/api/emailfilter/list?page=${page}&size=${size}&search=${search}&orderby=${resutsort}`);
        console.log(res)
        // return res as CommonResponse<EmailFilterdata>; 
        return res;
    }

}
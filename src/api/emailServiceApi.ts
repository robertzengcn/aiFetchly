"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
import { EmailServiceEntitydata,EmailServiceListdata} from "@/entityTypes/emailmarketingType"
import { CommonApiresp,SortBy,CommonIdrequest,ListData } from "@/entityTypes/commonType"

export class EmailServiceApi {
    private _httpClient: HttpClient;

    constructor() {
        this._httpClient = new HttpClient();

    }
    //create and update email service
    async createuEmailService(param: EmailServiceEntitydata): Promise<CommonApiresp<CommonIdrequest<number>>> {
        const data = new FormData();
        let url='/api/emailservice/create'
        if(param.id){
            url='/api/emailservice/update/'+param.id.toString()
            data.append("id", param.id.toString());
        }
        if(param.from){
            data.append("service_from", param.from);
        }
        if(param.password){
            data.append("service_pass", param.password);
        }
        if(param.host){
            data.append("service_host", param.host);
        }
        if(param.port){
            data.append("service_port", param.port);
        }
        if(param.name){
            data.append("service_name", param.name);
        }
        if(param.ssl){
            data.append("service_ssl", param.ssl.toString());
        }
        console.log(data)
        return this._httpClient.post(url, data);
    }
    //get email list service
    async getEmailServiceList(page: number, size: number, search?: string,sortBy?:SortBy): Promise<CommonApiresp<ListData<EmailServiceListdata>>> {
        let resutsort=''
        if(sortBy){
            sortBy.key=sortBy.key.toLowerCase()
            const allowsortby=['id','create_time']
            if(allowsortby.includes(sortBy.key)){
                resutsort=sortBy.key  
            if(sortBy.order){
                if(sortBy.order.toLowerCase()=='desc'){
                    resutsort='-'+resutsort
                }
            }
        }
        }
        return this._httpClient.get(`/api/emailservice/list?page=${page}&size=${size}&search=${search}&orderby=${resutsort}`);
    }
//get email service by id
    async getEmailServiceById(id: string): Promise<CommonApiresp<EmailServiceEntitydata>> {
        return this._httpClient.get(`/api/emailservice/${id}`);
    }

    
//delete email service
    async deleteEmailService(id: string): Promise<CommonApiresp<CommonIdrequest<number>>> {
        return this._httpClient.delete(`/api/emailservice/delete/${id}`);
    }
}
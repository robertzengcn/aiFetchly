// const url = require("url");
import url from "url"
//import request from "@/modules/lib/request"
// import {queryParams} from "@/modules/lib/function"
import { HttpClient } from "@/modules/lib/httpclient"
import {campaignEntity} from "@/entityTypes/campaign-type"
import {CommonResponse} from "@/entityTypes/commonType"
export class Campaign {
    private _httpClient: HttpClient
    //construct
    constructor() {
        this._httpClient=new HttpClient()
    }
    /**
    * get campaign from remote servive
    */
    async getCampaignlist(queryParams): Promise<CommonResponse<campaignEntity> | null> {
        const params = new url.URLSearchParams(queryParams);
        const paramstring=params.toString();
        const finalurl='/api/campaign?'+paramstring;
        
        const campignlistres=await this._httpClient.get(finalurl)
        if (!campignlistres) {
            throw new Error("remote return empty");
        }
        // console.log("campaign list is following")
        // console.log(campignlistres.data)
        const resp: CommonResponse<campaignEntity> = {
            status: campignlistres.status,
            msg: campignlistres.msg,
            data: campignlistres.data,
        }
        return resp
    }
}
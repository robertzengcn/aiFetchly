"use strict";
export {};
import { HttpClient } from "@/modules/lib/httpclient"
import {KeywordResponse} from "@/entityTypes/keywords-type"
export class Keyword {
    private _httpClient: HttpClient
    //construct               
    constructor() {
        this._httpClient=new HttpClient()
    }
    /**
     * get keywords by tag
     */
    async getKeywordsbytag(tag:Array<string>): Promise<Array<string>|undefined> {
        let formData = new FormData();
        formData.append("tags[]", String(tag));
        const kewres = await this._httpClient.post(
            '/api/getkeywordtag',
            formData,
         ).catch(function (error) {
             throw new Error(error.message);
             // console.error(error);
         }).then(function (res) {
            return res as KeywordResponse;
         });
        //  kewres as KeywordResponse 
            if (!kewres) {
                throw new Error("remote return social task type is null");
            }
        return kewres.data

    }

}
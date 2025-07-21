'use strict';
import { HttpClient } from "@/modules/lib/httpclient"
import {SocialPlatformResponse} from "@/entityTypes/social_platform-type"
export class SocialPlatform {
    private _httpClient: HttpClient
    constructor() {
        this._httpClient = new HttpClient()
    }
    //get soical platform list from remote
    public async listsocialplatform(page: number, size: number): Promise<SocialPlatformResponse> {
        const searchParams: Record<string, any> = new URLSearchParams();
        searchParams.append("page", page);
        searchParams.append("size", size);
        const paramstring = searchParams.toString();
        const finalurl = '/api/socialplatform/list?' + paramstring;
        const sociallistres = await this._httpClient.get(finalurl)
        if (!sociallistres) {
            throw new Error("remote return empty");
        }
        return sociallistres
    }
}
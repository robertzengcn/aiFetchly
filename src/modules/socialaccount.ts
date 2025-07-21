"use strict";
//import { HttpClient } from "@/modules/lib/httpclient";
import {
  SocialAccountResponse,
  SocialAccountDetailResponse,
  SocialAccountDetailData,
  SavesocialaccountResp,
} from "@/entityTypes/socialaccount-type";
import {SocialAccountApi} from "@/api/socialAccountApi"
// import url from "url"
// import {PageSearch} from "@/entityTypes/common-type"
// import { URLSearchParams } from "url";
// import { AccountCookiesdb } from "@/model/accountCookiesdb";
import {AccountCookiesModule} from "@/modules/accountCookiesModule"

export class SocialAccount {
  // private _httpClient: HttpClient;
  // private dbpath:string
  private socialAccountApi: SocialAccountApi
  private accountCookiesModule:AccountCookiesModule
  constructor() {
    this.socialAccountApi = new SocialAccountApi();
    this.accountCookiesModule=new AccountCookiesModule()
  }
  //get social account list from remote
  public async getSocialaccountlist(
    page: number,
    size: number,
    search: string,
    platform?:number,
  ): Promise<SocialAccountResponse> {
    // const searchParams: Record<string, any> = new URLSearchParams();
    // searchParams.append("page", page);
    // searchParams.append("size", size);

    // if (search.length > 0) {
    //   searchParams.append("search", search);
    // }
    // if(platform){
    //   searchParams.append("platform", platform);  
    // }
    // // const params = new URLSearchParams({page: page, pagesize: "100"}).toString();
    // const paramstring = searchParams.toString();
    // // const finalurl='/api/campaign?'+paramstring;
    // const finalurl = "/api/socialaccount/list?" + paramstring;
    // console.log(finalurl)
    // const sociallistres = await this._httpClient.get(finalurl) as SocialAccountResponse;
    // if (!sociallistres) {
    //   throw new Error("remote return empty");
    // }
    const sociallistres =await this.socialAccountApi.getSocialaccountlist(page,size,search,platform)

    // const resp: SocialAccountResponse = {
    //   status: sociallistres.status,
    //   msg: sociallistres.msg,
    //   data: sociallistres.data,
    // };

    if (sociallistres.data.records && sociallistres.data.records.length > 0) {
      // const tokenService=new Token()
      // const dbpath=await tokenService.getValue(USERSDBPATH)
      // if(!dbpath){
      //     throw new Error("user path not exist")
      // }
      // const accDb = new AccountCookiesdb(this.dbpath)

      //loop social list data, add cookies
      for (const social of sociallistres.data.records) {
        social.cookies = false
        const cookisEntity = await this.accountCookiesModule.getAccountCookies(social.id)
        if (cookisEntity && cookisEntity.cookies) {
          const cEntity = JSON.parse(cookisEntity.cookies)
          if (cEntity && cEntity.length > 0) {
            social.cookies = true
          }
        }
      }
    }
    return sociallistres;
  }
  //get social account detail
  public async getAccountdetail(
    id: number
  ): Promise<SocialAccountDetailResponse> {
    // 
    const socialdetailres=await this.socialAccountApi.getAccountdetail(id)

    return socialdetailres as SocialAccountDetailResponse;
  }
  //save social account
  public async saveSocialAccount(
    soc: SocialAccountDetailData
  ): Promise<SavesocialaccountResp> {
    // const FormData = require('form-data');
    // let data = new FormData();
    // if (soc.id) {
    //   data.append("id", soc.id.toString());
    // }
    // if (soc.social_type_id) {
    //   data.append("social_type_id", soc.social_type_id.toString());
    // }
    // data.append("user", soc.user);
    // if (soc.pass) {
    //   data.append("pass", soc.pass);
    // }
    // data.append("status", soc.status.toString());
    // data.append("name", soc.name);
    // data.append("phone", soc.phone);
    // data.append("email", soc.email);
    // if (soc.proxy) {
    //   for (const proxy of soc.proxy) {
    //     if (proxy.id) {
    //       data.append("proxy[]", proxy.id.toString());
    //       console.log("proxy id is " + proxy.id.toString())
    //     }
    //   }
    // }

    // const resp = await this._httpClient.post("/api/socialaccount", data);
    const resp=await this.socialAccountApi.saveSocialAccount(soc)
    return resp as SavesocialaccountResp;
  }

  //delete social account
  public async deleteAccount(id) {
    // const searchParams: Record<string, any> = new URLSearchParams();
    // searchParams.append("id", id);
    // const paramstring = searchParams.toString();
    // const finalurl = "/api/socialaccount?" + paramstring;
    // const socialdetailres = await this._httpClient.delete(finalurl);
    const socialdetailres =await this.socialAccountApi.deleteAccount(id)
    if (!socialdetailres) {
      throw new Error("remote return empty");
    }
    return socialdetailres;

  }
  public convertPlatform(name:string):number{
    //convert name to lower case
    const lowerCaseName = name.toLowerCase();
    switch (lowerCaseName) {
      case "facebook":
        return 1;
      case "youtube":
        return 2;
      case "google":  
      case "google.com":
        return 4;
      case "bilibili":
        return 3;  
      default:
        throw new Error(`Unknown platform name: ${name}`);
    }
  }
}

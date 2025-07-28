"use strict";
import {
  SocialAccountResponse,
  SocialAccountDetailResponse,
  SocialAccountDetailData,
  SavesocialaccountResp,
} from "@/entityTypes/socialaccount-type";
import { SocialAccountModule } from "@/modules/socialAccountModule";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";

export class SocialAccount {
  private socialAccountModule: SocialAccountModule;
  private accountCookiesModule: AccountCookiesModule;
  
  constructor() {
    this.socialAccountModule = new SocialAccountModule();
    this.accountCookiesModule = new AccountCookiesModule();
  }
  //get social account list from local database
  public async getSocialaccountlist(
    page: number,
    size: number,
    search: string,
    platform?:number,
  ): Promise<SocialAccountResponse> {
    return await this.socialAccountModule.getSocialAccountList(page, size, search, platform);
  }
  //get social account detail from local database
  public async getAccountdetail(
    id: number
  ): Promise<SocialAccountDetailResponse> {
    return await this.socialAccountModule.getAccountDetail(id);
  }
  //save social account to local database
  public async saveSocialAccount(
    soc: SocialAccountDetailData
  ): Promise<SavesocialaccountResp> {
    return await this.socialAccountModule.saveSocialAccount(soc);
  }

  //delete social account from local database
  public async deleteAccount(id: number): Promise<{ status: boolean; msg: string }> {
    return await this.socialAccountModule.deleteAccount(id);
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

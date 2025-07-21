// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
import { AccountCookiesModel } from "@/model/AccountCookies.model"
import { AccountCookiesEntity } from "@/entity/AccountCookies.entity"
import { BaseModule } from "@/modules/baseModule";

export class AccountCookiesModule extends BaseModule {
    // private dbpath: string
    private accountCookiesModel: AccountCookiesModel

    constructor() {
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        // this.dbpath = dbpath
        super()
        this.accountCookiesModel = new AccountCookiesModel(this.dbpath);
    }

    public async getAccountCookies(
        accountid: number
    ): Promise<AccountCookiesEntity | null> {
        return this.accountCookiesModel.getAccountCookies(accountid);
    }

    public async saveAccountCookies(
        accountcookies: AccountCookiesEntity
    ): Promise<number> {
        return await this.accountCookiesModel.saveAccountCookies(accountcookies);
    }

    //generate partition_path for cookies
    public genPartitionPath(): string {
        return "persist:path/" + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    }

    public async deleteCookies(accountid: number): Promise<number> {
        return await this.accountCookiesModel.deleteAccountCookies(accountid);
    }
}
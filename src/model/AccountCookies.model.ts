import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AccountCookiesEntity } from "@/entity/AccountCookies.entity";
import { getRecorddatetime } from "@/modules/lib/function";

export class AccountCookiesModel extends BaseDb {
    private repository: Repository<AccountCookiesEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(AccountCookiesEntity);
    }

    /**
     * Save account cookies
     */
    async saveAccountCookies(accountcookies: AccountCookiesEntity): Promise<number> {
        if (!accountcookies.account_id) {
            throw new Error(`account id empty`);
        }

        const recordtime = getRecorddatetime();
        const existingCookies = await this.getAccountCookies(accountcookies.account_id);

        if (existingCookies) {
            existingCookies.cookies = accountcookies.cookies;
            existingCookies.partition_path = accountcookies.partition_path;
            existingCookies.record_time = recordtime;
            await this.repository.save(existingCookies);
            return existingCookies.id;
        } else {
            accountcookies.record_time = recordtime;
            const savedCookies = await this.repository.save(accountcookies);
            return savedCookies.id;
        }
    }

    /**
     * Get account cookies by account ID
     */
    async getAccountCookies(accountid: number): Promise<AccountCookiesEntity | null> {
        return this.repository.findOne({ where: { account_id: accountid } });
    }

    /**
     * Delete account cookies by account ID
     */
    async deleteAccountCookies(accountid: number): Promise<number> {
        const result = await this.repository.delete({ account_id: accountid });
        return result.affected || 0;
    }
} 
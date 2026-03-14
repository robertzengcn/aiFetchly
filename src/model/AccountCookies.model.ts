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
        const now = new Date();
        // #region agent log cookie-debug
        fetch('http://127.0.0.1:7244/ingest/4d24544e-b441-4a64-b79f-84293905d2cc',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d4f741'},
          body:JSON.stringify({
            sessionId:'d4f741',
            runId:'pre-fix',
            hypothesisId:'H4',
            location:'AccountCookies.model.ts:22',
            message:'saveAccountCookies write',
            data:{
              accountId:accountcookies.account_id,
              hasId:Boolean(accountcookies.id),
              recordtime
            },
            timestamp:Date.now()
          })
        }).catch(()=>{});
        // #endregion agent log cookie-debug
        const existingCookies = await this.getAccountCookies(accountcookies.account_id);

        if (existingCookies) {
            // Use repository.update() so updatedAt is explicitly in the UPDATE SET (avoids save() omitting inherited columns)
            await this.repository.update(
                { id: existingCookies.id },
                {
                    cookies: accountcookies.cookies,
                    partition_path: accountcookies.partition_path,
                    record_time: recordtime,
                    updatedAt: now,
                }
            );
            return existingCookies.id;
        } else {
            accountcookies.record_time = recordtime;
            accountcookies.updatedAt = now;
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
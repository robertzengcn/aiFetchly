// import { Database } from 'better-sqlite3';
// import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime } from "@/modules/lib/function";
import { BaseDb } from "@/model/Basedb";
export interface AccountCookiesEntity {
    id?: number;
    account_id: number;
    cookies: string;
    partition_path: string;
    record_time?: string;   
}
export class AccountCookiesdb extends BaseDb{
    Table = "account_cookies";
    // db: Database;
    constructor(filepath:string) {
        super(filepath)
        // const scraperModel = Scraperdb.getInstance(filepath);
        // this.db = scraperModel.getdb();
    }
    //save account cookies
    public saveAccountCookies(
        accountcookies: AccountCookiesEntity
    ):number|bigint {
        if (!accountcookies.account_id) {
            throw new Error(`account id empty`);
        }
        const recordtime = getRecorddatetime();
        const ac=this.getAccountCookies(accountcookies.account_id)
        if(ac&&ac.id){
            const stmt = this.db.prepare(
                `UPDATE ` +
                this.Table +
                ` SET cookies = ?,partition_path = ?,record_time= ? WHERE id = ?`
            );
            const info = stmt.run(
                accountcookies.cookies,
                accountcookies.partition_path,
                recordtime,
                ac.id
            );
            return ac.id;
        }else{
       
        const stmt = this.db.prepare(
            `INSERT INTO ` +
            this.Table +
            ` (account_id,cookies,partition_path,record_time) VALUES (?,?,?,?)`
        );
        const info = stmt.run(
            accountcookies.account_id,
            accountcookies.cookies,
            accountcookies.partition_path,
            recordtime
        );
       
        return info.lastInsertRowid;
        }
    }
    //get social account cookies from db
    public getAccountCookies(
        accountid: number
    ): AccountCookiesEntity {
        const stmt = this.db.prepare(
            `SELECT * FROM ` + this.Table + ` WHERE account_id = ?`
        );
        const accountcookies = stmt.get(accountid) as AccountCookiesEntity;
        return accountcookies;
    }

    public deleteAccountCookies(accountid:number):void{
        const stmt = this.db.prepare(
            `DELETE FROM ` + this.Table + ` WHERE account_id = ?`
        );
        stmt.run(accountid);
    }
    

}
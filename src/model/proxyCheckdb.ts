import { Database } from 'better-sqlite3';
import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime } from "@/modules/lib/function";

export enum proxyCheckStatus {
    Success = 1,
    Failure = 2,
}
export class ProxyCheckdb {
    db: Database;
    proxyCheckTable = "proxy_check";

    constructor(filepath: string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        this.db = scraperModel.getdb();
    }

    public updateProxyCheck(proxyId: number, proxyCheckStatus: proxyCheckStatus) {
        const recordtime = getRecorddatetime();
        //check proxy exist by proxy id
        const checkstmt = this.db.prepare(
            `SELECT proxy_id FROM ` + this.proxyCheckTable + ` WHERE proxy_id=?`
        );
        const info = checkstmt.get(proxyId) as { proxy_id: number };
        //console.log(info)
        if (!info) {
            const stmt = this.db.prepare(
                `INSERT INTO ` +
                this.proxyCheckTable +
                ` (proxy_id,status,check_time) VALUES (?,?,?)`
            );
            stmt.run(
                proxyId,
                proxyCheckStatus,
                recordtime
            );

        } else {
            const updateSql= `UPDATE ` +
            this.proxyCheckTable +
            ` SET status =?  WHERE proxy_id=?`
            
            const upStmt = this.db.prepare(
                updateSql 
            );

            
            upStmt.run(proxyCheckStatus, proxyId)

            const updatetimeSql= `UPDATE ` +
            this.proxyCheckTable +
            ` SET check_time =?  WHERE proxy_id=?`
            const utStmt = this.db.prepare(
                updatetimeSql 
            );
           utStmt.run(recordtime, proxyId)
            
           
        }
    }
    //get proxy check status by proxy id
    public getProxyCheck(proxyId: number):{ status: number, check_time: string } {
        const stmt = this.db.prepare(
            `SELECT status,check_time FROM ` + this.proxyCheckTable + ` WHERE proxy_id=?`
        );
        const info = stmt.get(proxyId) as { status: number, check_time: string };
        return info;
    }
    //get proxy by status
    public getProxyByStatus(status: proxyCheckStatus): Array<{ proxy_id: number }>{
        const stmt = this.db.prepare(
            `SELECT proxy_id FROM ` + this.proxyCheckTable + ` WHERE status=?`
        );
        const info = stmt.all(status) as Array<{ proxy_id: number }>;
        return info;
    }
    //delete record by proxy id
    public deleteProxyCheck(proxyId: number) {
        const stmt = this.db.prepare(
            `DELETE FROM ` + this.proxyCheckTable + ` WHERE proxy_id=?`
        );
        stmt.run(proxyId)
    }

}
import { BaseDb } from "@/model/Basedb";

import {VideoDownloadTaskAccountEntity} from "@/entityTypes/videoType"
export class VideoDownloadTaskAccountsdb extends BaseDb{

    private table = "VideoDownloadTaskAccounts";
    constructor(filepath:string) {
        super(filepath)
        // const scraperModel = Scraperdb.getInstance(filepath);
        // this.db = scraperModel.getdb();
    }
    create(vdte: VideoDownloadTaskAccountEntity): number {

        const stmt = this.db.prepare("INSERT INTO "+this.table+" (task_id, account_id) VALUES (?, ?)");
        const res = stmt.run(vdte.task_id, vdte.account_id);
        return res.lastInsertRowid as number;
    }

    read(id: number): VideoDownloadTaskAccountEntity {
        // return await this.db.get<VideoDownloadTaskAccountEntity>("SELECT * FROM VideoDownloadTaskAccounts WHERE id = ?", id);
           const stmt = this.db.prepare(
              `SELECT * FROM ` + this.table + ` WHERE id = ?`);
            const res = stmt.get(id) as VideoDownloadTaskAccountEntity;
            return res;
    }

    update(id: number, taskAccount: VideoDownloadTaskAccountEntity): void {
        const stmt = this.db.prepare(`
            UPDATE ${this.table}
            SET task_id=@task_id,account_id = @account_id
            WHERE id = @id
        `);
        stmt.run({
            id: id,
            task_id: taskAccount.task_id,
            account_id: taskAccount.account_id
        })
    }

    delete(id: number): void {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.table} WHERE id = ?
        `);
        stmt.run(id);
    }

    //query account id by task id
    public getAccountByTaskId(taskId: number): Array<VideoDownloadTaskAccountEntity> {
        const stmt = this.db.prepare(
            `SELECT * FROM ` + this.table + ` WHERE task_id = ?`
        );
        const account = stmt.all(taskId) as Array<VideoDownloadTaskAccountEntity>;
        return account;
    }



}
import { BaseDb } from "@/model/Basedb";

import {VideoDownloadTaskProxyEntityType} from "@/entityTypes/videoType"


export class VideoDownloadTaskProxydb extends BaseDb{

    private table = "video_download_task_urls";
    constructor(filepath:string) {
        super(filepath)
        // const scraperModel = Scraperdb.getInstance(filepath);
        // this.db = scraperModel.getdb();
    }

    create(vdte: VideoDownloadTaskProxyEntityType): number {

        const stmt = this.db.prepare("INSERT INTO "+this.table+" (task_id, proxy_id) VALUES (?, ?)");
        const res = stmt.run(vdte.task_id, vdte.proxy_id);
        return res.lastInsertRowid as number;
    }

    read(id: number): VideoDownloadTaskProxyEntityType {
        // return await this.db.get<VideoDownloadTaskAccountEntity>("SELECT * FROM VideoDownloadTaskAccounts WHERE id = ?", id);
           const stmt = this.db.prepare(
              `SELECT * FROM ` + this.table + ` WHERE id = ?`);
            const res = stmt.get(id) as VideoDownloadTaskProxyEntityType;
            return res;
    }

    update(id: number, vdte: VideoDownloadTaskProxyEntityType): void {
        const stmt = this.db.prepare(`
            UPDATE ${this.table}
            SET task_id=@task_id,proxy_id = @proxy_id
            WHERE id = @id
        `);
        stmt.run({
            id: id,
            task_id: vdte.task_id,
            url: vdte.proxy_id,
           
        })
    }

    delete(id: number): void {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.table} WHERE id = ?
        `);
        stmt.run(id);
    }

    //query items id by task id
    public getItemsByTaskId(taskId: number): Array<VideoDownloadTaskProxyEntityType> {
        const stmt = this.db.prepare(
            `SELECT * FROM ` + this.table + ` WHERE task_id = ?`
        );
        const res = stmt.all(taskId) as Array<VideoDownloadTaskProxyEntityType>;
        return res;
    }



}
import { BaseDb } from "@/model/Basedb";

import {VideoDownloadTaskUrlEntity} from "@/entityTypes/videoType"


export class VideoDownloadTaskUrldb extends BaseDb{

    private table = "video_download_task_urls";
    constructor(filepath:string) {
        super(filepath)
        // const scraperModel = Scraperdb.getInstance(filepath);
        // this.db = scraperModel.getdb();
    }

    create(vdte: VideoDownloadTaskUrlEntity): number {

        const stmt = this.db.prepare("INSERT INTO "+this.table+" (task_id, url) VALUES (?, ?)");
        const res = stmt.run(vdte.task_id, vdte.url);
        return res.lastInsertRowid as number;
    }

    read(id: number): VideoDownloadTaskUrlEntity {
        // return await this.db.get<VideoDownloadTaskAccountEntity>("SELECT * FROM VideoDownloadTaskAccounts WHERE id = ?", id);
           const stmt = this.db.prepare(
              `SELECT * FROM ` + this.table + ` WHERE id = ?`);
            const res = stmt.get(id) as VideoDownloadTaskUrlEntity;
            return res;
    }

    update(id: number, vdte: VideoDownloadTaskUrlEntity): void {
        const stmt = this.db.prepare(`
            UPDATE ${this.table}
            SET task_id=@task_id,url = @url
            WHERE id = @id
        `);
        stmt.run({
            id: id,
            task_id: vdte.task_id,
            url: vdte.url,
           
        })
    }

    delete(id: number): void {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.table} WHERE id = ?
        `);
        stmt.run(id);
    }

    //query items id by task id
    public getItemsByTaskId(taskId: number): Array<VideoDownloadTaskUrlEntity> {
        const stmt = this.db.prepare(
            `SELECT * FROM ` + this.table + ` WHERE task_id = ?`
        );
        const res = stmt.all(taskId) as Array<VideoDownloadTaskUrlEntity>;
        return res;
    }



}
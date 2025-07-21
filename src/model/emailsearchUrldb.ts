import { Database } from 'better-sqlite3';
import { Scraperdb } from "@/model/scraperdb";
// import { getRecorddatetime } from "@/modules/lib/function";
export interface EmailsearchUrlEntity {
    id?: number,
    task_id:number,
    url:string,
}
export class EmailsearchUrldb {
    db: Database;
    emailsearchurlTable = "emailsearch_url";
    constructor(filepath:string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        this.db = scraperModel.getdb();
    }
    create(emailsearchUrl: EmailsearchUrlEntity): number {
        const stmt = this.db.prepare(`
            INSERT INTO ${this.emailsearchurlTable} (task_id, url)
            VALUES (@task_id, @url)
        `);
        const result = stmt.run(emailsearchUrl);
        return Number(result.lastInsertRowid);
    }

    read(id: number): EmailsearchUrlEntity | undefined|null {
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.emailsearchurlTable}
            WHERE id = @id
        `);
        const result = stmt.get({ id }) as EmailsearchUrlEntity;
        if(result && result.id) {
        return result;
        }else{
            return null;
        }
    }

    update(emailsearchUrl: EmailsearchUrlEntity): boolean {
        const stmt = this.db.prepare(`
            UPDATE ${this.emailsearchurlTable}
            SET task_id = @task_id, url = @url
            WHERE id = @id
        `);
        const result = stmt.run(emailsearchUrl);
        return result.changes > 0;
    }

    delete(id: number): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.emailsearchurlTable}
            WHERE id = @id
        `);
        const result = stmt.run({ id });
        return result.changes > 0;
    }
    getUrls(taskId:number,page:number,size:number):Array<EmailsearchUrlEntity>{
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.emailsearchurlTable}
            WHERE task_id = @taskId LIMIT @size OFFSET @page
        `);
        const result = stmt.all({ taskId,size,page }) as Array<EmailsearchUrlEntity>;
        return result;
    }

}
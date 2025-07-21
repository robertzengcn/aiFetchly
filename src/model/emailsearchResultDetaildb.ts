import { Database } from 'better-sqlite3';
import { Scraperdb } from "@/model/scraperdb";
// import { getRecorddatetime } from "@/modules/lib/function";

export interface EmailsearchResultDetailEntity {
    id?: number,
    result_id: number,
    email:string,
}
/**
 * Represents a database model for email search result details.
 */
export class EmailsearchResultDetaildb {
    db: Database;
    emailsearchtaskTable = "emailsearch_result_detail";
    constructor(filepath:string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        this.db = scraperModel.getdb();
    }

    /**
     * Creates a new email search result detail in the database.
     * 
     * @param emailsearchResultDetail - The email search result detail entity to be created.
     * @returns The ID of the newly created email search result detail.
     */
    create(emailsearchResultDetail: EmailsearchResultDetailEntity): number {
        //trim blank space in email value
        emailsearchResultDetail.email=emailsearchResultDetail.email.trim()
        //check item exist or not, if not exit, then insert
        const item=this.readItem(emailsearchResultDetail.result_id,emailsearchResultDetail.email)
        if(item){
            return Number(item.id)
        }
        const stmt = this.db.prepare(`
            INSERT INTO ${this.emailsearchtaskTable} (result_id, email)
            VALUES (@result_id, @email)
        `);
        const result = stmt.run(emailsearchResultDetail);
        return Number(result.lastInsertRowid);
    }

    /**
     * Reads an email search result detail entity from the database based on the provided ID.
     * @param id - The ID of the email search result detail entity to read.
     * @returns The email search result detail entity if found, otherwise undefined.
     */
    read(id: number): EmailsearchResultDetailEntity | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.emailsearchtaskTable} WHERE id = ?
        `);
        const result = stmt.get(id) as EmailsearchResultDetailEntity;
        return result;
    }

    update(emailsearchResultDetail: EmailsearchResultDetailEntity): boolean {
        const stmt = this.db.prepare(`
            UPDATE ${this.emailsearchtaskTable}
            SET result_id = @result_id, email = @email
            WHERE id = @id
        `);
        const result = stmt.run(emailsearchResultDetail);
        return result.changes > 0;
    }

    delete(id: number): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.emailsearchtaskTable} WHERE id = ?
        `);
        const result = stmt.run(id);
        return result.changes > 0;
    }
    //read item by result id and email value
    readItem(result_id: number,email:string): EmailsearchResultDetailEntity | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.emailsearchtaskTable} WHERE result_id = ? and email=?
        `);
        const result = stmt.get(result_id,email) as EmailsearchResultDetailEntity;
        return result;
    }
    //get items by result id
    getItemsByResultId(result_id: number): EmailsearchResultDetailEntity[] {
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.emailsearchtaskTable} WHERE result_id = ?
        `);
        const result = stmt.all(result_id) as EmailsearchResultDetailEntity[];
        return result;
    }

    getTaskResultCount(result_id: number): number {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM ${this.emailsearchtaskTable} WHERE result_id = ?
        `);
        const result = stmt.get(result_id) as { 'count': number };
        return result.count
    }
}
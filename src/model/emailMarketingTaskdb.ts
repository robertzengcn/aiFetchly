import { Database } from 'better-sqlite3';
import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime } from "@/modules/lib/function";
import { TaskStatus } from "@/entityTypes/commonType";
export enum EmailMarketingTaskStatus {
    Processing = 1,
    Complete = 2,
    Error = 3
  }
export interface EmailMarketingTaskdbEntity {
    id?: number;
    status: TaskStatus;
    record_time?: string;   
}

export class EmailTaskdb {
    db: Database;
    constructor(filepath:string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        this.db = scraperModel.getdb();
    }
    createTask(task: EmailMarketingTaskdbEntity): number {
        const stmt = this.db.prepare(`
            INSERT INTO email_tasks (status, record_time)
            VALUES (?, ?)
        `);
        const info = stmt.run(task.status, task.record_time || getRecorddatetime());
        return info.lastInsertRowid as number;
    }

    getTaskById(id: number): EmailMarketingTaskdbEntity | null {
        const stmt = this.db.prepare(`
            SELECT * FROM email_tasks WHERE id = ?
        `);
        return stmt.get(id) as EmailMarketingTaskdbEntity | null;
    }

    updateTask(task: EmailMarketingTaskdbEntity): void {
        if (!task.id) {
            throw new Error("Task ID is required for update");
        }
        const stmt = this.db.prepare(`
            UPDATE email_tasks
            SET status = ?, record_time = ?
            WHERE id = ?
        `);
        stmt.run(task.status, task.record_time || getRecorddatetime(), task.id);
    }

    deleteTask(id: number): void {
        const stmt = this.db.prepare(`
            DELETE FROM email_tasks WHERE id = ?
        `);
        stmt.run(id);
    }
    updateTaskStatus(id: number, status: EmailMarketingTaskStatus): void {
        const stmt = this.db.prepare(`
            UPDATE email_tasks
            SET status = ?
            WHERE id = ?
        `);
        stmt.run(status, id);
    }
    getStatusName(status: EmailMarketingTaskStatus): string {
        switch (status) {
            case EmailMarketingTaskStatus.Processing:
                return "Processing";
            case EmailMarketingTaskStatus.Complete:
                return "Complete";
            case EmailMarketingTaskStatus.Error:
                return "Error";
            default:
                throw new Error("Invalid status");
        }
    }
}

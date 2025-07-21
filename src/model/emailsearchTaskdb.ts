import { Database } from 'better-sqlite3';
import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime } from "@/modules/lib/function";
import {EmailExtractionTypes} from "@/config/emailextraction"
import { SortBy } from "@/entityTypes/commonType"
import { ProxyEntity } from '@/entity/Proxy.entity';
export interface EmailsearchTaskEntity {
    id?: number,
    search_result_id?:number,
    error_log?:string,
    runtime_log?:string,
    record_time?:string,
    type_id: EmailExtractionTypes,
    status: EmailsearchTaskStatus,
    processTimeout:number,
    maxPageNumber:number,
    page_length:number,
    concurrency:number,
    //proxys:Array<ProxyEntity>,
    is_active:boolean,
}
export enum EmailsearchTaskStatus {
    Processing = 1,
    Complete = 2,
    Error = 3
  }
export class EmailsearchTaskdb {
    db: Database;
    emailsearchtaskTable = "emailsearch_task";
    constructor(filepath:string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        this.db = scraperModel.getdb();
    }
    //create task
    createTask(task: EmailsearchTaskEntity): number {
        if(!task.record_time){
            task.record_time = getRecorddatetime();
        }
        const stmt = this.db.prepare(`
            INSERT INTO ${this.emailsearchtaskTable} (error_log, runtime_log, record_time,type_id, status)
        VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(task.error_log, task.runtime_log, task.record_time, task.type_id,task.status);
        return Number(result.lastInsertRowid);
    }
    //get task by id
    getTaskById(id: number): EmailsearchTaskEntity | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.emailsearchtaskTable} WHERE id = ?
        `);
        const result = stmt.get(id) as EmailsearchTaskEntity;
        // if(result&&result.id){
        //     return result;
        // }
        return result&&result.id ? result : undefined;
    }
    //update task
    updateTask(task: EmailsearchTaskEntity): boolean {
        const stmt = this.db.prepare(`
            UPDATE ${this.emailsearchtaskTable}
            SET error_log = ?, runtime_log = ?, record_time = ?, status = ?
            WHERE id = ?
        `);
        const result = stmt.run(task.error_log, task.runtime_log, task.record_time, task.status, task.id);
        return result.changes > 0;
    }
    //delete task
    deleteTask(id: number): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.emailsearchtaskTable} WHERE id = ?
        `);
        const result = stmt.run(id);
        return result.changes > 0;
    }
    //update task status
    updateTaskStatus(id: number, status: EmailsearchTaskStatus): boolean {
        const stmt = this.db.prepare(`
            UPDATE ${this.emailsearchtaskTable}
            SET status = ?
            WHERE id = ?
        `);
        const result = stmt.run(status, id);
        return result.changes > 0;
    }
     //update task error log path
  public updatetasklog(taskId: number, log: string) {
    const stmt = this.db.prepare(
      `UPDATE 
      ${this.emailsearchtaskTable} 
       SET error_log=? WHERE id=?`
    );
    stmt.run(log, taskId)
  }
  //update task runtime log path
  public updateruntimelog(taskId: number, log: string) {
    const stmt = this.db.prepare(
      `UPDATE 
      ${this.emailsearchtaskTable}
       SET runtime_log=? WHERE id=?`
    );
    stmt.run(log, taskId)
  }
  //list email search task
    public listSearchtask(page: number, size: number, sort?: SortBy): { records: EmailsearchTaskEntity[], total: number } {
        let query = 'SELECT * FROM '+this.emailsearchtaskTable
        if (sort&&sort.key&&sort.order) {
            const lowsersortkey = sort.key.toLowerCase()
            const lowsersortorder = sort.order.toLowerCase()
            const allowsortkey = ['id', 'record_time', 'status']
            const allowsortorder = ['asc', 'desc']
      
            // if (sort) {
            if (!allowsortkey.includes(lowsersortkey)) {
              //not allow such key, throw error
              throw new Error("not allow sort key")
            } else {
              if (!allowsortorder.includes(lowsersortorder)) {
                throw new Error("not allow sort order")
              }
              // sortstr = lowsersortkey + ' ' + lowsersortorder
              query+=' ORDER BY '+lowsersortkey+' '+lowsersortorder
              console.log(query)
            }
      
            // }
          }else{
            query+=' ORDER BY id DESC'
          }
          query+=' LIMIT ? OFFSET ?'
        const stmt = this.db.prepare(query);

        const records = stmt.all(size, page) as EmailsearchTaskEntity[];
        const total = this.countSearchtask();
        return { records, total };
    }
    //count email search task
    public countSearchtask(): number {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) AS total FROM ${this.emailsearchtaskTable}
        `);
        const result = stmt.get() as { total: number };
        return result.total as number;
    }
    //task status convert
    public statusConvert(status: EmailsearchTaskStatus): string {
        switch (status) {
            case EmailsearchTaskStatus.Processing:
                return 'Processing';
            case EmailsearchTaskStatus.Complete:
                return 'Complete';
            case EmailsearchTaskStatus.Error:
                return 'Error';
            default:
                return 'Unknown';
        }
    }
    //convert type to string
    public convertType(type: EmailExtractionTypes): string {
        switch (type) {
            case EmailExtractionTypes.ManualInputUrl:
                return 'ManualInputUrl';
            case EmailExtractionTypes.SearchResult:
                return 'SearchResult';
            default:
                return 'Unknown';
        }
    }
}
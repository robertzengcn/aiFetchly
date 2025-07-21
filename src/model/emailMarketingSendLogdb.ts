
import { Database } from 'better-sqlite3';
import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime } from "@/modules/lib/function";
import { SortBy } from "@/entityTypes/commonType"
// import { TaskStatus } from "@/config/common"
export enum SendStatus {
    Success = 1,
    Failure = 0,
  }
export interface EmailMarketingSendLogEntity {
    id?: number;
    status:SendStatus;
    task_id: number;
    receiver: string;
    title: string;
    content: string;
    record_time?: string;
    log?:string;
}

export class EmailMarketingSendLogdb {
    db: Database;
    emailSendlogTaskTable = "email_send_log";
    constructor(filepath: string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        this.db = scraperModel.getdb();
    }
    create(task: EmailMarketingSendLogEntity): number {
        const stmt = this.db.prepare(`
            INSERT INTO ${this.emailSendlogTaskTable} (status,task_id, receiver, title, content, record_time,log)
            VALUES (@status,@task_id, @receiver, @title, @content, @record_time,@log)
        `);
        const info = stmt.run({
            status:task.status,
            task_id: task.task_id,
            receiver: task.receiver,
            title: task.title,
            content: task.content,
            record_time: task.record_time || getRecorddatetime(),
            log:task.log||""
        });
        return info.lastInsertRowid as number;
    }
    read(id: number): EmailMarketingSendLogEntity | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.emailSendlogTaskTable} WHERE id = ?
        `);
        return stmt.get(id) as EmailMarketingSendLogEntity | undefined;
    }
    update(id: number, task: EmailMarketingSendLogEntity): void {
        const stmt = this.db.prepare(`
            UPDATE ${this.emailSendlogTaskTable}
            SET status=@status,task_id = @task_id, receiver = @receiver, title = @title, content = @content, record_time = @record_time,log=@log
            WHERE id = @id
        `);
        stmt.run({
            id: id,
            status:task.status,
            task_id: task.task_id,
            receiver: task.receiver,
            title: task.title,
            content: task.content,
            record_time: task.record_time || getRecorddatetime(),
            log:task.log||""
        });
    }
    delete(id: number): void {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.emailSendlogTaskTable} WHERE id = ?
        `);
        stmt.run(id);
    }
    //get send log status name, return string
    getSendStatusName(status: SendStatus): string {
        switch (status) {
            case SendStatus.Success:
                return "Success";
            case SendStatus.Failure:
                return "Failure";
            default:
                return "Unknown";
        }
    }
    //list email send log
    listEmailMarketingSendLog(taskid:number,page: number, limit: number,where?:string,sort?: SortBy): EmailMarketingSendLogEntity[] {
        let query='SELECT * FROM ' + this.emailSendlogTaskTable + ' WHERE task_id=?'
        if(where){
            query+=' AND (WHERE receiver LIKE ? OR title LIKE ? OR content LIKE ?)'
        }
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
        let param:String[]=[taskid.toString(),limit.toString(),page.toString()]  
        if(where){
            param=[taskid.toString(),where,where,where,limit.toString(),page.toString()]
        }
        const res = stmt.all(
            param
        );
        return res as EmailMarketingSendLogEntity[];
    }
    //count email send log
    countEmailMarketingSendLog(taskid:number,where?:string): number {
    //     const stmt = this.db.prepare(`
    //         SELECT COUNT(*) as count FROM email_marketing_send_log WHERE task_id=?
    //     `);
    //    const totalobj=stmt.get(taskid) as { count: number };
    //    return totalobj.count;
    let query='SELECT COUNT(*) as count FROM '+this.emailSendlogTaskTable+' WHERE task_id=?'
    if(where){
        query+=' AND (WHERE receiver LIKE ? OR title LIKE ? OR content LIKE ?)'

    }
    const stmt = this.db.prepare(query);
    let param:String[]=[taskid.toString()]
    if(where){
        param=[taskid.toString(),where,where,where]
    }
    const res = stmt.get(
        param
    ) as { count: number };
    return res.count;
    }

}

import { Database } from 'better-sqlite3';
import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime, getStatusName } from "@/modules/lib/function";
import { TaskStatus } from "@/entityTypes/commonType"
import { SortBy } from "@/entityTypes/commonType"
export interface BuckemailEntity {
    id?: number;
    type: BuckEmailType;
    record_time?: string;
    log_file: string;
    error_file: string;
    status?: TaskStatus;
}

export enum BuckEmailType {
    EXTRACTEMAIL = 1,
}
export class BuckEmailTaskdb {
    db: Database;
    buckemailTaskTable = "buckemail_task";
    constructor(filepath: string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        //this.db = scraperModel.getdb();
    }
    create(task: BuckemailEntity): number {
        const stmt = this.db.prepare(`
            INSERT INTO ${this.buckemailTaskTable} (type, status, record_time, log_file, error_file)
            VALUES (@type, @status, @record_time, @log_file, @error_file)
        `);
        const info = stmt.run({
            type: task.type,
            status: task.status || TaskStatus.Processing,
            record_time: task.record_time || getRecorddatetime(),
            log_file: task.log_file,
            error_file: task.error_file
        });
        return info.lastInsertRowid as number;
    }

    read(id: number): BuckemailEntity | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM ${this.buckemailTaskTable} WHERE id = ?
        `);
        return stmt.get(id) as BuckemailEntity | undefined;
    }
    //update buck email task
    update(id: number, task: BuckemailEntity): void {
        const stmt = this.db.prepare(`
            UPDATE ${this.buckemailTaskTable}
            SET type = @type, record_time = @record_time,status = @status,log_file=@log_file,error_file=@error_file
            WHERE id = @id
        `);
        stmt.run({
            id: id,
            type: task.type,
            record_time: task.record_time || getRecorddatetime(),
            status: task.status,
            log_file: task.log_file,
            error_file: task.error_file
        });
    }

    delete(id: number): void {
        const stmt = this.db.prepare(`
            DELETE FROM ${this.buckemailTaskTable} WHERE id = ?
        `);
        stmt.run(id);
    }
    //get buck email status
    public getBuckEmailStatusName(taskStatus: TaskStatus): String {
        return getStatusName(taskStatus)
    }
    public updateTaskLogfile(id: number, runtimeLog: string, errorLog: string) {
        const stmt = this.db.prepare(`
            UPDATE ${this.buckemailTaskTable}
            SET log_file = @log_file, error_file = @error_file
            WHERE id = @id
        `);
        stmt.run({
            id: id,
            log_file: runtimeLog,
            error_file: errorLog
        });
    }
    //update task log status
    updateTaskStatus(id: number, status: TaskStatus) {
        const stmt = this.db.prepare(`
            UPDATE ${this.buckemailTaskTable}
            SET status = @status
            WHERE id = @id
        `);
        stmt.run({
            id: id,
            status: status
        });
    }
     //list task
     public listBuckEmailtask(page: number, size: number,sort?: SortBy): Array<BuckemailEntity> {
        let query = 'SELECT * FROM '+this.buckemailTaskTable

       
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
            //   console.log(query)
            }
      
            // }
          }else{
            query+=' ORDER BY id DESC'
          }
          query+=' LIMIT ? OFFSET ?'
        const stmt = this.db.prepare(query);

        return stmt.all(size, page) as BuckemailEntity[]; 

    }
    //count buck email task number
    public countBuckEmailTask(): number {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM ${this.buckemailTaskTable}
        `);
       const totalobj=stmt.get() as { count: number };
       return totalobj.count;

    }
    //get buck email type name, return string
    public getBuckEmailTypeName(type: BuckEmailType): string {
        switch (type) {
            case BuckEmailType.EXTRACTEMAIL:
                return "Extract Email"
            default:
                return "Unknown"
        }
    }

}
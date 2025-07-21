// import { Database,RunResult } from "sqlite3";
import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime } from "@/modules/lib/function";
import { Database } from 'better-sqlite3';
export interface TaskResultEntity {
  id?: number;
  taskrun_id: number;
  url: string;
  title: string;
  content?: string;
  lang?: string;
  record_time?: string;
}
export type TaskResultSearchres={
  Total:number
  Records:Array<TaskResultEntity>
}
export class TaskResultdb {
  db: Database;
  taskresultTable = "task_result";
  constructor(filepath:string) {
    const scraperModel = Scraperdb.getInstance(filepath);
    this.db = scraperModel.getdb();
  }
  //save task result
  public saveTaskresult(
    taskresult: TaskResultEntity,
    callback: ((arg: any) => void) | undefined | null
  ):number|bigint {
    if (!taskresult.taskrun_id) {
      throw new Error(`task run id empty`);
    }
    const recordtime = getRecorddatetime();
    const stmt = this.db.prepare(
      `INSERT INTO ` +
        this.taskresultTable +
        ` (taskrun_id,url,title,content,lang,record_time) VALUES (?,?,?,?,?,?)`
    );
    const info =stmt.run(
      taskresult.taskrun_id,
      taskresult.url,
      taskresult.title,
      taskresult.content,
      taskresult.lang,
      recordtime
    );
    if(info.changes){
      if (callback) {
        callback(info.lastInsertRowid);
      }
    }
    return info.lastInsertRowid;
  }
  //get task result list by task run id
  public getTaskresultlist(
    taskrunId: number,
    page: number,
    size: number,
    callback?: ((res: TaskResultSearchres) => void) | undefined | null
  ): TaskResultSearchres {
    const stmt = this.db.prepare(
      `SELECT * FROM ` +
        this.taskresultTable +
        ` WHERE taskrun_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    );
    const taskresult = stmt.all(taskrunId, size, page ) as Array<TaskResultEntity>;
    const totalstmt = this.db.prepare(
      `SELECT COUNT(*) as total FROM ` + this.taskresultTable + ` WHERE taskrun_id = ?`
    );
    const total = totalstmt.get(taskrunId) as { total: number };
    const res: TaskResultSearchres = {
      Total: total.total,
      Records: taskresult,
    };
    if (callback) {
      callback(res);
    }
    return res;
  }
}

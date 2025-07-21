import { Database } from 'better-sqlite3';
import { getRecorddatetime } from "@/modules/lib/function";
import { Scraperdb } from "@/model/scraperdb";
import { SearhEnginer } from "@/config/searchSetting"
import { SearchtaskdbEntity } from "@/entityTypes/searchControlType"
import { SortBy } from "@/entityTypes/commonType"
export enum SearchTaskStatus {
  Processing = 1,
  Complete = 2,
  Error = 3
}
export class SearchTaskdb {
  db: Database;
  searchTaskTable = "search_task";

  constructor(filepath: string) {
    console.log(filepath)
    const scraperModel = Scraperdb.getInstance(filepath);
    this.db = scraperModel.getdb();
  }
  //save search task
  public saveSearchTask(enginerId: number): number | bigint {

    const recordtime = getRecorddatetime();

    const stmt = this.db.prepare(
      `INSERT INTO ` +
      this.searchTaskTable +
      ` (enginer_id,record_time,status) VALUES (?,?,?)`
    );
    const info = stmt.run(

      enginerId,
      recordtime,
      SearchTaskStatus.Processing
    );
    return info.lastInsertRowid;
  }
  //update task error log path
  public updatetasklog(taskId: number, log: string) {
    const stmt = this.db.prepare(
      `UPDATE ` +
      this.searchTaskTable +
      ` SET error_log=? WHERE id=?`
    );
    stmt.run(log, taskId)
  }
  //update task runtime log path
  public updateruntimelog(taskId: number, log: string) {
    const stmt = this.db.prepare(
      `UPDATE ` +
      this.searchTaskTable +
      ` SET runtime_log=? WHERE id=?`
    );
    stmt.run(log, taskId)
  }
  //update task status
  public updatetaskstatus(taskId: number, status: SearchTaskStatus) {
    const stmt = this.db.prepare(
      `UPDATE ` +
      this.searchTaskTable +
      ` SET status=? WHERE id=?`
    );
    stmt.run(status, taskId)
  }
  //list task by condition
  public listTask(page: number, size: number, sort?: SortBy): Array<SearchtaskdbEntity> {
    let query = 'SELECT * FROM ' +
      this.searchTaskTable
      console.log(query)
    // let sortstr = 'id DESC'
    if (sort&&sort.key&&sort.order) {
      const lowsersortkey = sort.key.toLowerCase()
      const lowsersortorder = sort.order.toLowerCase()
      const allowsortkey = ['id', 'enginer_id', 'record_time', 'status']
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
    const stmt = this.db.prepare(
      query
    );

    return stmt.all(size, page) as Array<SearchtaskdbEntity>
  }
  //get task total number
  public getTaskTotal(): number {
    const stmt = this.db.prepare(
      `SELECT count(*) as total FROM ` +
      this.searchTaskTable
    );
    const result = stmt.get();
    const total = (result as { total: number }).total;
    return total
  }

  public taskStatusToString(status: SearchTaskStatus): string {
    switch (status) {
      case SearchTaskStatus.Processing:
        return "Processing";
      case SearchTaskStatus.Complete:
        return "Complete";
      case SearchTaskStatus.Error:
        return "Error";
      default:
        return "Unknown";
    }
  }
  //get task by id
  public getTaskEntity(taskId: number): SearchtaskdbEntity {
    const stmt = this.db.prepare(
      `SELECT * FROM ` +
      this.searchTaskTable + ` WHERE id=?`
    );
    return stmt.get(taskId) as SearchtaskdbEntity
  }

}

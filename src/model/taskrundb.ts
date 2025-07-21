// import { Database } from 'sqlite3';
import { Scraperdb } from "@/model/scraperdb";
import { getRecorddatetime } from "@/modules/lib/function";
import { Database } from 'better-sqlite3';
import {TaskRunEntity} from "@/entityTypes/taskrun-type";
export class Taskrundb {
  db: Database;
  taskrunTable = "task_run";
  constructor(filepath:string) {
    // this.db = new Database('foobar.db');
    const scraperModel = Scraperdb.getInstance(filepath);
    this.db = scraperModel.getdb();
  }
  //save task run
  public saveTaskrun(taskrun: TaskRunEntity, callback?: (info: number) => void | undefined | null): number | bigint {
    const recordtime = getRecorddatetime();
    const stmt = this.db.prepare(
      `INSERT INTO ` +
      this.taskrunTable +
      ` (task_id,taskrun_num,log_path,record_time) VALUES (?,?,?,?)`);
    const info = stmt.run(
      taskrun.task_id, taskrun.taskrun_num, taskrun.log_path, recordtime);
    
    if(info){
      if (callback) {
        callback(Number(info.lastInsertRowid))
      }
      return info.lastInsertRowid;
    }else{
      return 0;
    }
  }
  //get task id by task run number
  public getTaskidbytaskrunNum(taskrunNum: string, callback?: (id: number, taskid: number) => void | undefined | null) {
    const stmt = this.db.prepare(`SELECT id,task_id FROM ` + this.taskrunTable + ` WHERE taskrun_num = ?`);
    // let taskid: number = 0;
    const taskrun = stmt.get(taskrunNum) as { id: number, task_id: number }
    // if (err) {
    //   throw new Error(err.message);
    // }
    // if (row) {
    const taskid = taskrun.task_id;
    const id = taskrun.id;
    if (callback) {
      callback(id, taskid)
    }
    // }
    // });
    //return taskid;
  }
  //check task id and task run number exist
  public checkTaskrunExist(taskid: number, taskrunNum: string, callback: (exist: boolean) => void | undefined | null) {
    const stmt = this.db.prepare(`SELECT task_id FROM ` + this.taskrunTable + ` WHERE task_id = ? AND taskrun_num = ?`);
    let exist = false;
    const taskchekres = stmt.get(taskid, taskrunNum) as { task_id: number }
    
    if (taskchekres&&taskchekres.task_id) {
      exist = true;
    }
    if (callback) {
      callback(exist)
    }

    // );
    //return exist;
  }
  //get task run list
  public getTaskrunlist(taskId: number, page:number,size:number,callback?: (reslist: Array<TaskRunEntity>) => void):Array<TaskRunEntity> {
    const stmt =this.db.prepare( `SELECT id,task_id,taskrun_num,log_path, record_time FROM ` + this.taskrunTable + ` WHERE task_id = ? ORDER BY id desc LIMIT ?,? `);
    const reslist=stmt.all(taskId,page,size)as Array<TaskRunEntity> 
     
      if (callback) {
        callback(reslist)
      }
      return reslist
    // });
  }
  //get task run total number by task id
  public getTaskrunTotal(taskId: number):number {
    const stmt = this.db.prepare(`SELECT count(*) as total FROM ` + this.taskrunTable + ` WHERE task_id = ?`);
    const total = stmt.get(taskId) as { total: number }
    // if (callback) {
    //   callback(total.total)
    // }
    return total.total
    // });
  }

}
import { getApplogpath, getdate } from "@/modules/lib/function"
import { TaskRunModel } from "@/model/TaskRun.model"
// import { v4 as uuidv4 } from 'uuid';
import * as randomstring from "randomstring";
import { SocialTaskRunEntity } from "@/entityTypes/socialtask-type"
import path from "path";
import { TaskRunEntity } from "@/entityTypes/taskrun-type";
export type taskrunSearchres = {
    Total: number
    Records: Array<TaskRunEntity>
}
//the social task run created each time when task run
export class SocialTaskRun {
    private dbpath = ""
    constructor(dbpath?: string) {
        if (dbpath) {
            this.dbpath = dbpath
        }
    }
    //create social task run
    public async createsocialtaskrun(socailtaskId: number, taskrunNum: string): Promise<SocialTaskRunEntity> {
        const taskrunmodel = new TaskRunModel(this.dbpath)
        const logfile = this.getlogfile(socailtaskId)
        // WS-3 R3.2: migrated from the sync raw-SQL Taskrundb to the async TypeORM
        // TaskRunModel. checkTaskrunExist + saveTaskrun are now awaited.
        const exists = await taskrunmodel.checkTaskrunExist(socailtaskId, taskrunNum)
        if (exists) {
            throw new Error("task run number exist")
        }
        const taskentity: TaskRunEntity = {
            task_id: socailtaskId,
            taskrun_num: taskrunNum,
            log_path: logfile
        }
        await taskrunmodel.saveTaskrun(taskentity)
        const socialtaskRun: SocialTaskRunEntity = {
            task_id: socailtaskId,
            taskrun_num: taskrunNum,
            log_path: logfile,

        }
        return socialtaskRun
    }


    private getlogfile(socailtaskId: number): string {
        const logDir = getApplogpath();
        if (!logDir) {
            throw new Error("get user home dir error")
        }
        const recorddate = getdate()
        return path.join(logDir, "social-task-log", recorddate, socailtaskId.toString() + ".log");
    }

    //generate unique task run number
    private gentaskrunNum(taskId: number): string {
        return taskId.toString() + ":" + randomstring.generate();
    }
    //get task id by task run id
    public async TaskidbytaskrunNum(taskrunNum: string): Promise<{ id: number; task_id: number } | null> {
        const taskrunmodel = new TaskRunModel(this.dbpath)
        return await taskrunmodel.getTaskidbytaskrunNum(taskrunNum)
    }
    //get social task run list
    public async getrunlist(taskId: number, page: number, size: number): Promise<taskrunSearchres> {
        const taskrunmodel = new TaskRunModel(this.dbpath)
        const total = await taskrunmodel.getTaskrunTotal(taskId)
        const list = await taskrunmodel.getTaskrunlist(taskId, page, size)
        return {
            Total: total,
            Records: list
        }
    }
}

import { getApplogpath, getdate } from "@/modules/lib/function"
import { Taskrundb } from "@/model/taskrundb"
// import { v4 as uuidv4 } from 'uuid';
import * as randomstring from "randomstring";
import { SocialTaskRunEntity } from "@/entityTypes/socialtask-type"
import path from "path";
import { TaskRunEntity } from "@/entityTypes/taskrun-type";
import { Token } from "@/modules/token"
import { USERSDBPATH } from '@/config/usersetting';
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
    public createsocialtaskrun(socailtaskId: number, taskrunNum: string): SocialTaskRunEntity {
        const taskrunmodel = new Taskrundb(this.dbpath)
        const logfile = this.getlogfile(socailtaskId)
        const res = taskrunmodel.checkTaskrunExist(socailtaskId, taskrunNum, (res) => {
            if (res) {
                throw new Error("task run number exist")
            }
        })
        const taskentity: TaskRunEntity = {
            task_id: socailtaskId,
            taskrun_num: taskrunNum,
            log_path: logfile
        }
        // const taskrunNum = this.gentaskrunNum(socailtaskId)
        taskrunmodel.saveTaskrun(taskentity)
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
    public TaskidbytaskrunNum(taskrunNum: string, callback: (arg: any) => void | undefined | null) {
        const taskrunmodel = new Taskrundb(this.dbpath)
        taskrunmodel.getTaskidbytaskrunNum(taskrunNum, callback)
    }
    //get social task run list
    public getrunlist(taskId: number, page: number, size: number, callback?: (arg: any) => void | undefined | null): taskrunSearchres {
        const taskrunmodel = new Taskrundb(this.dbpath)
        const total = taskrunmodel.getTaskrunTotal(taskId)
        const list = taskrunmodel.getTaskrunlist(taskId, page, size, callback)
        return {
            Total: total,
            Records: list
        }
    }
}

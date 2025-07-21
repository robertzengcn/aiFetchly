import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { TaskRunEntity } from "@/entity/TaskRun.entity";
import { TaskRunEntity as TaskRunType } from "@/entityTypes/taskrun-type";

export class TaskRunModel extends BaseDb {
    private repository: Repository<TaskRunEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(TaskRunEntity);
    }

    /**
     * Save task run
     */
    async saveTaskrun(taskrun: TaskRunEntity): Promise<number> {
        // const taskRunEntity = new TaskRunEntity();
        // taskRunEntity.task_id = taskrun.task_id;
        // taskRunEntity.log_path = taskrun.log_path;
        // taskRunEntity.record_time = new Date().toISOString();
        // taskRunEntity.status = taskrun.status ?? 0;

        const savedTaskRun = await this.repository.save(taskrun);
        return savedTaskRun.id;
    }

    /**
     * Get task id by task run number
     */
    async getTaskidbytaskrunNum(taskrunNum: string): Promise<{ id: number, task_id: number } | null> {
        const taskRun = await this.repository.findOne({
            where: { taskrun_num: taskrunNum },
            select: ['id', 'task_id']
        });
        return taskRun ? { id: taskRun.id, task_id: taskRun.task_id } : null;
    }

    /**
     * Check if task id and task run number exist
     */
    async checkTaskrunExist(taskid: number, taskrunNum: string): Promise<boolean> {
        const count = await this.repository.count({
            where: { task_id: taskid, taskrun_num: taskrunNum }
        });
        return count > 0;
    }

    /**
     * Get task run list with pagination
     */
    async getTaskrunlist(taskId: number, page: number, size: number): Promise<TaskRunType[]> {
        const taskRuns = await this.repository.find({
            where: { task_id: taskId },
            order: { id: 'DESC' },
            skip: page,
            take: size
        });
        return taskRuns as unknown as TaskRunType[];
    }

    /**
     * Get total number of task runs for a task
     */
    async getTaskrunTotal(taskId: number): Promise<number> {
        return await this.repository.count({
            where: { task_id: taskId }
        });
    }

    /**
     * Truncate the database table
     */
    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 
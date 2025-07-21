import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailMarketingTaskEntity } from "@/entity/EmailMarketingTask.entity";
import { EmailMarketingTaskdbEntity, EmailMarketingTaskStatus } from "./emailMarketingTaskdb";
import { getRecorddatetime } from "@/modules/lib/function";
import { TaskStatus } from "@/entityTypes/commonType";
export class EmailMarketingTaskModel extends BaseDb {
    private repository: Repository<EmailMarketingTaskEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailMarketingTaskEntity);
    }

    async createTask(task: EmailMarketingTaskdbEntity): Promise<number> {
        const entity = new EmailMarketingTaskEntity();
        entity.status = task.status;
        entity.record_time = task.record_time || getRecorddatetime();

        const savedEntity = await this.repository.save(entity);
        return savedEntity.id;
    }

    async getTaskById(id: number): Promise<EmailMarketingTaskdbEntity | null> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return null;

        return {
            id: entity.id,
            status: entity.status,
            record_time: entity.record_time
        };
    }

    async updateTask(task: EmailMarketingTaskdbEntity): Promise<void> {
        if (!task.id) {
            throw new Error("Task ID is required for update");
        }

        const entity = await this.repository.findOne({ where: { id: task.id } });
        if (!entity) return;

        entity.status = task.status;
        entity.record_time = task.record_time || getRecorddatetime();

        await this.repository.save(entity);
    }
    //update task status by id
    async updateTaskStatusById(id: number, status: TaskStatus): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;
        entity.status = status;
        await this.repository.save(entity);
    }

    async deleteTask(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    async updateTaskStatus(id: number, status: EmailMarketingTaskStatus): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = status;
        await this.repository.save(entity);
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
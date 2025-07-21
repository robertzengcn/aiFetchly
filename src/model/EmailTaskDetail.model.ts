import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailMarketingTaskDetailEntity } from "@/entity/EmailMarketingTaskDetail.entity";
// import { EmailMarketingTaskType } from "@/entityTypes/emailmarketingType";

export class EmailTaskDetailModel extends BaseDb {
    private repository: Repository<EmailMarketingTaskDetailEntity>;

    constructor(dbpath: string) {
        super(dbpath);
        this.repository = this.sqliteDb.connection.getRepository(EmailMarketingTaskDetailEntity);
    }

    async create(emailTaskDetail: EmailMarketingTaskDetailEntity): Promise<number> {
        const result = await this.repository.save(emailTaskDetail);
        return result.id;
    }

    async read(id: number): Promise<EmailMarketingTaskDetailEntity | null> {
        return await this.repository.findOne({
            where: { id }
        });
    }

    async update(emailTaskDetail: EmailMarketingTaskDetailEntity): Promise<boolean> {
        const result = await this.repository.update(emailTaskDetail.id, emailTaskDetail);
        return result.affected !== undefined && result.affected > 0;
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return result.affected !== undefined && result.affected?true:false;
    }

    async getItemsByTaskId(taskId: number): Promise<EmailMarketingTaskDetailEntity[]> {
        return await this.repository.find({
            where: { task_id: taskId }
        });
    }

   
} 
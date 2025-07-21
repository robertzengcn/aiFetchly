import { BaseDb } from "@/model/Basedb";
import { Repository, Like } from "typeorm";
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
//import { EmailMarketingSendLogEntity as EmailMarketingSendLogInterface } from "./emailMarketingSendLogdb";
import { SortBy } from "@/entityTypes/commonType";
import { getRecorddatetime } from "@/modules/lib/function";
export enum SendStatus {
    Success = 1,
    Failure = 0,
  }

export class EmailMarketingSendLogModel extends BaseDb {
    private repository: Repository<EmailMarketingSendLogEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailMarketingSendLogEntity);
    }

    async create(task: EmailMarketingSendLogEntity): Promise<number> {
        // const entity = new EmailMarketingSendLogEntity();
        // entity.status = task.status;
        // entity.task_id = task.task_id;
        // entity.receiver = task.receiver;
        // entity.title = task.title;
        // entity.content = task.content;
        // entity.record_time = task.record_time || getRecorddatetime();
        // entity.log = task.log || "";
        if(!task.record_time){
            task.record_time=getRecorddatetime();
        }

        const savedEntity = await this.repository.save(task);
        return savedEntity.id;
    }

    async read(id: number): Promise<EmailMarketingSendLogEntity | null> {
        return await this.repository.findOne({ where: { id } });
    }

    async update(id: number, task: EmailMarketingSendLogEntity): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = task.status;
        entity.task_id = task.task_id;
        entity.receiver = task.receiver;
        entity.title = task.title;
        entity.content = task.content;
        entity.record_time = task.record_time || getRecorddatetime();
        entity.log = task.log || "";

        await this.repository.save(entity);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

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

    async listEmailMarketingSendLog(taskid: number, page: number, limit: number, where?: string, sort?: SortBy): Promise<EmailMarketingSendLogEntity[]> {
        let queryBuilder = this.repository.createQueryBuilder('log')
            .where('log.task_id = :taskid', { taskid });

        if (where) {
            queryBuilder = queryBuilder.andWhere(
                '(log.receiver LIKE :search OR log.title LIKE :search OR log.content LIKE :search)',
                { search: `%${where}%` }
            );
        }

        if (sort?.key && sort?.order) {
            const lowsersortkey = sort.key.toLowerCase();
            const lowsersortorder = sort.order.toLowerCase();
            const allowsortkey = ['id', 'record_time', 'status'];
            const allowsortorder = ['asc', 'desc'];

            if (!allowsortkey.includes(lowsersortkey)) {
                throw new Error("not allow sort key");
            }
            if (!allowsortorder.includes(lowsersortorder)) {
                throw new Error("not allow sort order");
            }

            queryBuilder = queryBuilder.orderBy(`log.${lowsersortkey}`, lowsersortorder.toUpperCase() as 'ASC' | 'DESC');
        } else {
            queryBuilder = queryBuilder.orderBy('log.id', 'DESC');
        }

        queryBuilder = queryBuilder.skip(page).take(limit);
        return await queryBuilder.getMany();
    }

    async countEmailMarketingSendLog(taskid: number, where?: string): Promise<number> {
        let queryBuilder = this.repository.createQueryBuilder('log')
            .where('log.task_id = :taskid', { taskid });

        if (where) {
            queryBuilder = queryBuilder.andWhere(
                '(log.receiver LIKE :search OR log.title LIKE :search OR log.content LIKE :search)',
                { search: `%${where}%` }
            );
        }

        return await queryBuilder.getCount();
    }
} 
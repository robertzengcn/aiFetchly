import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";

export class EmailsearchResultModel extends BaseDb {
    private repository: Repository<EmailSearchResultEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailSearchResultEntity);
    }

    async create(emailsearchResult: EmailSearchResultEntity): Promise<number> {
        const item = await this.getByTaskIdUrl(emailsearchResult.task_id, emailsearchResult.email);
        if (item) {
            return item.id;
        }

        const savedResult = await this.repository.save(emailsearchResult);
        return savedResult.id;
    }

    async read(id: number): Promise<EmailSearchResultEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(id: number, emailsearchResult: EmailSearchResultEntity): Promise<boolean> {
        const result = await this.repository.update(id, emailsearchResult);
        return result.affected?true:false
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return result.affected?true:false
    }

    async getByTaskIdUrl(taskId: number, email: string): Promise<EmailSearchResultEntity | null> {
        return this.repository.findOne({ where: { task_id: taskId, email } });
    }

    async getTaskResult(taskId: number, page: number, size: number): Promise<EmailSearchResultEntity[]> {
        return this.repository.find({
            where: { task_id: taskId },
            skip: page,
            take: size
        });
    }

    async getTaskResultCount(taskId: number): Promise<number> {
        return this.repository.count({ where: { task_id: taskId } });
    }

    async countAll(): Promise<number> {
        return this.repository.count();
    }

    async countByDateRange(startDate: Date, endDate: Date): Promise<number> {
        return this.repository.createQueryBuilder('result')
            .where('result.record_time >= :startDate', { startDate: startDate.toISOString() })
            .andWhere('result.record_time <= :endDate', { endDate: endDate.toISOString() })
            .getCount();
    }

    async aggregateByDateRange(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<Array<{ date: string; count: number }>> {
        const dateExpression = this.getDateExpression(granularity, 'result.record_time');
        const rows = await this.repository.createQueryBuilder('result')
            .select(dateExpression, 'date')
            .addSelect('COUNT(*)', 'count')
            .where('result.record_time >= :startDate', { startDate: startDate.toISOString() })
            .andWhere('result.record_time <= :endDate', { endDate: endDate.toISOString() })
            .groupBy(dateExpression)
            .orderBy(dateExpression, 'ASC')
            .getRawMany();

        return rows.map((row: { date: string; count: string }) => ({
            date: row.date,
            count: parseInt(row.count, 10)
        }));
    }

    private getDateExpression(granularity: 'day' | 'week' | 'month', column: string): string {
        switch (granularity) {
            case 'week':
                return `STRFTIME('%Y-%W', ${column})`;
            case 'month':
                return `STRFTIME('%Y-%m', ${column})`;
            case 'day':
            default:
                return `DATE(${column})`;
        }
    }
} 
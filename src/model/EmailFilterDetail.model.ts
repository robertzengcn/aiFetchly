import { Repository } from "typeorm";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";

export class EmailFilterDetailModel {
    private repository: Repository<EmailFilterDetailEntity>;
    
    constructor(filepath: string) {
        const db = SqliteDb.getInstance(filepath);
        this.repository = db.connection.getRepository(EmailFilterDetailEntity);
    }
    
    async create(detail: EmailFilterDetailEntity): Promise<number> {
        const result = await this.repository.save(detail);
        return result.id;
    }

    async read(id: number): Promise<EmailFilterDetailEntity | undefined> {
        const result = await this.repository.findOne({ where: { id } });
        return result || undefined;
    }

    async update(id: number, detail: EmailFilterDetailEntity): Promise<void> {
        await this.repository.update(id, detail);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    async getEmailFilterDetailsByFilterId(filterId: number): Promise<EmailFilterDetailEntity[]> {
        return await this.repository.find({
            where: { filter_id: filterId },
            order: { id: 'ASC' }
        });
    }

    async updateEmailFilterDetailsByFilterId(filterId: number, details: EmailFilterDetailEntity[]): Promise<void> {
        // First delete existing details for this filter
        await this.deleteEmailFilterDetailsByFilterId(filterId);
        
        // Then insert new details
        for (const detail of details) {
            detail.filter_id = filterId;
            await this.repository.save(detail);
        }
    }

    async deleteEmailFilterDetailsByFilterId(filterId: number): Promise<void> {
        await this.repository.delete({ filter_id: filterId });
    }

    async listEmailFilterDetails(page: number, size: number): Promise<EmailFilterDetailEntity[]> {
        return await this.repository.find({
            skip: page,
            take: size,
            order: { id: 'ASC' }
        });
    }

    async countEmailFilterDetails(): Promise<number> {
        return await this.repository.count();
    }

    async countEmailFilterDetailsByFilterId(filterId: number): Promise<number> {
        return await this.repository.count({ where: { filter_id: filterId } });
    }
} 
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailSearchResultDetailEntity } from "@/entity/EmailSearchResultDetail.entity";

export class EmailsearchResultDetailModel extends BaseDb {
    private repository: Repository<EmailSearchResultDetailEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailSearchResultDetailEntity);
    }

    async create(emailsearchResultDetail: EmailSearchResultDetailEntity): Promise<number> {
        //trim blank space in email value
        emailsearchResultDetail.email = emailsearchResultDetail.email.trim();
        
        //check if item exists
        const item = await this.readItem(emailsearchResultDetail.result_id, emailsearchResultDetail.email);
        if (item) {
            return item.id;
        }

        const savedResult = await this.repository.save(emailsearchResultDetail);
        return savedResult.id;
    }

    async read(id: number): Promise<EmailSearchResultDetailEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(emailsearchResultDetail: EmailSearchResultDetailEntity): Promise<boolean> {
        const result = await this.repository.update(emailsearchResultDetail.id, emailsearchResultDetail);
        return result.affected ? true : false;
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return result.affected ? true : false;
    }

    async readItem(result_id: number, email: string): Promise<EmailSearchResultDetailEntity | null> {
        return this.repository.findOne({ where: { result_id, email } });
    }

    async getItemsByResultId(result_id: number): Promise<EmailSearchResultDetailEntity[]> {
        return this.repository.find({ where: { result_id } });
    }

    async getTaskResultCount(result_id: number): Promise<number> {
        return this.repository.count({ where: { result_id } });
    }
} 
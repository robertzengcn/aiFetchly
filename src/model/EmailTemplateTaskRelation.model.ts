import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailTemplateTaskRelationEntity } from "@/entity/EmailTemplateTaskRelation.entity";
//import { EmailTemplateTaskRelationEntity as EmailTemplateTaskRelationEntityType, EmailTemplateWithRelation } from "./emailTemplateTaskRelationdb";
import { SortBy } from "@/entityTypes/commonType";

export class EmailTemplateTaskRelationModel extends BaseDb {
    private repository: Repository<EmailTemplateTaskRelationEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailTemplateTaskRelationEntity);
    }

    async create(relation: EmailTemplateTaskRelationEntity): Promise<number> {
        const entity = new EmailTemplateTaskRelationEntity();
        entity.emailTemplateId = relation.emailTemplateId;
        entity.buckemailTaskId = relation.buckemailTaskId;
        entity.status = relation.status || 1;

        const savedEntity = await this.repository.save(entity);
        return savedEntity.id;
    }

    async read(id: number): Promise<EmailTemplateTaskRelationEntity | undefined> {
        const entity = await this.repository.findOne({ where: { id } });
       if (!entity) return undefined;

        return entity;
    }

    async update(id: number, relation: EmailTemplateTaskRelationEntity): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.emailTemplateId = relation.emailTemplateId;
        entity.buckemailTaskId = relation.buckemailTaskId;
        entity.status = relation.status || 1;

        await this.repository.save(entity);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    async updateRelationStatus(id: number, status: number): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = status;
        await this.repository.save(entity);
    }

    async listRelations(page: number, size: number, sort?: SortBy): Promise<EmailTemplateTaskRelationEntity[]> {
        let queryBuilder = this.repository.createQueryBuilder('relation');

        if (sort?.key && sort?.order) {
            const lowsersortkey = sort.key.toLowerCase();
            const lowsersortorder = sort.order.toLowerCase();
            const allowsortkey = ['id', 'emailTemplateId', 'buckemailTaskId', 'status', 'createdAt'];
            const allowsortorder = ['asc', 'desc'];

            if (!allowsortkey.includes(lowsersortkey)) {
                throw new Error("not allow sort key");
            }
            if (!allowsortorder.includes(lowsersortorder)) {
                throw new Error("not allow sort order");
            }

            queryBuilder = queryBuilder.orderBy(`relation.${lowsersortkey}`, lowsersortorder.toUpperCase() as 'ASC' | 'DESC');
        } else {
            queryBuilder = queryBuilder.orderBy('relation.id', 'DESC');
        }

        queryBuilder = queryBuilder.skip(page).take(size);
        const entities = await queryBuilder.getMany();

        return entities;
    }

    async countRelations(): Promise<number> {
        return await this.repository.count();
    }

    async getEmailTemplatesByBuckemailTaskId(buckemailTaskId: number): Promise<EmailTemplateTaskRelationEntity[]> {
        return await this.repository.find({ where: { buckemailTaskId } });
    }

    async deleteByBuckemailTaskId(buckemailTaskId: number): Promise<void> {
        await this.repository.delete({ buckemailTaskId });
    }

    async updateByBuckemailTaskId(buckemailTaskId: number, relations: EmailTemplateTaskRelationEntity[]): Promise<void> {
        await this.repository.delete({ buckemailTaskId });
        const entities = relations.map(r => {
            const entity = new EmailTemplateTaskRelationEntity();
            entity.emailTemplateId = r.emailTemplateId;
            entity.buckemailTaskId = buckemailTaskId;
            entity.status = r.status || 1;
            return entity;
        });
        await this.repository.save(entities);
    }

    async findByTemplateAndTask(emailTemplateId: number, buckemailTaskId: number): Promise<EmailTemplateTaskRelationEntity | undefined> {
        const entity = await this.repository.findOne({ 
            where: { emailTemplateId, buckemailTaskId }
        });
        
        if (!entity) return undefined;

        return entity;
    }
} 
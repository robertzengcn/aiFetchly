import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailFilterTaskRelationEntity } from "@/entity/EmailFilterTaskRelation.entity";

export interface EmailFilterTaskRelationEntityType {
    id?: number;
    emailFilterId: number;
    buckemailTaskId: number;
    status?: number;
    createdAt?: Date;
    updatedAt?: Date;
}

export class EmailFilterTaskRelationModel extends BaseDb {
    private repository: Repository<EmailFilterTaskRelationEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailFilterTaskRelationEntity);
    }

    async create(relation: EmailFilterTaskRelationEntityType): Promise<number> {
        const entity = new EmailFilterTaskRelationEntity();
        entity.emailFilterId = relation.emailFilterId;
        entity.buckemailTaskId = relation.buckemailTaskId;
        entity.status = relation.status || 1;
        const savedEntity = await this.repository.save(entity);
        return savedEntity.id;
    }

    async getEmailFiltersByBuckemailTaskId(buckemailTaskId: number): Promise<EmailFilterTaskRelationEntity[]> {
        return await this.repository.find({ where: { buckemailTaskId } });
    }

    async updateByBuckemailTaskId(buckemailTaskId: number, relations: EmailFilterTaskRelationEntityType[]): Promise<void> {
        await this.repository.delete({ buckemailTaskId });
        const entities = relations.map(r => {
            const entity = new EmailFilterTaskRelationEntity();
            entity.emailFilterId = r.emailFilterId;
            entity.buckemailTaskId = buckemailTaskId;
            entity.status = r.status || 1;
            return entity;
        });
        await this.repository.save(entities);
    }

    async deleteByBuckemailTaskId(buckemailTaskId: number): Promise<void> {
        await this.repository.delete({ buckemailTaskId });
    }
} 
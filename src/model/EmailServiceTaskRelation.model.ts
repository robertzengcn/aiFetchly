import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailServiceTaskRelationEntity } from "@/entity/EmailServiceTaskRelation.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";

export class EmailServiceTaskRelationModel extends BaseDb {
    private repository: Repository<EmailServiceTaskRelationEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailServiceTaskRelationEntity);
    }

    async create(relation: EmailServiceTaskRelationEntity): Promise<number> {
        const savedEntity = await this.repository.save(relation);
        return savedEntity.id;
    }

    async read(id: number): Promise<EmailServiceTaskRelationEntity | undefined> {
        const entity = await this.repository.findOne({ 
            where: { id },
            relations: ['emailService', 'buckemailTask']
        });
        if (!entity) return undefined;

        return entity;
    }

    async update(id: number, relation: EmailServiceTaskRelationEntity): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        Object.assign(entity, relation);
        await this.repository.save(entity);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    async getEmailServicesByTaskId(buckemailTaskId: number): Promise<EmailServiceEntity[]> {
        const relations = await this.repository.find({
            where: { buckemailTaskId, status: 1 },
            relations: ['emailService'],
            order: { id: 'DESC' }
        });

        return relations.map(relation => relation.emailService);
    }

    async updateEmailServicesByTaskId(buckemailTaskId: number, emailServiceIds: number[]): Promise<void> {
        // First, delete existing relations for this task
        await this.repository.delete({ buckemailTaskId });

        // Then create new relations
        for (const emailServiceId of emailServiceIds) {
            const relation = new EmailServiceTaskRelationEntity();
            relation.emailServiceId = emailServiceId;
            relation.buckemailTaskId = buckemailTaskId;
            relation.status = 1;
            await this.repository.save(relation);
        }
    }

    async deleteEmailServicesByTaskId(buckemailTaskId: number): Promise<void> {
        await this.repository.delete({ buckemailTaskId });
    }

    async getTaskIdsByEmailServiceId(emailServiceId: number): Promise<number[]> {
        const relations = await this.repository.find({
            where: { emailServiceId, status: 1 },
            select: ['buckemailTaskId']
        });

        return relations.map(relation => relation.buckemailTaskId);
    }

    async checkRelationExists(emailServiceId: number, buckemailTaskId: number): Promise<boolean> {
        const count = await this.repository.count({
            where: { emailServiceId, buckemailTaskId, status: 1 }
        });
        return count > 0;
    }

    async addEmailServiceToTask(emailServiceId: number, buckemailTaskId: number): Promise<number> {
        const relation = new EmailServiceTaskRelationEntity();
        relation.emailServiceId = emailServiceId;
        relation.buckemailTaskId = buckemailTaskId;
        relation.status = 1;

        const savedEntity = await this.repository.save(relation);
        return savedEntity.id;
    }

    async removeEmailServiceFromTask(emailServiceId: number, buckemailTaskId: number): Promise<void> {
        await this.repository.delete({ emailServiceId, buckemailTaskId });
    }

    async updateRelationStatus(id: number, status: number): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = status;
        await this.repository.save(entity);
    }
} 
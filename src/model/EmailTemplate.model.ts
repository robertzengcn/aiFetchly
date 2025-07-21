import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { EmailTemplateEntity as EmailTemplateEntityType } from "@/entity/EmailTemplate.entity";
import { SortBy } from "@/entityTypes/commonType";

export class EmailTemplateModel extends BaseDb {
    private repository: Repository<EmailTemplateEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailTemplateEntity);
    }

    async create(template: EmailTemplateEntityType): Promise<number> {
        const entity = new EmailTemplateEntity();
        entity.title = template.title;
        entity.content = template.content;
        entity.description = template.description;
        entity.status = template.status || 1;

        const savedEntity = await this.repository.save(entity);
        return savedEntity.id;
    }

    async read(id: number): Promise<EmailTemplateEntityType | undefined> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return undefined;

        return entity;

        // return {
        //     id: entity.id,
        //     title: entity.title,
        //     content: entity.content,
        //     description: entity.description,
        //     status: entity.status,
        //     createdAt: entity.createdAt,
        //     updatedAt: entity.updatedAt
        // };
    }

    async update(id: number, template: EmailTemplateEntityType): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.title = template.title;
        entity.content = template.content;
        entity.description = template.description;
        entity.status = template.status || 1;

        await this.repository.save(entity);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    async updateTemplateStatus(id: number, status: number): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = status;
        await this.repository.save(entity);
    }

    async listEmailTemplates(page: number, size: number, search?: string,sort?: SortBy): Promise<EmailTemplateEntityType[]> {
        let queryBuilder = this.repository.createQueryBuilder('template');

        if (sort?.key && sort?.order) {
            const lowsersortkey = sort.key.toLowerCase();
            const lowsersortorder = sort.order.toLowerCase();
            const allowsortkey = ['id', 'title', 'status', 'createdAt'];
            const allowsortorder = ['asc', 'desc'];

            if (!allowsortkey.includes(lowsersortkey)) {
                throw new Error("not allow sort key");
            }
            if (!allowsortorder.includes(lowsersortorder)) {
                throw new Error("not allow sort order");
            }

            queryBuilder = queryBuilder.orderBy(`template.${lowsersortkey}`, lowsersortorder.toUpperCase() as 'ASC' | 'DESC');
        } else {
            queryBuilder = queryBuilder.orderBy('template.id', 'DESC');
        }
        if (search) {
            queryBuilder = queryBuilder.where('template.title LIKE :search', { search: `%${search}%` });
        }

        queryBuilder = queryBuilder.skip(page).take(size);
        const entities = await queryBuilder.getMany();

        return entities;
    }

    async countEmailTemplates(): Promise<number> {
        return await this.repository.count();
    }
} 
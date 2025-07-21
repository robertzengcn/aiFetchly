import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";
//import { EmailFilterEntity as EmailFilterEntityType } from "./emailFilterTaskdb";
import { SortBy } from "@/entityTypes/commonType";

export class EmailFilterModel extends BaseDb {
    private repository: Repository<EmailFilterEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailFilterEntity);
    }

    async create(entity: EmailFilterEntity): Promise<number> {
        // const entity = new EmailFilterEntity();
        // entity.name = filter.name;
        // // entity.content = filter.content;
        // entity.description = filter.description;
        // entity.status = filter.status || 1;

        const savedEntity = await this.repository.save(entity);
        return savedEntity.id;
    }

    async read(id: number): Promise<EmailFilterEntity | undefined> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return undefined;
        return entity;
        //         return {
        //             id: entity.id,
        //             name: entity.name,
        //             // content: entity.content,
        //             description: entity.description,
        //     status: entity.status,
        //     createdAt: entity.createdAt,
        //     updatedAt: entity.updatedAt
        // };
    }

    async update(id: number, filter: EmailFilterEntity): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.name = filter.name;
        // entity.content = filter.content;
        entity.description = filter.description;
        entity.status = filter.status || 1;

        await this.repository.save(entity);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    async updateFilterStatus(id: number, status: number): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = status;
        await this.repository.save(entity);
    }

    async listEmailFilters(page: number, size: number, search?: string,sort?: SortBy): Promise<EmailFilterEntity[]> {
        let queryBuilder = this.repository.createQueryBuilder('filter');
        if (search) {
            queryBuilder = queryBuilder.where('filter.name LIKE :search', { search: `%${search}%` });
        }
        if (sort?.key && sort?.order) {
            const lowsersortkey = sort.key.toLowerCase();
            const lowsersortorder = sort.order.toLowerCase();
            const allowsortkey = ['id', 'name', 'status', 'createdAt'];
            const allowsortorder = ['asc', 'desc'];

            if (!allowsortkey.includes(lowsersortkey)) {
                throw new Error("not allow sort key");
            }
            if (!allowsortorder.includes(lowsersortorder)) {
                throw new Error("not allow sort order");
            }

            queryBuilder = queryBuilder.orderBy(`filter.${lowsersortkey}`, lowsersortorder.toUpperCase() as 'ASC' | 'DESC');
        } else {
            queryBuilder = queryBuilder.orderBy('filter.id', 'DESC');
        }

        queryBuilder = queryBuilder.skip(page).take(size);
        const entities = await queryBuilder.getMany();
        return entities;
        // return entities.map(entity => ({
        //     id: entity.id,
        //     name: entity.name,
        //     content: entity.content,
        //     description: entity.description,
        //     status: entity.status,
        //     createdAt: entity.createdAt,
        //     updatedAt: entity.updatedAt
        // }));
    }

    async countEmailFilters(): Promise<number> {
        return await this.repository.count();
    }
} 
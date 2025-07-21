import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { SortBy } from "@/entityTypes/commonType";

export class EmailServiceModel extends BaseDb {
    private repository: Repository<EmailServiceEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailServiceEntity);
    }

    async create(entity: EmailServiceEntity): Promise<number> {     
        const savedEntity = await this.repository.save(entity);
        return savedEntity.id;
    }

    async read(id: number): Promise<EmailServiceEntity | undefined> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return undefined;

        return entity;
    }

    async update(id: number, service: EmailServiceEntity): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        Object.assign(entity, service);

        await this.repository.save(entity);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    async updateServiceStatus(id: number, status: number): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = status;
        await this.repository.save(entity);
    }

    async listEmailServices(page: number, size: number, search?: string,sort?: SortBy): Promise<EmailServiceEntity[]> {
        let queryBuilder = this.repository.createQueryBuilder('service');
        if (search) {
            queryBuilder = queryBuilder.where('service.name LIKE :search', { search: `%${search}%` });
        }
        if (sort?.key && sort?.order) {
            const lowsersortkey = sort.key.toLowerCase();
            const lowsersortorder = sort.order.toLowerCase();
            const allowsortkey = ['id', 'name', 'host', 'status', 'createdAt'];
            const allowsortorder = ['asc', 'desc'];

            if (!allowsortkey.includes(lowsersortkey)) {
                throw new Error("not allow sort key");
            }
            if (!allowsortorder.includes(lowsersortorder)) {
                throw new Error("not allow sort order");
            }

            queryBuilder = queryBuilder.orderBy(`service.${lowsersortkey}`, lowsersortorder.toUpperCase() as 'ASC' | 'DESC');
        } else {
            queryBuilder = queryBuilder.orderBy('service.id', 'DESC');
        }

        queryBuilder = queryBuilder.skip(page).take(size);
        const entities = await queryBuilder.getMany();

        return entities;
    }

    async countEmailServices(): Promise<number> {
        return await this.repository.count();
    }

    async findByName(name: string): Promise<EmailServiceEntity | undefined> {
        const entity = await this.repository.findOne({ where: { name } });
        if (!entity) return undefined;

        return entity;
    }

    async findByHost(host: string): Promise<EmailServiceEntity[]> {
        const entities = await this.repository.find({ 
            where: { host },
            order: { id: 'DESC' }
        });

        return entities;
    }
} 
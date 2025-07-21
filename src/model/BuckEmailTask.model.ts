import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { BuckemailTaskEntity } from "@/entity/BuckemailTask.entity";
import { BuckemailEntity, BuckEmailType } from "./buckEmailTaskdb";
import { TaskStatus } from "@/entityTypes/commonType";
import { SortBy } from "@/entityTypes/commonType";
import { getRecorddatetime, getStatusName } from "@/modules/lib/function";

export class BuckEmailTaskModel extends BaseDb {
    private repository: Repository<BuckemailTaskEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(BuckemailTaskEntity);
    }

    async create(task: BuckemailTaskEntity): Promise<number> {
        // const entity = new BuckemailTaskEntity();
        // entity.type = task.type;
        // entity.status = task.status || TaskStatus.Processing;
        // entity.record_time = task.record_time || getRecorddatetime();
        // entity.log_file = task.log_file;
        // entity.error_file = task.error_file;

        const savedEntity = await this.repository.save(task);
        return savedEntity.id;
    }

    async read(id: number): Promise<BuckemailTaskEntity | undefined> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return undefined;

        return entity;
    }

    async update(id: number, task: BuckemailEntity): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.type = task.type;
        entity.record_time = task.record_time || getRecorddatetime();
        entity.status = task.status || TaskStatus.Processing;
        entity.log_file = task.log_file;
        entity.error_file = task.error_file;

        await this.repository.save(entity);
    }

    async delete(id: number): Promise<void> {
        await this.repository.delete(id);
    }

    getBuckEmailStatusName(taskStatus: TaskStatus): string {
        return getStatusName(taskStatus);
    }

    // async updateTaskStatusById(id: number, status: TaskStatus): Promise<void> {
    //     const entity = await this.repository.findOne({ where: { id } });
    //     if (!entity) return;
    //     entity.status = status;
    //     await this.repository.save(entity);
    // }
    async updateTaskLogfile(id: number, runtimeLog: string, errorLog: string): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.log_file = runtimeLog;
        entity.error_file = errorLog;
        await this.repository.save(entity);
    }

    async updateTaskStatus(id: number, status: TaskStatus): Promise<void> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return;

        entity.status = status;
        await this.repository.save(entity);
    }

    async listBuckEmailtask(page: number, size: number, sort?: SortBy): Promise<BuckemailEntity[]> {
        let queryBuilder = this.repository.createQueryBuilder('task');

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

            queryBuilder = queryBuilder.orderBy(`task.${lowsersortkey}`, lowsersortorder.toUpperCase() as 'ASC' | 'DESC');
        } else {
            queryBuilder = queryBuilder.orderBy('task.id', 'DESC');
        }

        queryBuilder = queryBuilder.skip(page).take(size);
        const entities = await queryBuilder.getMany();

        return entities.map(entity => ({
            id: entity.id,
            type: entity.type,
            record_time: entity.record_time,
            log_file: entity.log_file,
            error_file: entity.error_file,
            status: entity.status
        }));
    }

    async countBuckEmailTask(): Promise<number> {
        return await this.repository.count();
    }

    getBuckEmailTypeName(type: BuckEmailType): string {
        switch (type) {
            case BuckEmailType.EXTRACTEMAIL:
                return "Extract Email";
            default:
                return "Unknown";
        }
    }
} 
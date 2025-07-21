import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { VideoDownloadTaskAccountsEntity } from "@/entity/VideoDownloadTaskAccounts.entity";

export class VideoDownloadTaskAccountModel extends BaseDb {
    private repository: Repository<VideoDownloadTaskAccountsEntity>;
    
    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadTaskAccountsEntity);
    }

    async create(vdte: VideoDownloadTaskAccountsEntity): Promise<number> {
        const result = await this.repository.save(vdte);
        return result.id;
    }

    async read(id: number): Promise<VideoDownloadTaskAccountsEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(id: number, taskAccount: VideoDownloadTaskAccountsEntity): Promise<number> {
        const result = await this.repository.update(id, taskAccount);
        return result.affected || 0;
    }

    async delete(id: number): Promise<number> {
        const result = await this.repository.delete(id);
        return result.affected || 0;
    }

    async getAccountByTaskId(taskId: number): Promise<VideoDownloadTaskAccountsEntity[]> {
        return this.repository.find({ where: { task_id: taskId } });
    }
} 
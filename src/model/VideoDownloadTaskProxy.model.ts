import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { VideoDownloadTaskProxyEntity } from "@/entity/VideoDownloadTaskProxy.entity";

export class VideoDownloadTaskProxyModel extends BaseDb {
    private repository: Repository<VideoDownloadTaskProxyEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadTaskProxyEntity);
    }

    async create(vdte: VideoDownloadTaskProxyEntity): Promise<number> {
        const result = await this.repository.save(vdte);
        return result.id;
    }

    async read(id: number): Promise<VideoDownloadTaskProxyEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(id: number, vdte: VideoDownloadTaskProxyEntity): Promise<number> {
        const result = await this.repository.update(id, vdte);
        return result.affected || 0;
    }

    async delete(id: number): Promise<number> {
        const result = await this.repository.delete(id);
        return result.affected || 0;
    }

    async getItemsByTaskId(taskId: number): Promise<VideoDownloadTaskProxyEntity[]> {
        return this.repository.find({ where: { task_id: taskId } });
    }
} 
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { VideoDownloadTaskUrlsEntity } from "@/entity/VideoDownloadTaskUrls.entity";

export class VideoDownloadTaskUrlModel extends BaseDb {
    private repository: Repository<VideoDownloadTaskUrlsEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadTaskUrlsEntity);
    }

    async create(vdte: VideoDownloadTaskUrlsEntity): Promise<number> {
        const result = await this.repository.save(vdte);
        return result.id;
    }

    async read(id: number): Promise<VideoDownloadTaskUrlsEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(id: number, vdte: VideoDownloadTaskUrlsEntity): Promise<number> {
        const result = await this.repository.update(id, vdte);
        return result.affected || 0;
    }

    async delete(id: number): Promise<number> {
        const result = await this.repository.delete(id);
        return result.affected || 0;
    }

    async getItemsByTaskId(taskId: number): Promise<VideoDownloadTaskUrlsEntity[]> {
        return this.repository.find({ where: { task_id: taskId } });
    }
} 
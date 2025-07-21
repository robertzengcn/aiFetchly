import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { VideoDownloadTaskEntity } from "@/entity/VideoDownloadTask.entity";
import { getRecorddatetime } from "@/modules/lib/function";
import { TaskStatus } from "@/entityTypes/commonType";

export class VideoDownloadTaskModel extends BaseDb {
    private repository: Repository<VideoDownloadTaskEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadTaskEntity);
    }

    async saveVideoDownloadTask(videoDownloadTask: VideoDownloadTaskEntity): Promise<number> {
        videoDownloadTask.record_time = getRecorddatetime();
        if (!videoDownloadTask.status) {
            videoDownloadTask.status = 0;
        }
        const result = await this.repository.save(videoDownloadTask);
        return result.id;
    }

    async updateTasklog(taskId: number, log: string): Promise<number> {
        const result = await this.repository.update(taskId, { runtime_log: log });
        return result.affected || 0;
    }

    async updateTaskErrorlog(taskId: number, log: string): Promise<number> {
        const result = await this.repository.update(taskId, { error_log: log });
        return result.affected || 0;
    }

    async getVideoDownloadTaskList(page: number, size: number): Promise<VideoDownloadTaskEntity[]> {
        return this.repository.find({
            select: ['id', 'task_name', 'platform', 'savepath', 'record_time', 'status'],
            order: { id: 'DESC' },
            skip: page,
            take: size
        });
    }

    async countVideoDownloadTaskList(): Promise<number> {
        return this.repository.count();
    }

    async updateVideoDownloadTaskStatus(taskId: number, status: TaskStatus): Promise<boolean> {
        const result = await this.repository.update(taskId, { status });
        return result.affected ? result.affected > 0 : false;
    }

    async getVideoDownloadTask(taskId: number): Promise<VideoDownloadTaskEntity | null> {
        return this.repository.findOne({
            where: { id: taskId },
            select: ['id', 'task_name', 'platform', 'savepath', 'record_time', 'status', 'error_log', 'runtime_log']
        });
    }
} 
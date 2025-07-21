import { BaseDb } from "@/model/Basedb";
import { Repository, Not } from "typeorm";
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity";
import { VideoDownloadStatus, VideoCaptionStatus } from "@/entityTypes/videoType";
import { getRecorddatetime, getLogPath } from "@/modules/lib/function";

export class VideoDownloadModel extends BaseDb {
    private repository: Repository<VideoDownloadEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadEntity);
    }

    async saveVideoDownload(videoDownload: VideoDownloadEntity): Promise<number> {
        // Find video item by url first
        const itemres = await this.getVideobyUrl(videoDownload.url ?? "");
        if (itemres && itemres.id) {
            await this.updateVideoDownloadItem(itemres.id, videoDownload);
            return itemres.id;
        } else {
            if (!videoDownload.error_log) {
                videoDownload.error_log = getLogPath('videodownloaditem');
            }
            videoDownload.record_time = getRecorddatetime();
            if (!videoDownload.caption_status) {
                videoDownload.caption_status = VideoCaptionStatus.No;
            }
            await this.repository.save(videoDownload);
            return videoDownload.id;
        }
    }

    async saveVideoDownloadLog(logfile: string, downloadId: number): Promise<number> {
        const result = await this.repository.update(downloadId, { error_log: logfile });
        return result.affected || 0;
    }

    async updateVideoDownloadStatus(status: number, downloadId: number): Promise<number> {
        const result = await this.repository.update(downloadId, { status });
        return result.affected || 0;
    }

    async getVideoDownloadList(taskId: number, page: number, size: number, status?: VideoDownloadStatus): Promise<VideoDownloadEntity[]> {
        const where: any = { task_id: taskId };
        if (status) {
            where.status = status;
        }
        return this.repository.find({
            where,
            order: { id: 'DESC' },
            skip: page,
            take: size
        });
    }

    async countVideoDownloadList(taskId: number, status?: VideoDownloadStatus): Promise<number> {
        const where: any = { task_id: taskId };
        if (status) {
            where.status = status;
        }
        return this.repository.count({ where });
    }

    async getVideoDownloaditem(id: number): Promise<VideoDownloadEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async getVideobyUrl(url: string): Promise<VideoDownloadEntity | null> {
        return this.repository.findOne({ where: { url } });
    }

    async updateVideoDownloadItem(id: number, videoDownload: Omit<VideoDownloadEntity, "error_log">): Promise<number> {
        if (!videoDownload.record_time) {
            videoDownload.record_time = getRecorddatetime();
        }
        const result = await this.repository.update(id, videoDownload);
        return result.affected || 0;
    }

    async deleteVideoDownloadItem(id: number): Promise<number> {
        const result = await this.repository.delete(id);
        return result.affected || 0;
    }

    async updateVideoCaptionStatus(downloadId: number, status: VideoCaptionStatus): Promise<number> {
        const result = await this.repository.update(downloadId, { caption_status: status });
        return result.affected || 0;
    }

    async updateVideoErrorLogPath(downloadId: number, logpath: string): Promise<number> {
        const result = await this.repository.update(downloadId, { error_log: logpath });
        return result.affected || 0;
    }
} 
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { VideoPublishRecordEntity } from "@/entity/VideoPublishRecord.entity";
import { PublishPlatform, PublishStatus } from "@/entityTypes/videoPublishType";

export class VideoPublishModel extends BaseDb {
    private repository: Repository<VideoPublishRecordEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VideoPublishRecordEntity);
    }

    async savePublishRecord(publishRecord: VideoPublishRecordEntity): Promise<number> {
        await this.repository.save(publishRecord);
        return publishRecord.id;
    }

    async updatePublishStatus(status: PublishStatus, publishId: number): Promise<number> {
        const result = await this.repository.update(publishId, { status });
        return result.affected || 0;
    }

    async updatePlatformVideoInfo(publishId: number, platformVideoId: string, platformVideoUrl: string): Promise<number> {
        const result = await this.repository.update(publishId, {
            platform_video_id: platformVideoId,
            platform_video_url: platformVideoUrl
        });
        return result.affected || 0;
    }

    async updateErrorMessage(publishId: number, errorMessage: string): Promise<number> {
        const result = await this.repository.update(publishId, { error_message: errorMessage });
        return result.affected || 0;
    }

    async updatePlatformMetadata(publishId: number, metadata: Record<string, any>): Promise<number> {
        const result = await this.repository.update(publishId, { platform_metadata: JSON.stringify(metadata) });
        return result.affected || 0;
    }

    async getPublishRecord(id: number): Promise<VideoPublishRecordEntity | null> {
        return this.repository.findOne({
            where: { id },
            relations: ['video_download']
        });
    }

    async getPublishRecordsByVideoId(videoDownloadId: number): Promise<VideoPublishRecordEntity[]> {
        return this.repository.find({
            where: { video_download_id: videoDownloadId },
            relations: ['video_download'],
            order: { id: 'DESC' }
        });
    }

    async getPublishRecordsByStatus(status: PublishStatus,page: number = 0, size: number = 10): Promise<VideoPublishRecordEntity[]> {
        return this.repository.find({
            where: { status },
            relations: ['video_download'],
            order: { id: 'DESC' },
            skip: (page-1) * size,
            take: size
        });
    }

    async getPublishRecordsByPlatform(platform: PublishPlatform): Promise<VideoPublishRecordEntity[]> {
        return this.repository.find({
            where: { platform },
            relations: ['video_download'],
            order: { id: 'DESC' }
        });
    }

    async deletePublishRecord(id: number): Promise<number> {
        const result = await this.repository.delete(id);
        return result.affected || 0;
    }

    async countPublishRecords(status?: PublishStatus): Promise<number> {
        const queryBuilder = this.repository.createQueryBuilder('publish');

        if (status) {
            queryBuilder.where('publish.status = :status', { status });
        }

        return queryBuilder.getCount();
    }
    async getPublishRecords(page: number = 0, size: number = 10): Promise<VideoPublishRecordEntity[]> {
        return this.repository.find({
            relations: ['video_download'],
            order: { id: 'DESC' },
            skip: (page-1) * size,
            take: size
        });
    }
    // async getPublishRecords(): Promise<VideoPublishRecordEntity[]> {
    //     return this.repository.find({
    //         relations: ['video_download'],
    //         order: { id: 'DESC' }
    //     });
    // }
    async getPublishRecordsCount(): Promise<number> {
        return this.repository.count();
    }
} 
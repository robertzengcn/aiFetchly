import { VideoPublishModel } from "@/model/VideoPublish.model";
import { BaseModule } from "@/modules/baseModule";
import { VideoPublishRecordEntity } from "@/entity/VideoPublishRecord.entity";
import { PublishPlatform, PublishStatus } from "@/entityTypes/videoPublishType";
import { ListData } from "@/entityTypes/commonType";
import { PublishRecordQuery } from "@/entityTypes/videoPublishType";

export class VideoPublishModule extends BaseModule {
    private videoPublishModel: VideoPublishModel;

    constructor() {
        super();
        this.videoPublishModel = new VideoPublishModel(this.dbpath);
    }

    public async savePublishRecord(publishRecord: VideoPublishRecordEntity): Promise<number> {
        return await this.videoPublishModel.savePublishRecord(publishRecord);
    }

    public async updatePublishStatus(status: PublishStatus, publishId: number): Promise<number> {
        return await this.videoPublishModel.updatePublishStatus(status, publishId);
    }

    public async updatePlatformVideoInfo(
        publishId: number,
        platformVideoId: string,
        platformVideoUrl: string
    ): Promise<number> {
        return await this.videoPublishModel.updatePlatformVideoInfo(
            publishId,
            platformVideoId,
            platformVideoUrl
        );
    }

    public async updateErrorMessage(publishId: number, errorMessage: string): Promise<number> {
        return await this.videoPublishModel.updateErrorMessage(publishId, errorMessage);
    }

    public async updatePlatformMetadata(publishId: number, metadata: Record<string, any>): Promise<number> {
        return await this.videoPublishModel.updatePlatformMetadata(publishId, metadata);
    }

    public async getPublishRecord(id: number): Promise<VideoPublishRecordEntity | null> {
        return await this.videoPublishModel.getPublishRecord(id);
    }

    public async getPublishRecordsByVideoId(videoDownloadId: number): Promise<VideoPublishRecordEntity[]> {
        return await this.videoPublishModel.getPublishRecordsByVideoId(videoDownloadId);
    }

    public async getPublishRecordsByStatus(status: PublishStatus,page: number = 0, size: number = 10): Promise<VideoPublishRecordEntity[]> {
        return await this.videoPublishModel.getPublishRecordsByStatus(status,page,size);
    }

    public async getPublishRecordsByPlatform(platform: PublishPlatform): Promise<VideoPublishRecordEntity[]> {
        return await this.videoPublishModel.getPublishRecordsByPlatform(platform);
    }

    public async deletePublishRecord(id: number): Promise<number> {
        return await this.videoPublishModel.deletePublishRecord(id);
    }

    async countPublishRecords(status?: PublishStatus): Promise<number> {
        return this.videoPublishModel.countPublishRecords(status);
    }
    public async getPublishRecords(page: number = 0, size: number = 10): Promise<VideoPublishRecordEntity[]> {
        return await this.videoPublishModel.getPublishRecords(page, size);
    }
    public async getPublishRecordsWithCount(param: PublishRecordQuery): Promise<ListData<VideoPublishRecordEntity>> {
        let records: VideoPublishRecordEntity[];
        let count: number;

        if (param.status) {
            records = await this.getPublishRecordsByStatus(param.status,param.page,param.size);
            count = await this.countPublishRecords(param.status);
        } else {
            records = await this.getPublishRecords(param.page, param.size);
            count = await this.countPublishRecords();
        }

        // Apply pagination
        // const start = param.page * param.size;
        // const end = start + param.size;
        // const paginatedRecords = records.slice(start, end);

        return {
            records: records,
            num: count
        };
    }
} 
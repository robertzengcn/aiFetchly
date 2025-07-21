//import {PublishPlatform,PublishStatus} from "@/entity/VideoPublishRecord.entity"
//import {PublishStatus}
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity";
import { PublishOptions } from "@/strategy/VideoPublishStrategy";
export enum PublishPlatform {
    YOUTUBE = "youtube",
    BILIBILI = "bilibili",
    BAIDU = "baidu"
}

export enum PublishStatus {
    PENDING = "pending",
    PROCESSING = "processing",
    COMPLETE = "complete",
    FAILED = "failed"
}

export interface VideoPublishResultType {
    publishStatus: PublishStatus;
    publishPlatform: PublishPlatform;
    publishTime: Date;
    publishError: string;
    publishUrl: string;
}

export interface VideoPublishRequest {
    videoId: number;
    platform: PublishPlatform;
    category: string;
    accountId: number;
}

export interface PublishRecordQuery {
    page: number;
    size: number;
    status?: PublishStatus;
    search?: string;
}

export interface VideoPublishParam {
    videoEntity: VideoDownloadEntity,
     platform: PublishPlatform, 
     options: PublishOptions
}
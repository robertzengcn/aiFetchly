//import { Browser } from 'puppeteer';
import { PublishPlatform, PublishStatus } from "@/entityTypes/videoPublishType"
//import { VideoPublishStrategyFactory } from '@/strategy/VideoPublishStrategyFactory';
import { VideoDownloadEntity } from '@/entity/VideoDownload.entity';
import { PublishOptions } from '@/strategy/VideoPublishStrategy';
import { VideoPublishRecordEntity } from '@/entity/VideoPublishRecord.entity';
import {VideoPublishStrategyFactory} from '@/strategy/VideoPublishStrategyFactory';

export class VideoPublishService {
    //private browser: Browser;
    private strategyFactory: VideoPublishStrategyFactory;

    constructor() {
        //this.browser = browser;
        this.strategyFactory = VideoPublishStrategyFactory.getInstance();
    }

    async publishVideo(
        video: VideoDownloadEntity,
        platform: PublishPlatform,
        options: PublishOptions
    ): Promise<VideoPublishRecordEntity> {
        try {
            const strategy = await this.strategyFactory.createStrategy(platform, options);
            
            // Validate options before publishing
            await strategy.validateOptions(options);
            
            // Publish the video
            const result = await strategy.publish(video, options);
            
            // Create a record from the result
            const record = new VideoPublishRecordEntity();
            record.video_download_id = video.id;
            record.platform = platform;
            record.status = result.publishStatus;
            record.platform_video_url = result.publishUrl;
            record.error_message = result.publishError;
            return record;
        } catch (error: unknown) {
            // Create a failed record
            const record = new VideoPublishRecordEntity();
            record.video_download_id = video.id;
            record.platform = platform;
            record.status = PublishStatus.FAILED;
            record.error_message = error instanceof Error ? error.message : 'Unknown error occurred';
            return record;
        }
    }

    async publishToMultiplePlatforms(
        video: VideoDownloadEntity,
        platforms: PublishPlatform[],
        options: PublishOptions
    ): Promise<VideoPublishRecordEntity[]> {
        const results: VideoPublishRecordEntity[] = [];
        
        for (const platform of platforms) {
            const result = await this.publishVideo(video, platform, options);
            results.push(result);
        }
        
        return results;
    }
} 
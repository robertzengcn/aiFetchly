import { Browser } from 'puppeteer';
import { VideoPublishStrategy, PublishOptions } from './VideoPublishStrategy';
import { BilibiliPublishStrategy } from './BilibiliPublishStrategy';
import { BaiduVideoPublishStrategy } from './BaiduVideoPublishStrategy';
import { YouTubePublishStrategy } from './YouTubePublishStrategy';
import { PublishPlatform } from '@/entityTypes/videoPublishType';
import { BrowserFactory } from './VideoPublishStrategy';

export class VideoPublishStrategyFactory {
    private static instance: VideoPublishStrategyFactory;
    private browserCache: Map<string, Browser> = new Map();

    private constructor() {}

    public static getInstance(): VideoPublishStrategyFactory {
        if (!VideoPublishStrategyFactory.instance) {
            VideoPublishStrategyFactory.instance = new VideoPublishStrategyFactory();
        }
        return VideoPublishStrategyFactory.instance;
    }

    private async getBrowser(options: PublishOptions): Promise<Browser> {
        const cacheKey = options.headless ? 'headless' : 'visible';
        
        if (!this.browserCache.has(cacheKey)) {
            const browser = await BrowserFactory.createBrowser(options);
            this.browserCache.set(cacheKey, browser);
        }
        
        return this.browserCache.get(cacheKey)!;
    }

    public async createStrategy(platform: PublishPlatform, options: PublishOptions): Promise<VideoPublishStrategy> {
        const browser = await this.getBrowser(options);

        switch (platform) {
            case PublishPlatform.BILIBILI:
                return new BilibiliPublishStrategy(browser);
            case PublishPlatform.BAIDU:
                return new BaiduVideoPublishStrategy(browser);
            case PublishPlatform.YOUTUBE:
                return new YouTubePublishStrategy(browser);
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    public async cleanup(): Promise<void> {
        for (const browser of this.browserCache.values()) {
            await browser.close();
        }
        this.browserCache.clear();
    }
} 
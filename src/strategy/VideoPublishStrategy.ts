import { Browser, Page, LaunchOptions } from 'puppeteer';
import * as puppeteer from 'puppeteer';
//import { VideoPublishRecordEntity } from '@/entity/VideoPublishRecord.entity';
import { VideoDownloadEntity } from '@/entity/VideoDownload.entity';
import {VideoPublishResultType} from "@/entityTypes/videoPublishType"

export interface PublishOptions {
    title?: string;
    description?: string;
    tags?: string[];
    category?: string;
    caption?: string;
    privacy?: 'public' | 'private' | 'unlisted';
    scheduleDate?: Date;
    headless?: boolean;
    cookies?: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
    }>;
    errorLogpath?: string;
    [key: string]: any; // Allow platform-specific options
}

export interface VideoPublishStrategy {
    publish(video: VideoDownloadEntity, options: PublishOptions): Promise<VideoPublishResultType>;
    validateOptions(options: PublishOptions): Promise<boolean>;
    getSupportedOptions(): string[];
}

export class BrowserFactory {
    static async createBrowser(options: PublishOptions): Promise<Browser> {
        const launchOptions: LaunchOptions = {
            headless: options.headless === false ? false : true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--start-maximized' 
            ]
        };

        return await puppeteer.launch(launchOptions);
    }
}

export abstract class BaseVideoPublishStrategy implements VideoPublishStrategy {
    protected browser: Browser;
    protected page: Page;

    constructor(browser: Browser) {
        this.browser = browser;
    }

    protected async initializePage(options: PublishOptions): Promise<void> {
        // Close existing page if any
        if (this.page) {
            await this.page.close();
        }

        // Create new page with appropriate viewport
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 800 });
    }

    protected async setCookies(cookies: PublishOptions['cookies']): Promise<void> {
        if (cookies && cookies.length > 0) {
            await this.page.setCookie(...cookies);
        }
    }

    protected async cleanup(): Promise<void> {
        if (this.page) {
            await this.page.close();
        }
    if (this.browser) {
        await this.browser.close();
    }

    }

    abstract publish(video: VideoDownloadEntity, options: PublishOptions): Promise<VideoPublishResultType>;
    abstract validateOptions(options: PublishOptions): Promise<boolean>;
    abstract getSupportedOptions(): string[];
} 
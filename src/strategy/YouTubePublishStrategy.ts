import { BaseVideoPublishStrategy, PublishOptions } from './VideoPublishStrategy';
import { VideoDownloadEntity } from '@/entity/VideoDownload.entity';
import {VideoPublishResultType} from "@/entityTypes/videoPublishType"
import {PublishPlatform,PublishStatus} from "@/entityTypes/videoPublishType"
import { Page } from 'puppeteer';

export class YouTubePublishStrategy extends BaseVideoPublishStrategy {
    private readonly YOUTUBE_UPLOAD_URL = 'https://studio.youtube.com/channel/me/videos/upload';

    private async checkLoginStatus(): Promise<boolean> {
        try {
            // Wait for either the upload button or the sign-in button to appear
            await this.page.waitForSelector('#upload-button, #sign-in-button', { timeout: 5000 });
            
            // Check if sign-in button exists (which means user is not logged in)
            const signInButton = await this.page.$('#sign-in-button');
            return !signInButton;
        } catch (error) {
            return false;
        }
    }

    async uploadVideo(videoPath: string): Promise<void> {
        // Click the upload button
        const uploadButton = await this.page.waitForSelector('#upload-button');
        if (!uploadButton) {
            throw new Error('Upload button not found');
        }
        await uploadButton.click();

        // Wait for the file input to be available
        const fileInput = await this.page.waitForSelector('input[type="file"]');
        if (!fileInput) {
            throw new Error('File input not found');
        }

        // Upload the video file
        await fileInput.uploadFile(videoPath);

        // Wait for the upload to complete and processing to start
        await this.page.waitForSelector('#upload-status', { timeout: 300000 });
        
        // Wait for processing to complete
        await this.page.waitForSelector('#processing-status', { timeout: 900000 });
    }

    async publish(video: VideoDownloadEntity, options: PublishOptions): Promise<VideoPublishResultType> {
        const result:VideoPublishResultType={
            publishStatus:PublishStatus.PENDING,
            publishPlatform:PublishPlatform.YOUTUBE,
            publishTime:new Date(),
            publishError:"",
            publishUrl:""
        }

        try {
            if (!video.savepath) {
                throw new Error('Video savepath is required');
            }

            await this.initializePage(options);
            
            // Set cookies if provided
            if (options.cookies) {
                await this.setCookies(options.cookies);
            }
            
            // Navigate to YouTube upload page
            await this.page.goto(this.YOUTUBE_UPLOAD_URL);
            
            // Check login status
            const isLoggedIn = await this.checkLoginStatus();
            if (!isLoggedIn) {
                throw new Error('User is not logged in. Please provide valid cookies.');
            }

            // Upload the video
            await this.uploadVideo(video.savepath);
            
            // Fill in video details
            if (options.title) {
                await this.page.type('#title-textarea', options.title);
            }
            
            if (options.description) {
                await this.page.type('#description-textarea', options.description);
            }

            // Set privacy settings if provided
            if (options.privacy) {
                const privacyButton = await this.page.waitForSelector('#privacy-button');
                if (privacyButton) {
                    await privacyButton.click();
                    await this.page.click(`[aria-label="${options.privacy}"]`);
                }
            }
            
            // Click publish button
            const publishButton = await this.page.waitForSelector('#publish-button');
            if (!publishButton) {
                throw new Error('Publish button not found');
            }
            await publishButton.click();
            
            // Wait for the video URL to be available
            const videoUrl = await this.page.waitForSelector('#video-url', { timeout: 30000 });
            
            if(videoUrl){
                const resurl = await videoUrl.evaluate(el => el.textContent);
                if(resurl){
                    result.publishUrl = resurl;
                }
            }
            
            if (!result.publishUrl) {
                throw new Error('Video URL is empty');
            }
            
            result.publishStatus = PublishStatus.COMPLETE;
            
        } catch (error: unknown) {
            result.publishStatus = PublishStatus.FAILED;
            result.publishError = error instanceof Error ? error.message : 'Unknown error occurred';
        } finally {
            await this.cleanup();
        }
        
        return result;
    }

    async validateOptions(options: PublishOptions): Promise<boolean> {
        // YouTube specific validation
        if (options.title && options.title.length > 100) {
            throw new Error('Title must be less than 100 characters');
        }
        if (options.description && options.description.length > 5000) {
            throw new Error('Description must be less than 5000 characters');
        }
        if (options.privacy && !['public', 'private', 'unlisted'].includes(options.privacy)) {
            throw new Error('Privacy must be one of: public, private, unlisted');
        }
        return true;
    }

    getSupportedOptions(): string[] {
        return [
            'title',
            'description',
            'tags',
            'category',
            'privacy',
            'scheduleDate',
            'cookies',
            'headless'
        ];
    }
} 
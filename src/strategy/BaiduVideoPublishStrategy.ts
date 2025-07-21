import { BaseVideoPublishStrategy, PublishOptions } from './VideoPublishStrategy';
import { VideoDownloadEntity } from '@/entity/VideoDownload.entity';
import {VideoPublishResultType} from "@/entityTypes/videoPublishType"
import {PublishPlatform,PublishStatus} from "@/entityTypes/videoPublishType"
//import { Page } from 'puppeteer';

export class BaiduVideoPublishStrategy extends BaseVideoPublishStrategy {
    private readonly BAIDU_UPLOAD_URL = 'https://haokan.baidu.com/videoui/page/publish';

    private async checkLoginStatus(): Promise<boolean> {
        try {
            // Wait for either the login button or the upload button to appear
            await this.page.waitForSelector('.upload-btn, .login-btn', { timeout: 5000 });
            
            // Check if login button exists (which means user is not logged in)
            const loginButton = await this.page.$('.login-btn');
            return !loginButton;
        } catch (error) {
            return false;
        }
    }

    async uploadVideo(videoPath: string): Promise<void> {
        // Wait for the upload wrapper to be available
        const uploadWrapper = await this.page.waitForSelector('.upload-wrp');
        if (!uploadWrapper) {
            throw new Error('Upload wrapper not found');
        }

        // Get the bounding box of the upload wrapper
        const box = await uploadWrapper.boundingBox();
        if (!box) {
            throw new Error('Could not get upload wrapper position');
        }

        // Calculate the center point of the upload wrapper
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        // Create and dispatch the drag and drop events
        await this.page.evaluate(async (centerX, centerY, filePath) => {
            const uploadWrapper = document.querySelector('.upload-wrp');
            if (!uploadWrapper) return;

            // Read the file data
            const response = await fetch(filePath);
            const blob = await response.blob();
            
            // Create the file object
            const file = new File([blob], 'video.mp4', { type: 'video/mp4' });
            
            // Create the drag event
            const dragEvent = new DragEvent('dragenter', {
                bubbles: true,
                cancelable: true,
                dataTransfer: new DataTransfer()
            });
            dragEvent.dataTransfer?.items.add(file);
            
            // Create the drop event
            const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: new DataTransfer()
            });
            dropEvent.dataTransfer?.items.add(file);

            // Dispatch the events
            uploadWrapper.dispatchEvent(dragEvent);
            uploadWrapper.dispatchEvent(dropEvent);
        }, centerX, centerY, videoPath);

        // Wait for the upload to complete
        await this.page.waitForSelector('.upload-status', { timeout: 300000 });
    }

    async publish(video: VideoDownloadEntity, options: PublishOptions): Promise<VideoPublishResultType> {
        const result:VideoPublishResultType={
            publishStatus:PublishStatus.PENDING,
            publishPlatform:PublishPlatform.BAIDU,
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
            
            // Navigate to Baidu video upload page
            await this.page.goto(this.BAIDU_UPLOAD_URL);
            
            // Check login status
            const isLoggedIn = await this.checkLoginStatus();
            if (!isLoggedIn) {
                throw new Error('User is not logged in. Please provide valid cookies.');
            }

            // Upload the video
            await this.uploadVideo(video.savepath);
            
            // Fill in video details
            if (options.title) {
                await this.page.type('#title-input', options.title);
            }
            
            if (options.description) {
                await this.page.type('#description-textarea', options.description);
            }
            
            // Click publish button
            await this.page.click('#publish-button');
            
            // Wait for the video URL to be available
            const videoUrl = await this.page.waitForSelector('.video-url', { timeout: 30000 });
            
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
        // Baidu specific validation
        if (options.title && options.title.length > 100) {
            throw new Error('Title must be less than 100 characters');
        }
        if (options.description && options.description.length > 5000) {
            throw new Error('Description must be less than 5000 characters');
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
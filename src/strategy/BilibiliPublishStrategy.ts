import { BaseVideoPublishStrategy, PublishOptions } from './VideoPublishStrategy';
import { VideoDownloadEntity } from '@/entity/VideoDownload.entity';
import {VideoPublishResultType} from "@/entityTypes/videoPublishType"
import {PublishPlatform,PublishStatus} from "@/entityTypes/videoPublishType"
import { Page, ElementHandle } from 'puppeteer';
import fs from 'fs';

export class BilibiliPublishStrategy extends BaseVideoPublishStrategy {
    private readonly BILIBILI_UPLOAD_URL = 'https://member.bilibili.com/platform/upload/video/frame';
    private readonly BILIBILI_LOGIN_CHECK_SELECTOR = '.custom-lazy-img'; // This selector should be present when logged in

    protected async initializePage(options: PublishOptions): Promise<void> {
        await super.initializePage(options);
        
        // Handle notification permissions
        this.handleNotificationPermission()
    }
    public async handleNotificationPermission(): Promise<void> {
        await this.page.evaluateOnNewDocument(() => {
            // Override the Notification permission request
            const originalQuery = window.Notification.requestPermission;
            window.Notification.requestPermission = async () => {
                return 'granted';
            };
        });
    }

    private async checkLoginStatus(): Promise<boolean> {
        try {
            // Wait for either the login button or the upload button to appear
            //await this.page.waitForSelector('.upload-wrp', { timeout: 5000 });
            await this.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000))); // Wait for 2 seconds
            // Check if login button exists (which means user is not logged in)
            const usericon = await this.page.$(this.BILIBILI_LOGIN_CHECK_SELECTOR);
            //return !loginButton;
            if(usericon){
                return true;
            }else{
                return false;
            }
        } catch (error) {
            return false;
        }
    }

    async publish(video: VideoDownloadEntity, options: PublishOptions): Promise<VideoPublishResultType> {
        const result:VideoPublishResultType={
            publishStatus:PublishStatus.PENDING,
            publishPlatform:PublishPlatform.BILIBILI,
            publishTime:new Date(),
            publishError:"",
            publishUrl:""
        }
        // const record = new VideoPublishRecordEntity();
        // record.video_download_id = video.id;
        // record.platform = PublishPlatform.YOUTUBE;
        // record.status = PublishStatus.PENDING;
        let url = "";
        try {
            if (!video.savepath) {
                throw new Error('Video savepath is required');
            }

            await this.initializePage(options);
            
            // Set cookies if provided
            if (options.cookies) {
                await this.setCookies(options.cookies);
            }
            
            // Navigate to Bilibili upload page
            await this.page.goto(this.BILIBILI_UPLOAD_URL);
            
            // Check login status
            const isLoggedIn = await this.checkLoginStatus();
            if (!isLoggedIn) {
                throw new Error('User is not logged in. Please provide valid cookies.');
            }
            
            
            // Upload the video
            await this.uploadVideo(video.savepath);
            
            //await this.handleNotificationPermission();
            // Fill in video details
            if (options.title) {
                const titleInput = await this.page.$('input[placeholder="请输入稿件标题"]');
                if (titleInput) {
                    await titleInput.evaluate((el, value) => {
                        el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }, options.title);
                    // await titleInput.type(options.title);
                }
               // await this.page.type('#textbox', options.title);
            }
            //set category
            const categorySelect = await this.page.$('.video-human-type div .select-controller');
            if (categorySelect) {
                await this.page.evaluate((element) => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, categorySelect);
                //await categorySelect.click();
                await this.page.mouse.move(
                    (await categorySelect.boundingBox())!.x + (await categorySelect.boundingBox())!.width / 2,
                    (await categorySelect.boundingBox())!.y + (await categorySelect.boundingBox())!.height / 2
                );
                await this.page.mouse.click(
                    (await categorySelect.boundingBox())!.x + (await categorySelect.boundingBox())!.width / 2,
                    (await categorySelect.boundingBox())!.y + (await categorySelect.boundingBox())!.height / 2
                );
                //await categorySelect.click();
                await this.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));
            const dropListContainer = await this.page.$('.drop-list-v2-container');
            if (dropListContainer) {
                const boundingBox = await dropListContainer.boundingBox();
                if (boundingBox) {
                    await this.page.mouse.move(
                        boundingBox.x + boundingBox.width / 2,
                        boundingBox.y + boundingBox.height / 2
                    );
                }
            // Scroll the mouse wheel until the category element is visible
            let categoryVisible = false;
            let scrollAttempts = 0;
            const maxScrollAttempts = 20;
            while (!categoryVisible && scrollAttempts < maxScrollAttempts) {
                categoryVisible = await this.page.evaluate((category) => {
                    const divs = Array.from(document.querySelectorAll('div'));
                    const target = divs.find(div => div.title === category);
                    if (!target) return false;
                    const rect = target.getBoundingClientRect();
                    return (
                        rect.top >= 0 &&
                        rect.left >= 0 &&
                        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                    );
                }, options.category);

                if (!categoryVisible) {
                    // Scroll the drop list container
                    await this.page.evaluate(() => {
                        const container = document.querySelector('.drop-list-v2-container');
                        if (container) {
                            container.scrollBy({ top: 80, behavior: 'smooth' });
                        }
                    });
                    await this.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
                }
                scrollAttempts++;
            }
            }

            const categoryDiv = await this.page.evaluateHandle((category) => {
                return Array.from(document.querySelectorAll('div')).find(
                    div => div.title === category
                );
            }, options.category);
            
            const categoryElement = await categoryDiv.asElement() as ElementHandle<HTMLDivElement>;
            if (categoryElement) {
                //await categoryElement.click();
                await this.page.mouse.move(
                    (await categoryElement.boundingBox())!.x + (await categoryElement.boundingBox())!.width / 2,
                    (await categoryElement.boundingBox())!.y + (await categoryElement.boundingBox())!.height / 2
                );
                await this.page.mouse.click(
                    (await categoryElement.boundingBox())!.x + (await categoryElement.boundingBox())!.width / 2,
                    (await categoryElement.boundingBox())!.y + (await categoryElement.boundingBox())!.height / 2
                );
            }
            }
            
            if (options.description) {
                const descriptionEditor = await this.page.$('.ql-editor');
                if (!descriptionEditor) {
                    throw new Error('Description editor not found');
                }
                await this.page.type('.ql-editor', options.description);
            }
            const closeButton = await this.page.$('.v-popover-close');
            if (closeButton) {
                await closeButton.click();
            }
                
            await this.waitforuploadfinish(90000000);
            
            //submit caption file
            if(options.caption&&options.caption.length>0){
                
                if (!fs.existsSync(options.caption)) {
                    throw new Error('Caption file does not exist: ' + options.caption);
                }

            const closeButton = await this.page.$('.v-popover-close');
            if (closeButton) {
                await closeButton.click();
            }
            // Use CSS selector for More Settings button
            //DOMException: SyntaxError: Failed to execute 'querySelector' on 'Document': 'span:has-text("更多设置")' is not a valid selector.
            const moreSettingsButton = await this.page.evaluateHandle(() => {
                return Array.from(document.querySelectorAll('span')).find(
                    span => span.textContent?.includes('更多设置')
                );
            });
            const element = await moreSettingsButton.asElement() as ElementHandle<HTMLSpanElement>;
            if (element) {
                const box = await element.boundingBox();
                
                if (box) {
                    await this.page.evaluate((box) => {
                        const element = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                        if (element) {
                            (element as HTMLElement).style.border = '2px solid red';
                            (element as HTMLElement).style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                        }
                    }, box);
                    await this.page.mouse.move(
                        box.x + box.width / 2,
                        box.y + box.height / 2
                    );
                    await element.click();
                }
            }
            
            await this.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            const subtitleButton = await this.page.evaluateHandle(() => {
                return Array.from(document.querySelectorAll('div')).find(
                    div => div.textContent?.includes('上传字幕')
                );
            });
            const subtitleElement = await subtitleButton.asElement() as ElementHandle<HTMLDivElement>;
            if (subtitleElement) {
                await subtitleElement.click();
            }
            await this.page.waitForSelector('.bcc-dialog', { visible: true });
            
            const languageInput = await this.page.$('input[placeholder="选择字幕语言"]');
            if (!languageInput) {
                throw new Error('Language input not found');
            }
            await languageInput.click();
            
            await this.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));

            if(video.language=="en"){
                //await this.page.click('span:has-text("English")');
            const englishSubtitleOption = await this.page.evaluateHandle(() => {
                return Array.from(document.querySelectorAll('div')).find(
                    div => div.textContent?.includes('字幕语言：英语（美国)')
                );
            });
            const englishElement = await englishSubtitleOption.asElement() as ElementHandle<HTMLDivElement>;
            if (englishElement) {
                await englishElement.click();
            }
            }else{
                //await this.page.click('span:has-text("Chinese")');
                const chineseSubtitleOption = await this.page.evaluateHandle(() => {
                    return Array.from(document.querySelectorAll('div')).find(
                        div => div.textContent?.includes('字幕语言：中文（简体）')
                    );
                });
                const chineseElement = await chineseSubtitleOption.asElement() as ElementHandle<HTMLDivElement>;
                if (chineseElement) {
                    await chineseElement.click();
                }
            }
            const uploadButton = await this.page.evaluateHandle(() => {
                return Array.from(document.querySelectorAll('span')).find(
                    span => span.textContent?.includes('上传文件')
                );
            });
            const uploadElement = await uploadButton.asElement() as ElementHandle<HTMLSpanElement>;
            if (uploadElement) {
                await uploadElement.click();
            }

            // Wait for file dialog and upload caption file
            const fileInput = await this.page.waitForSelector('input[type="file"]');
            if (!fileInput) {
                throw new Error('File input not found');
            }
            await fileInput.uploadFile(options.caption);

            // Set privacy settings
            // if (options.privacy) {
            //     await this.page.click('#privacy-button');
            //     await this.page.click(`[aria-label="${options.privacy}"]`);
            // }

            }
            
            // Click publish button
            //await this.page.click('#done-button');
            const submitButton = await this.page.$('span.submit-add');
            if (!submitButton) {
                throw new Error('Submit button not found');
            }
            console.log("submitButton",submitButton);
            //await submitButton.hover();
            //await submitButton.hover();
            //await submitButton.click();

            const box = await submitButton.boundingBox();
                
                if (box) {
                    await this.page.evaluate((box) => {
                        const element = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                        if (element) {
                            (element as HTMLElement).style.border = '2px solid red';
                            (element as HTMLElement).style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                        }
                    }, box);
                    await this.page.mouse.move(
                        box.x + box.width / 2,
                        box.y + box.height / 2
                    );
                await this.page.mouse.click(
                    box.x + box.width / 2,
                    box.y + box.height / 2
                );
                }
            await this.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));
            //await submitButton.click();
            // Wait for the video URL to be available
            // const videoUrl = await this.page.waitForSelector('.video-url', { timeout: 30000 });
            
            // if(videoUrl){
            //     const resurl = await videoUrl.evaluate(el => el.textContent);
            //     if(resurl){
            //         url = resurl;
            //     }
            // }
            // if (!url) {
            //     throw new Error('Video URL is empty');
            // }
            
            //record.platform_video_url = url;
            // const videoId = this.extractVideoId(url);
            // if (!videoId) {
            //     throw new Error('Could not extract video ID from URL');
            // }
            //record.platform_video_id = videoId;
            //record.status = PublishStatus.PUBLISHED;
            result.publishStatus = PublishStatus.COMPLETE;
        } catch (error) {
            console.error(error)
            
            result.publishStatus = PublishStatus.FAILED;
            if (options.errorLogpath) {
                try {
                    const screenshotPath = `${options.errorLogpath}/bilibili_error_${Date.now()}.png`;
                    await this.page.screenshot({ 
                        path: screenshotPath, 
                        fullPage: true 
                    });
                    result.publishError = `${error instanceof Error ? error.message : 'Unknown error occurred'}\nScreenshot saved to: ${screenshotPath}`;
                } catch (screenshotError) {
                    console.error('Failed to take error screenshot:', screenshotError);
                    result.publishError = `${error instanceof Error ? error.message : 'Unknown error occurred'}\nFailed to save screenshot: ${screenshotError instanceof Error ? screenshotError.message : 'Unknown screenshot error'}`;
                }
            } else {
                result.publishError = error instanceof Error ? error.message : 'Unknown error occurred';
            }
            //result.publishError = error instanceof Error ? error.message : 'Unknown error occurred';
        } finally {
            await this.cleanup();
        }
        
        return result;
        //return getRepository(VideoPublishRecordEntity).save(record);
    }
    async uploadVideo(videoPath: string): Promise<void> {
        // Wait for the upload wrapper to be available
        // Wait for the upload button to be visible
        await this.page.waitForSelector('.upload-wrp', { visible: true, timeout: 30000 });
        
        // Find the file input element
        const fileInput = await this.page.$('input[type="file"]');
        if (!fileInput) {
            // If no direct file input is found, try to find it within the upload wrapper
            const uploadWrapperFileInput = await this.page.$('.upload-wrp input[type="file"]') as ElementHandle<HTMLInputElement>;
            if (!uploadWrapperFileInput) {
                throw new Error('File input element not found');
            }
            // Set the file path to the input element
            await uploadWrapperFileInput.uploadFile(videoPath);
        } else {
            // Set the file path to the input element
            await fileInput.uploadFile(videoPath);
        }
        
        // Wait for the upload to start and complete
        await this.page.waitForSelector('.file-item-content-progress', { timeout: 10000 })
            .catch(() => console.log('Upload progress indicator not found, continuing anyway'));
            
        // Wait for upload to complete (this selector may need to be adjusted based on Bilibili's UI)
        // await this.page.waitForSelector('.upload-complete', { timeout: 300000 })
        //     .catch(() => console.log('Upload complete indicator not found, continuing anyway'));
        // const uploadWrapper = await this.page.waitForSelector('.upload-wrp');
        // if (!uploadWrapper) {
        //     throw new Error('Upload wrapper not found');
        // }

        // // Get the bounding box of the upload wrapper
        // const box = await uploadWrapper.boundingBox();
        // if (!box) {
        //     throw new Error('Could not get upload wrapper position');
        // }

        // // Calculate the center point of the upload wrapper
        // const centerX = box.x + box.width / 2;
        // const centerY = box.y + box.height / 2;

        // // Create and dispatch the drag and drop events
        // await this.page.evaluate(async (centerX, centerY, filePath) => {
        //     const uploadWrapper = document.querySelector('.upload-wrp');
        //     if (!uploadWrapper){
        //         throw new Error('Upload wrapper not found');
        //     }

        //     // Read the file data
        //     const response = await fetch(filePath);
        //     const blob = await response.blob();
            
        //     // Extract file name and extension from the path
        //     const fileName = filePath.split('/').pop() || 'video.mp4';
        //     const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'mp4';
            
        //     // Determine the correct MIME type based on file extension
        //     let mimeType = 'video/mp4';
        //     if (fileExtension === 'webm') mimeType = 'video/webm';
        //     else if (fileExtension === 'mov') mimeType = 'video/quicktime';
        //     else if (fileExtension === 'avi') mimeType = 'video/x-msvideo';
        //     else if (fileExtension === 'mkv') mimeType = 'video/x-matroska';
            
        //     // Create the file object with the correct name and type
        //     const file = new File([blob], fileName, { type: mimeType });
            
        //     // Create the drag event
        //     const dragEvent = new DragEvent('dragenter', {
        //         bubbles: true,
        //         cancelable: true,
        //         dataTransfer: new DataTransfer()
        //     });
        //     dragEvent.dataTransfer?.items.add(file);
            
        //     // Create the drop event
        //     const dropEvent = new DragEvent('drop', {
        //         bubbles: true,
        //         cancelable: true,
        //         dataTransfer: new DataTransfer()
        //     });
        //     dropEvent.dataTransfer?.items.add(file);

        //     // Dispatch the events
        //     uploadWrapper.dispatchEvent(dragEvent);
        //     uploadWrapper.dispatchEvent(dropEvent);
        // }, centerX, centerY, videoPath);

        // Wait for the upload to complete and success message to appear
        //await this.page.waitForSelector('span.success', { timeout: 900000 });
    }
    async waitforuploadfinish(timeout:number){
        
        await this.page.waitForSelector('span.success', { timeout: timeout });
    }
    async validateOptions(options: PublishOptions): Promise<boolean> {
        // YouTube specific validation
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

    private extractVideoId(url: string): string | null {
        const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        return match ? match[1] : null;
    }
} 
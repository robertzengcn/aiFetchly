import { Page, Browser } from 'puppeteer';
import puppeteer from 'puppeteer';
import { YellowPagesTaskModel, YellowPagesTaskStatus } from "@/model/YellowPagesTask.model";
import { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import { PlatformRegistry } from "@/modules/PlatformRegistry";
import { BaseModule } from "@/modules/baseModule";
import { BrowserManager } from "@/modules/browserManager";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { MessageType } from '@/interfaces/IPCMessageProtocol';

interface ScrapingProgress {
    currentPage: number;
    totalPages: number;
    resultsCount: number;
    percentage: number;
    estimatedTimeRemaining?: number;
}

interface ScrapingResult {
    business_name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
    };
    social_media?: string[];
    categories?: string[];
    business_hours?: object;
    description?: string;
    rating?: number;
    review_count?: number;
    raw_data?: object;
    fax_number?: string;
    contact_person?: string;
    year_established?: number;
    number_of_employees?: string;
    payment_methods?: string[];
    specialties?: string[];
}

export class YellowPagesScraperProcess extends BaseModule {
    private taskId: number;
    private taskModel: YellowPagesTaskModel;
    private resultModel: YellowPagesResultModel;
    private platformRegistry: PlatformRegistry;
    private browserManager: BrowserManager;
    private accountCookiesModule: AccountCookiesModule;
    private browser: Browser | null = null;
    private page: Page | null = null;
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    
    // IPC integration
    private onProgressCallback?: (progress: ScrapingProgress) => void;
    private onCompleteCallback?: (results: ScrapingResult[]) => void;
    private onErrorCallback?: (error: Error) => void;

    constructor(taskId: number) {
        super();
        this.taskId = taskId;
        this.taskModel = new YellowPagesTaskModel(this.dbpath);
        this.resultModel = new YellowPagesResultModel(this.dbpath);
        this.platformRegistry = new PlatformRegistry();
        this.browserManager = new BrowserManager();
        this.accountCookiesModule = new AccountCookiesModule();
    }

    /**
     * Set progress callback for IPC communication
     */
    onProgress(callback: (progress: ScrapingProgress) => void): void {
        this.onProgressCallback = callback;
    }

    /**
     * Set completion callback for IPC communication
     */
    onComplete(callback: (results: ScrapingResult[]) => void): void {
        this.onCompleteCallback = callback;
    }

    /**
     * Set error callback for IPC communication
     */
    onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback;
    }

    /**
     * Start the scraping process
     */
    async start(): Promise<void> {
        try {
            console.log(`Starting Yellow Pages scraping for task ${this.taskId}`);
            
            // Get task details
            const task = await this.taskModel.getTaskById(this.taskId);
            if (!task) {
                throw new Error(`Task ${this.taskId} not found`);
            }

            // Get platform details from registry (id/name/display_name match)
            const platform = this.platformRegistry
              .getAllPlatforms()
              .find(p => p.id === task.platform || p.name === task.platform || p.display_name === task.platform);
            if (!platform) {
                throw new Error(`Platform ${task.platform} not found`);
            }

            // Update task status to in-progress
            await this.taskModel.updateTaskStatus(this.taskId, YellowPagesTaskStatus.InProgress);
            this.isRunning = true;

            // Initialize browser
            await this.initializeBrowser();

            // Apply cookies if account is specified
            if (task.account_id) {
                await this.applyCookies(task.account_id);
            }

            // Start scraping
            await this.scrapeTask(task, platform);

            // Update task status to completed
            await this.taskModel.updateTaskStatus(this.taskId, YellowPagesTaskStatus.Completed);
            await this.taskModel.updateTaskCompletion(this.taskId);

            console.log(`Completed Yellow Pages scraping for task ${this.taskId}`);

        } catch (error) {
            console.error(`Error in Yellow Pages scraping for task ${this.taskId}:`, error);
            
            // Update task status to failed
            await this.taskModel.updateTaskStatus(this.taskId, YellowPagesTaskStatus.Failed);
            await this.taskModel.updateTaskErrorLog(this.taskId, error instanceof Error ? error.message : String(error));
            
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Stop the scraping process
     */
    async stop(): Promise<void> {
        console.log(`Stopping Yellow Pages scraping for task ${this.taskId}`);
        this.isRunning = false;
        await this.cleanup();
    }

    /**
     * Pause the scraping process
     */
    async pause(): Promise<void> {
        console.log(`Pausing Yellow Pages scraping for task ${this.taskId}`);
        this.isPaused = true;
    }

    /**
     * Resume the scraping process
     */
    async resume(): Promise<void> {
        console.log(`Resuming Yellow Pages scraping for task ${this.taskId}`);
        this.isPaused = false;
    }

    /**
     * Initialize browser and page
     */
    private async initializeBrowser(): Promise<void> {
        try {
            // Get browser information from BrowserManager
            const browserInfo = await this.browserManager.getBrowserInfo();
            const launchOptions = await this.browserManager.createLaunchOptions();
            
            // Launch browser using Puppeteer
            this.browser = await puppeteer.launch({
                ...launchOptions,
                executablePath: browserInfo.executablePath
            });
            
            if (!this.browser) {
                throw new Error('Failed to create browser instance');
            }
            this.page = await this.browser.newPage();
            if (!this.page) {
                throw new Error('Failed to create page instance');
            }
            
            // Set up page configurations
            await this.page.setViewport({ width: 1920, height: 1080 });
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            console.log('Browser initialized successfully');
        } catch (error) {
            console.error('Failed to initialize browser:', error);
            throw error;
        }
    }

    /**
     * Apply cookies from account to the browser page
     */
    private async applyCookies(accountId: number): Promise<void> {
        try {
            if (!this.page) {
                throw new Error('Page is not initialized');
            }

            console.log(`Applying cookies for account ${accountId}`);

            // Get account cookies from the database
            const accountCookies = await this.accountCookiesModule.getAccountCookies(accountId);
            
            if (!accountCookies || !accountCookies.cookies) {
                console.log(`No cookies found for account ${accountId}`);
                return;
            }

            // Parse cookies JSON
            const cookies = JSON.parse(accountCookies.cookies);
            
            if (!Array.isArray(cookies) || cookies.length === 0) {
                console.log(`No valid cookies found for account ${accountId}`);
                return;
            }

            // Apply each cookie to the page
            for (const cookie of cookies) {
                try {
                    // Convert cookie format if needed
                    const cookieData = {
                        name: cookie.name,
                        value: cookie.value,
                        domain: cookie.domain,
                        path: cookie.path || '/',
                        expires: cookie.expirationDate ? cookie.expirationDate * 1000 : undefined,
                        httpOnly: cookie.httpOnly || false,
                        secure: cookie.secure || false,
                        sameSite: cookie.sameSite as 'Strict' | 'Lax' | 'None' | undefined
                    };

                    await this.page.setCookie(cookieData);
                    console.log(`Applied cookie: ${cookie.name} for domain: ${cookie.domain}`);
                    
                } catch (error) {
                    console.error(`Failed to set cookie ${cookie.name}:`, error);
                    // Continue with other cookies
                }
            }

            console.log(`Successfully applied cookies for account ${accountId}`);

        } catch (error) {
            console.error(`Error applying cookies for account ${accountId}:`, error);
            // Don't throw error - cookies are optional
        }
    }

    /**
     * Main scraping logic
     */
    private async scrapeTask(task: any, platform: any): Promise<void> {
        const keywords = JSON.parse(task.keywords);
        const location = task.location;
        const maxPages = task.max_pages;
        const delayBetweenRequests = task.delay_between_requests;

        //let currentPage = 1;
        let totalResults = 0;

        for (const keyword of keywords) {
            if (!this.isRunning) break;

            console.log(`Scraping keyword: ${keyword} in ${location}`);

            for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                if (!this.isRunning) break;

                // Wait if paused
                while (this.isPaused && this.isRunning) {
                    await this.sleep(1000);
                }

                try {
                    // Navigate to search page
                    const searchUrl = this.buildSearchUrl(platform, keyword, location, pageNum);
                    if (!this.page) {
                        throw new Error('Page is not initialized');
                    }
                    await this.page.goto(searchUrl, { waitUntil: 'networkidle2' });

                    // Extract business data
                    const results = await this.extractBusinessData(platform);
                    
                    // Save results
                    if (results.length > 0) {
                        const resultIds = await this.resultModel.saveMultipleResults(
                            results.map(result => ({
                                ...result,
                                task_id: this.taskId,
                                platform: task.platform
                            }))
                        );
                        totalResults += resultIds.length;
                        console.log(`Saved ${resultIds.length} results from page ${pageNum}`);
                    }

                    // Report progress
                    const progress: ScrapingProgress = {
                        currentPage: pageNum,
                        totalPages: maxPages,
                        resultsCount: totalResults,
                        percentage: (pageNum / maxPages) * 100
                    };
                    this.reportProgress(progress);

                    // Delay between requests
                    if (pageNum < maxPages) {
                        await this.sleep(delayBetweenRequests);
                    }

                } catch (error) {
                    console.error(`Error scraping page ${pageNum}:`, error);
                    // Continue with next page
                }
            }
        }
    }

    /**
     * Build search URL for the platform
     */
    private buildSearchUrl(platform: any, keyword: string, location: string, pageNum: number): string {
        const settings = platform.settings || {};
        const searchUrlPattern = settings.searchUrlPattern || `${platform.base_url}/search`;
        
        let url = searchUrlPattern
            .replace('{keywords}', encodeURIComponent(keyword))
            .replace('{location}', encodeURIComponent(location));
        
        // Add page parameter if needed
        if (pageNum > 1) {
            url += url.includes('?') ? '&' : '?';
            url += `page=${pageNum}`;
        }
        
        return url;
    }

    /**
     * Extract business data from the current page
     */
    private async extractBusinessData(platform: any): Promise<ScrapingResult[]> {
        const selectors = platform.selectors || {};
        const results: ScrapingResult[] = [];

        try {
            if (!this.page) {
                throw new Error('Page is not initialized');
            }
            // Wait for business list to load
            await this.page.waitForSelector(selectors.businessList, { timeout: 10000 });

            // Extract all business listings
            const businessElements = await this.page.$$(selectors.businessList);
            
            for (const element of businessElements) {
                if (!this.isRunning) break;

                try {
                    const result = await this.extractBusinessFromElement(element, selectors);
                    if (result) {
                        results.push(result);
                    }
                } catch (error) {
                    console.error('Error extracting business data:', error);
                    // Continue with next element
                }
            }

        } catch (error) {
            console.error('Error extracting business data from page:', error);
        }

        return results;
    }

    /**
     * Extract business data from a single element
     */
    private async extractBusinessFromElement(element: any, selectors: any): Promise<ScrapingResult | null> {
        try {
            const business_name = await this.extractText(element, selectors.businessName);
            if (!business_name) return null;

            const result: ScrapingResult = {
                business_name,
                email: await this.extractText(element, selectors.email),
                phone: await this.extractText(element, selectors.phone),
                website: await this.extractAttribute(element, selectors.website, 'href'),
                address: {
                    street: await this.extractText(element, selectors.address),
                    city: await this.extractText(element, selectors.address_city),
                    state: await this.extractText(element, selectors.address_state),
                    zip: await this.extractText(element, selectors.address_zip),
                    country: await this.extractText(element, selectors.address_country)
                },
                social_media: await this.extractArray(element, selectors.socialMedia),
                categories: await this.extractArray(element, selectors.categories),
                business_hours: await this.extractObject(element, selectors.businessHours),
                description: await this.extractText(element, selectors.description),
                rating: await this.extractNumber(element, selectors.rating),
                review_count: await this.extractNumber(element, selectors.reviewCount),
                raw_data: await this.extractRawData(element),
                fax_number: await this.extractText(element, selectors.faxNumber),
                contact_person: await this.extractText(element, selectors.contactPerson),
                year_established: await this.extractNumber(element, selectors.yearEstablished),
                number_of_employees: await this.extractText(element, selectors.numberOfEmployees),
                payment_methods: await this.extractArray(element, selectors.paymentMethods),
                specialties: await this.extractArray(element, selectors.specialties)
            };

            return result;
        } catch (error) {
            console.error('Error extracting business from element:', error);
            return null;
        }
    }

    /**
     * Extract text from element
     */
    private async extractText(element: any, selector: string): Promise<string | undefined> {
        if (!selector) return undefined;
        try {
            const textElement = await element.$(selector);
            if (textElement) {
                return await textElement.evaluate(el => el.textContent?.trim());
            }
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Extract attribute from element
     */
    private async extractAttribute(element: any, selector: string, attribute: string): Promise<string | undefined> {
        if (!selector) return undefined;
        try {
            const attrElement = await element.$(selector);
            if (attrElement) {
                return await attrElement.evaluate((el, attr) => el.getAttribute(attr), attribute);
            }
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Extract array from element
     */
    private async extractArray(element: any, selector: string): Promise<string[] | undefined> {
        if (!selector) return undefined;
        try {
            const elements = await element.$$(selector);
            const array: string[] = [];
            for (const el of elements) {
                const text = await el.evaluate(element => element.textContent?.trim());
                if (text) array.push(text);
            }
            return array.length > 0 ? array : undefined;
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Extract number from element
     */
    private async extractNumber(element: any, selector: string): Promise<number | undefined> {
        if (!selector) return undefined;
        try {
            const text = await this.extractText(element, selector);
            if (text) {
                const num = parseFloat(text.replace(/[^\d.-]/g, ''));
                return isNaN(num) ? undefined : num;
            }
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Extract object from element
     */
    private async extractObject(element: any, selector: string): Promise<object | undefined> {
        if (!selector) return undefined;
        try {
            const text = await this.extractText(element, selector);
            if (text) {
                return JSON.parse(text);
            }
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Extract raw data from element
     */
    private async extractRawData(element: any): Promise<object | undefined> {
        try {
            return await element.evaluate(el => {
                const data: any = {};
                data.innerHTML = el.innerHTML;
                data.textContent = el.textContent;
                data.className = el.className;
                data.id = el.id;
                return data;
            });
        } catch (error) {
            return undefined;
        }
    }

    /**
     * Report progress to main process
     */
    private reportProgress(progress: ScrapingProgress): void {
        if (process.send) {
            process.send({
                type: 'PROGRESS',
                taskId: this.taskId,
                progress
            });
        }
    }

    /**
     * Sleep utility
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup resources
     */
    private async cleanup(): Promise<void> {
        try {
            if (this.page) {
                await this.page.close();
                this.page = null;
            }
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

// Handle process messages
process.on('message', async (message: any) => {
    if (message.type === 'START' && message.taskId) {
        const scraper = new YellowPagesScraperProcess(message.taskId);
        try {
            await scraper.start();
            if (process.send) {
                process.send({ type: 'COMPLETED', taskId: message.taskId });
            }
        } catch (error) {
            if (process.send) {
                process.send({ 
                    type: 'ERROR', 
                    taskId: message.taskId, 
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }
});

// Handle process termination
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully');
    process.exit(0);
}); 
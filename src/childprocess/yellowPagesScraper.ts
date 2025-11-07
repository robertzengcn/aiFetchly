/**
 * Yellow Pages Scraper Child Process
 * 
 * This child process handles the actual scraping logic without database operations.
 * It communicates results back to the parent process via IPC.
 * 
 * NEW: Adapter Class Support
 * - The child process now accepts adapter class information from the parent
 * - When an adapter class is provided, it dynamically loads and uses platform-specific methods
 * - Falls back to configuration-based approach when no adapter is available
 * - Supports custom search, data extraction, and pagination methods
 * 
 * Usage:
 * - Parent process sends adapter class info via message.platformInfo.adapterClass
 * - Child process automatically detects and uses platform-specific capabilities
 * - Adapter methods take precedence over configuration-based selectors
 */

import { Page, Browser, ElementHandle } from 'puppeteer';
import { BrowserManager } from '@/modules/browserManager';
import { ChildProcessAdapterFactory } from '@/modules/ChildProcessAdapterFactory';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { ProcessMessage } from '@/entityTypes/processMessage-type';
import { StartTaskMessage, ProgressMessage, CompletedMessage, ErrorMessage } from '@/modules/interface/BackgroundProcessMessages';
import { SessionRecordingManager } from '@/modules/SessionRecordingManager';
//import { MessageType } from '@/interfaces/IPCMessageProtocol';

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
    fax_number?: string;
    contact_person?: string;
    year_established?: number;
    number_of_employees?: string;
    payment_methods?: string[];
    specialties?: string[];
}

interface TaskData {
    taskId: number;
    platform: string;
    keywords: string[];
    location: string;
    max_pages: number;
    delay_between_requests: number;
    account_id?: number;
    cookies?: any[];
    headless?: boolean;
    userDataPath?: string; // Add user data path from parent process
    adapterClass?: {
        className: string;
        modulePath: string;
    };
}

interface PlatformInfo {
    id: number;
    name: string;
    display_name: string;
    base_url: string;
    settings: {
        searchUrlPattern?: string;
    };
    selectors: {
        businessItem: string;
        businessList: string;
        businessName: string;
        email?: string;
        phone?: string;
        website?: string;
        address?: string;
        address_city?: string;
        address_state?: string;
        address_zip?: string;
        address_country?: string;
        socialMedia?: string;
        categories?: string;
        businessHours?: string;
        description?: string;
        rating?: string;
        reviewCount?: string;
        faxNumber?: string;
        contactPerson?: string;
        yearEstablished?: string;
        numberOfEmployees?: string;
        paymentMethods?: string;
        specialties?: string;
        searchForm?: {
            keywordInput?: string;
            locationInput?: string;
            searchButton?: string;
            formContainer?: string;
            categoryDropdown?: string;
            radiusDropdown?: string;
        };
        pagination?: {
            nextButton?: string;
            currentPage?: string;
            maxPages?: string;
            previousButton?: string;
            pageNumbers?: string;
            container?: string;
        };
        navigation?: {
            required?: boolean;
            detailLink?: string;
            delayAfterNavigation?: number;
            detailPage?: {
                businessName?: string;
                fullAddress?: string;
                businessHours?: string;
                description?: string;
                contactInfo?: string;
                services?: string;
                additionalPhone?: string;
                additionalEmail?: string;
                socialMedia?: string;
                categories?: string;
                yearEstablished?: string;
                numberOfEmployees?: string;
                paymentMethods?: string;
                specialties?: string;
                website?: string;
            };
        };
    };
    adapterClass?: {
        className: string;
        modulePath: string;
    };
}

interface PauseResumePromise {
    resolve: () => void;
    reject: (error: Error) => void;
}

/**
 * Yellow Pages Scraper Process
 * Handles the actual scraping logic without database operations
 * Communicates results back to parent process via IPC
 */
export class YellowPagesScraperProcess {
    private taskData: TaskData;
    private platformInfo: PlatformInfo;
    private browser: Browser | null = null;
    private page: Page | null = null;
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private adapter: BasePlatformAdapter | null = null;
    private sessionManager: SessionRecordingManager;
    private isInNewTab: boolean = false;
    private searchPageUrl: string | null = null;

    // IPC integration
    private onProgressCallback?: (progress: ScrapingProgress) => void;
    private onCompleteCallback?: (results: ScrapingResult[]) => void;
    private onErrorCallback?: (error: Error) => void;
    private pauseResumePromise: PauseResumePromise | null = null;

    constructor(taskData: TaskData, platformInfo: PlatformInfo) {
        this.taskData = taskData;
        this.platformInfo = platformInfo;
        this.isInNewTab = false;

        // Use userDataPath from taskData if available, otherwise use a default path
        const userDataPath = this.taskData.userDataPath || process.cwd();
        this.sessionManager = new SessionRecordingManager(userDataPath);

        // Log headless setting
        const headlessMode = this.taskData.headless !== undefined ? this.taskData.headless : true;
        console.log(`🔧 Scraper initialized with headless mode: ${headlessMode}`);
        console.log(`📹 Session recording initialized: ${this.sessionManager.getRecordingStatus()}`);
    }

    /**
     * Initialize the adapter if adapter class information is available
     */
    private async initializeAdapter(): Promise<void> {
        if (this.platformInfo.adapterClass) {
            try {
                console.log(`Initializing adapter: ${this.platformInfo.adapterClass.className}`);
                this.adapter = await ChildProcessAdapterFactory.createAdapter(
                    this.platformInfo.adapterClass,
                    this.platformInfo as any // Cast to PlatformConfig for compatibility
                );
                console.log(`✅ Adapter initialized successfully: ${this.platformInfo.adapterClass.className}`);
            } catch (error) {
                console.warn(`⚠️ Failed to initialize adapter: ${error}. Falling back to configuration-based approach.`);
                this.adapter = null;
            }
        } else {
            console.log('No adapter class specified, using configuration-based approach');
        }
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
     * Log adapter information and capabilities
     */
    private logAdapterInfo(): void {
        if (this.adapter) {
            const capabilities = this.getAdapterCapabilities();
            console.log(`🔧 Using adapter: ${this.platformInfo.adapterClass?.className}`);
            console.log(`📋 Adapter capabilities: ${capabilities.join(', ')}`);
        } else {
            console.log('🔧 Using configuration-based approach');
        }
    }

    /**
     * Execute platform-specific operations using the adapter if available
     */
    private async executePlatformSpecificOperations(): Promise<void> {
        if (!this.adapter) {
            console.log('No adapter available, skipping platform-specific operations');
            return;
        }

        try {

            console.log('🔧 Executing platform-specific operations...');

            // Example: Use adapter-specific search method if available
            if (this.adapterSupportsFeature('custom-search')) {
                console.log('🔍 Adapter supports custom search, this will be used during scraping');
            }

            // Example: Use adapter-specific data extraction if available
            if (this.adapterSupportsFeature('custom-extraction')) {
                console.log('📊 Adapter supports custom data extraction, this will be used during scraping');
            }

            // Example: Use adapter-specific pagination if available
            if (this.adapterSupportsFeature('custom-pagination')) {
                console.log('📄 Adapter supports custom pagination, this will be used during scraping');
            }

            // Example: Use adapter-specific page load handling if available
            if (this.adapterSupportsFeature('custom-page-load')) {
                console.log('🔧 Adapter supports custom page load handling, this will be used during scraping');
            }

            console.log('✅ Platform-specific operations completed');

        } catch (error) {
            console.warn('⚠️ Error during platform-specific operations:', error);
        }
    }

    /**
     * Start the scraping process
     */
    async start(): Promise<void> {
        try {
            console.log(`Starting Yellow Pages scraping for task ${this.taskData.taskId}`);
            console.log(`📋 Task configuration:`, {
                taskId: this.taskData.taskId,
                platform: this.taskData.platform,
                keywords: this.taskData.keywords,
                location: this.taskData.location,
                maxPages: this.taskData.max_pages,
                delayBetweenRequests: this.taskData.delay_between_requests,
                headless: this.taskData.headless,
                hasAccount: !!this.taskData.account_id,
                hasCookies: !!(this.taskData.cookies && this.taskData.cookies.length > 0),
                hasAdapter: !!this.platformInfo.adapterClass
            });

            this.isRunning = true;

            // Initialize adapter if available
            await this.initializeAdapter();

            // Log adapter information
            this.logAdapterInfo();

            // Execute platform-specific operations
            //await this.executePlatformSpecificOperations();

            // Start session recording for AI training
            this.sessionManager.startSession(
                this.taskData.taskId,
                this.taskData.platform,
                this.taskData.keywords,
                this.taskData.location
            );
            console.log(`📹 Started session recording for task ${this.taskData.taskId}`);

            // Initialize browser
            await this.initializeBrowser();

            // Apply cookies if account is specified
            if (this.taskData.account_id && this.taskData.cookies) {
                await this.applyCookies(this.taskData.cookies);
            }

            // Start scraping
            const results = await this.scrapeTask();

            // Call completion callback
            if (this.onCompleteCallback) {
                this.onCompleteCallback(results);
            }

            console.log(`Completed Yellow Pages scraping for task ${this.taskData.taskId}`);

        } catch (error) {
            console.error(`Error in Yellow Pages scraping for task ${this.taskData.taskId}:`, error);

            // Call error callback
            if (this.onErrorCallback) {
                this.onErrorCallback(error instanceof Error ? error : new Error(String(error)));
            }

            throw error;
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Stop the scraping process
     */
    async stop(): Promise<void> {
        console.log(`Stopping Yellow Pages scraping for task ${this.taskData.taskId}`);
        this.isRunning = false;
        await this.cleanup();
    }

    /**
     * Pause the scraping process
     */
    async pause(): Promise<void> {
        if (this.isPaused) return;

        console.log(`Pausing Yellow Pages scraping for task ${this.taskData.taskId}`);
        this.isPaused = true;

        // Send pause confirmation to parent process
        if (process.parentPort) {
            const pauseMessage = {
                type: 'TASK_PAUSED',
                taskId: this.taskData.taskId,
                content: 'Task has been paused successfully'
            };
            process.parentPort.postMessage(pauseMessage);
        }

        // Create a promise that resolves when resume is called
        return new Promise<void>((resolve, reject) => {
            this.pauseResumePromise = { resolve, reject };
        });
    }

    /**
     * Resume the scraping process
     */
    async resume(): Promise<void> {
        if (!this.isPaused) return;

        console.log(`Resuming Yellow Pages scraping for task ${this.taskData.taskId}`);
        this.isPaused = false;

        // Send resume confirmation to parent process
        if (process.parentPort) {
            const resumeMessage = {
                type: 'TASK_RESUMED',
                taskId: this.taskData.taskId,
                content: 'Task has been resumed successfully'
            };
            process.parentPort.postMessage(resumeMessage);
        }

        // Resolve the pause promise
        if (this.pauseResumePromise) {
            this.pauseResumePromise.resolve();
            this.pauseResumePromise = null;
        }
    }

    /**
     * Initialize browser and page
     */
    private async initializeBrowser(): Promise<void> {
        try {
            // Use BrowserManager to get proper launch options with stealth mode
            const browserManager = new BrowserManager({ enableStealth: true });

            // Override headless setting if specified in task data
            const headless = this.taskData.headless !== undefined ? this.taskData.headless : false;
            console.log(`Browser will run in ${headless ? 'headless' : 'non-headless'} mode`);

            // Launch browser using puppeteer-extra with stealth plugin
            this.browser = await browserManager.launchWithStealth({ headless });

            if (!this.browser) {
                throw new Error('Failed to create browser instance');
            }
            this.page = await this.browser.newPage();
            if (!this.page) {
                throw new Error('Failed to create page instance');
            }

            // Set up page configurations with random viewport
            const viewport = browserManager.getRandomViewport();
            await this.page.setViewport(viewport);
            console.log(`Set viewport to: ${viewport.width}x${viewport.height}`);

            // Set random user agent
            const userAgent = browserManager.getRandomUserAgent();
            await this.page.setUserAgent(userAgent);
            console.log(`Set user agent: ${userAgent}`);

            console.log('Browser initialized successfully with stealth mode using puppeteer-extra');
        } catch (error) {
            console.error('Failed to initialize browser:', error);
            throw error;
        }
    }



    /**
     * Apply cookies to the browser page
     */
    private async applyCookies(cookies: any[]): Promise<void> {
        try {
            if (!this.page) {
                throw new Error('Page is not initialized');
            }

            console.log(`Applying ${cookies.length} cookies`);

            if (!Array.isArray(cookies) || cookies.length === 0) {
                console.log('No valid cookies found');
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

            console.log('Successfully applied cookies');

        } catch (error) {
            console.error('Error applying cookies:', error);
            // Don't throw error - cookies are optional
        }
    }

    /**
     * Main scraping logic
     */
    private async scrapeTask(): Promise<ScrapingResult[]> {
        const keywords = this.taskData.keywords;
        const location = this.taskData.location;
        const maxPages = this.taskData.max_pages;
        const delayBetweenRequests = this.taskData.delay_between_requests;

        let totalResults: ScrapingResult[] = [];

        // Check if we have a platform-specific adapter with custom methods
        const hasCustomSearch = this.adapter && this.adapterSupportsFeature('custom-search');
        const hasCustomExtraction = this.adapter && this.adapterSupportsFeature('custom-extraction');
        const hasCustomPagination = this.adapter && this.adapterSupportsFeature('custom-pagination');
        const hasCustomPageLoad = this.adapter && this.adapterSupportsFeature('custom-page-load');
        const hasCustomEmailExtraction = this.adapter && this.adapterSupportsFeature('custom-email-extraction');
        const hasCustomPhoneExtraction = this.adapter && this.adapterSupportsFeature('custom-phone-extraction');
        const hasCustomWebsiteExtraction = this.adapter && this.adapterSupportsFeature('custom-website-extraction');
        const hasCustomAddressExtraction = this.adapter && this.adapterSupportsFeature('custom-address-extraction');

        console.log(`🔧 Platform capabilities:`, {
            customSearch: hasCustomSearch,
            customExtraction: hasCustomExtraction,
            customPagination: hasCustomPagination,
            customPageLoad: hasCustomPageLoad,
            customEmailExtraction: hasCustomEmailExtraction,
            customPhoneExtraction: hasCustomPhoneExtraction,
            customWebsiteExtraction: hasCustomWebsiteExtraction,
            customAddressExtraction: hasCustomAddressExtraction,
            adapterClass: this.platformInfo.adapterClass?.className || 'None'
        });

        if (this.adapter) {
            console.log(`🚀 Using platform adapter: ${this.platformInfo.adapterClass?.className}`);
            console.log(`📋 Adapter methods:`, {
                searchBusinesses: hasCustomSearch ? 'Custom' : 'Default',
                extractBusinessData: hasCustomExtraction ? 'Custom' : 'Default',
                handlePagination: hasCustomPagination ? 'Custom' : 'Default',
                onPageLoad: hasCustomPageLoad ? 'Custom' : 'Default',
                extractEmailFromDetailPage: hasCustomEmailExtraction ? 'Custom' : 'Default',
                extractPhoneNumberWithReveal: hasCustomPhoneExtraction ? 'Custom' : 'Default',
                extractWebsiteWithReveal: hasCustomWebsiteExtraction ? 'Custom' : 'Default',
                extractAddressFromBusinessSection: hasCustomAddressExtraction ? 'Custom' : 'Default'
            });
        } else {
            console.log(`🔧 No platform adapter available, using configuration-based approach`);
        }

        for (const keyword of keywords) {
            if (!this.isRunning) break;

            console.log(`Scraping keyword: ${keyword} in ${location}`);

            // For each keyword, we'll handle it differently based on the approach
            if (hasCustomSearch && hasCustomExtraction) {
                // Use platform-specific adapter methods for complete control
                console.log(`🔧 Using platform-specific adapter for keyword: ${keyword}`);

                try {
                    // Use adapter's custom search method - this should handle the keyword input once
                    const searchResults = await this.adapter!.searchBusinesses(
                        this.page!,
                        [keyword],
                        location
                    );

                    console.log(`🔍 Adapter search returned ${searchResults.length} results`);

                    // Now loop through pages for this keyword
                    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                        if (!this.isRunning) break;

                        // Wait if paused
                        while (this.isPaused && this.isRunning) {
                            await this.sleep(1000);
                        }

                        try {
                            let results: ScrapingResult[] = [];

                            // Use adapter's custom data extraction method
                            if (searchResults.length > 0) {
                                const businessData = await this.adapter!.extractBusinessData(this.page!);
                                console.log(`📊 Adapter extracted business data:`, businessData.business_name);
                                // Convert BusinessData to ScrapingResult format
                                results = [this.convertBusinessDataToScrapingResult(businessData)];
                            }

                            // Add results to total
                            if (results.length > 0) {
                                totalResults = totalResults.concat(results);
                                console.log(`Found ${results.length} results from page ${pageNum}`);
                            }

                            // Report progress
                            const progress: ScrapingProgress = {
                                currentPage: pageNum,
                                totalPages: maxPages,
                                resultsCount: totalResults.length,
                                percentage: (pageNum / maxPages) * 100
                            };
                            this.reportProgress(progress);

                            // Check for Cloudflare protection after processing each page
                            await this.handleCloudflareDetection();

                            // Check for robot verification challenge after processing each page
                            await this.handleRobotVerificationDetection();

                            // Check if paused after each major operation
                            if (this.isPaused) {
                                console.log(`Task ${this.taskData.taskId} is paused, waiting for resume...`);
                                try {
                                    await this.pause();
                                } catch (error) {
                                    console.log(`Task ${this.taskData.taskId} was stopped while paused`);
                                    break;
                                }
                            }

                             // Wait if paused
                             while (this.isPaused && this.isRunning) {
                                await this.sleep(1000);
                            }

                            // Check if robot verification was detected and paused the task
                            if (!this.isRunning) {
                                console.log(`Task ${this.taskData.taskId} stopped due to robot verification challenge`);
                                break;
                            }
                           

                            // Handle pagination using adapter if available
                            if (hasCustomPagination && pageNum < maxPages) {
                                console.log(`📄 Using adapter pagination for page ${pageNum}`);
                                await this.adapter!.handlePagination(this.page!, maxPages);
                            }

                            // Delay between requests
                            if (pageNum < maxPages) {
                                await this.sleep(delayBetweenRequests);
                            }

                        } catch (error) {
                            console.error(`Error scraping page ${pageNum}:`, error);
                            // Continue with next page
                        }
                    }

                } catch (error) {
                    console.error(`❌ Error using platform-specific adapter:`, error);
                    console.log(`🔄 Falling back to generic scraping logic`);
                    // Fallback to generic method
                    await this.scrapeKeywordWithGenericMethod(keyword, location, maxPages, delayBetweenRequests, totalResults);
                }

            } else if (hasCustomExtraction) {
                // Use adapter's custom data extraction but generic navigation
                console.log(`🔧 Using hybrid approach: generic navigation + custom extraction for keyword: ${keyword}`);
                await this.scrapeKeywordWithGenericMethod(keyword, location, maxPages, delayBetweenRequests, totalResults, true);

            } else {
                // Fallback to generic scraping logic
                console.log(`🔧 Using generic scraping logic for keyword: ${keyword}`);
                await this.scrapeKeywordWithGenericMethod(keyword, location, maxPages, delayBetweenRequests, totalResults);
            }
        }

        // Complete session recording and save if results > 1
        if (this.sessionManager.getRecordingStatus()) {
            console.log(`📹 Completing session recording with ${totalResults.length} results`);
            await this.sessionManager.endSession(totalResults.length, totalResults);
            await this.sessionManager.saveSession();
        }

        // Filter out duplicate results before returning
        const uniqueResults = this.filterDuplicateResults(totalResults);
        console.log(`🔍 Filtered ${totalResults.length} results to ${uniqueResults.length} unique results`);

        return uniqueResults;
    }

    /**
     * Helper method to scrape a keyword using generic methods
     * This method inputs the keyword once, then loops through pages
     */
    private async scrapeKeywordWithGenericMethod(
        keyword: string,
        location: string,
        maxPages: number,
        delayBetweenRequests: number,
        totalResults: ScrapingResult[],
        useCustomExtraction: boolean = false
    ): Promise<void> {
        // Input the keyword once for this keyword
        await this.navigateToSearchPage(keyword, location, 1);

        // Wait if paused
        while (this.isPaused && this.isRunning) {
            await this.sleep(1000);
        }

        // Enhanced pagination loop that supports both traditional pagination and "load more" functionality
        let currentPage = 1;
        let hasMoreContent = true;

        while (currentPage <= maxPages && hasMoreContent && this.isRunning) {
            // Wait if paused
            while (this.isPaused && this.isRunning) {
                await this.sleep(1000);
            }

            try {
                let results: ScrapingResult[] = [];

                if (currentPage === 1) {
                    // For first page, we're already on the search results
                    if (useCustomExtraction && this.adapter) {
                        // Use adapter's custom data extraction
                        const businessData = await this.adapter.extractBusinessData(this.page!);
                        console.log(`📊 Adapter extracted business data:`, businessData.business_name);
                        results = [this.convertBusinessDataToScrapingResult(businessData)];
                    } else {
                        // Extract business data using generic method
                        results = await this.extractBusinessData();
                    }
                } else {
                    // For subsequent pages, use enhanced pagination handling
                    hasMoreContent = await this.handleEnhancedPagination(currentPage - 1, maxPages);

                    if (!hasMoreContent) {
                        console.log(`⚠️ No more content available, stopping pagination`);
                        break;
                    }

                    // Wait if paused
                    while (this.isPaused && this.isRunning) {
                        await this.sleep(1000);
                    }

                    if (useCustomExtraction && this.adapter) {
                        // Use adapter's custom data extraction
                        const businessData = await this.adapter.extractBusinessData(this.page!);
                        console.log(`📊 Adapter extracted business data:`, businessData.business_name);
                        results = [this.convertBusinessDataToScrapingResult(businessData)];
                    } else {
                        // Extract business data using generic method
                        results = await this.extractBusinessData();
                    }
                }

                // Add results to total
                if (results.length > 0) {
                    totalResults.push(...results);
                    console.log(`Found ${results.length} results from page ${currentPage}`);
                }

                // Report progress
                const progress: ScrapingProgress = {
                    currentPage: currentPage,
                    totalPages: maxPages,
                    resultsCount: totalResults.length,
                    percentage: (currentPage / maxPages) * 100
                };
                this.reportProgress(progress);

                // Check for Cloudflare protection after processing each page
                await this.handleCloudflareDetection();

                // Check for robot verification challenge after processing each page
                await this.handleRobotVerificationDetection();

                // Check if paused after each major operation
                if (this.isPaused) {
                    console.log(`Task ${this.taskData.taskId} is paused, waiting for resume...`);
                    try {
                        await this.pause();
                    } catch (error) {
                        console.log(`Task ${this.taskData.taskId} was stopped while paused`);
                        break;
                    }
                }

                while (this.isPaused) {
                    await this.sleep(1000);
                }
                // Check if robot verification was detected and paused the task
                // if (!this.isRunning) {
                //     console.log(`Task ${this.taskData.taskId} stopped due to robot verification challenge`);
                //     break;
                // }

                // Delay between requests and increment page counter
                if (currentPage < maxPages && hasMoreContent) {
                    await this.sleep(delayBetweenRequests);
                }

                currentPage++;

            } catch (error) {
                console.error(`Error scraping page ${currentPage}:`, error);
                // Continue with next page
                currentPage++;
            }
        }
    }

    /**
     * Navigate to search page using human-like interaction
     */
    private async navigateToSearchPage(keyword: string, location: string, pageNum: number): Promise<void> {
        if (!this.page) {
            throw new Error('Page is not initialized');
        }

        try {
            // Navigate to base URL first
            console.log(`Navigating to base URL: ${this.platformInfo.base_url}`);

            // Log action for AI training
            if (this.sessionManager.getRecordingStatus() && this.page) {
                const currentState = await this.sessionManager.capturePageState(this.page);
                this.sessionManager.logAction(currentState, `goto('${this.platformInfo.base_url}')`);
            }

            await this.page.goto(this.platformInfo.base_url, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Wait for page to load completely
            await this.sleep(2000);

            // Check for Cloudflare protection after page load and handle with retry
            const cloudflareHandled = await this.handleCloudflareWithRetry();
            if (!cloudflareHandled) {
                console.log('⚠️ Cloudflare protection could not be resolved, but continuing with scraping...');
            }

            // Call custom onPageLoad method if it exists in the adapter (BEFORE any form interaction)
            if (this.adapter && typeof this.adapter.onPageLoad === 'function') {
                try {
                    console.log('🔧 Calling custom onPageLoad method from adapter (before form interaction)');
                    await this.adapter.onPageLoad(this.page!);
                    console.log('✅ Custom onPageLoad method completed successfully');
                } catch (error) {
                    console.warn('⚠️ Error in custom onPageLoad method:', error);
                    // Don't fail the scraping process if onPageLoad fails
                }
            } else {
                console.log('🔧 No custom onPageLoad method found, continuing with default flow');
            }

            // Check if platform has search form selectors defined
            const hasSearchFormSelectors = this.platformInfo.selectors.searchForm &&
                typeof this.platformInfo.selectors.searchForm === 'object' &&
                'keywordInput' in this.platformInfo.selectors.searchForm;

            if (hasSearchFormSelectors) {
                // Use platform-defined search form selectors
                console.log('Using platform-defined search form selectors');
                await this.fillSearchFormWithPlatformSelectors(keyword, location);

                // Submit the form using platform selector
                await this.submitSearchFormWithPlatformSelector();

                // Wait for search results to load
                await this.page.waitForSelector(this.platformInfo.selectors.businessList, {
                    timeout: 15000
                });

                // Capture search page URL for later reference
                this.searchPageUrl = this.page.url();
                console.log(`📝 Captured search page URL: ${this.searchPageUrl}`);

                // Navigate to specific page if needed
                if (pageNum > 1) {
                    await this.navigateToPage(pageNum);
                }
            } else {
                // Fallback to generic search form detection
                console.log('No platform search form selectors found, using generic detection');
                const searchForm = await this.findSearchForm();
                if (searchForm) {
                    // Fill in search form like a human would
                    await this.fillSearchForm(keyword, location);

                    // Submit the form
                    await this.submitSearchForm();

                    // Wait for search results to load
                    await this.page.waitForSelector(this.platformInfo.selectors.businessList, {
                        timeout: 15000
                    });

                    // Capture search page URL for later reference
                    this.searchPageUrl = this.page.url();
                    console.log(`📝 Captured search page URL: ${this.searchPageUrl}`);

                    // Navigate to specific page if needed
                    if (pageNum > 1) {
                        await this.navigateToPage(pageNum);
                    }
                } else {
                    // Fallback to URL-based navigation if no form found
                    console.log('No search form found, using URL-based navigation');
                    const searchUrl = this.buildFallbackSearchUrl(keyword, location, pageNum);
                    await this.page.goto(searchUrl, { waitUntil: 'networkidle2' });

                    // Capture search page URL for later reference
                    this.searchPageUrl = this.page.url();
                    console.log(`📝 Captured search page URL: ${this.searchPageUrl}`);

                    // Check for Cloudflare protection after URL-based navigation
                    await this.handleCloudflareDetection();

                    // Check for robot verification challenge after URL-based navigation
                    await this.handleRobotVerificationDetection();
                }
            }

            // Wait for content to settle
            await this.sleep(1000);

        } catch (error) {
            console.error('Error navigating to search page:', error);
            throw error;
        }
    }

    /**
     * Find search form on the page
     */
    private async findSearchForm(): Promise<boolean> {
        if (!this.page) return false;

        try {
            // Common search form selectors
            const formSelectors = [
                'form[action*="search"]',
                'form[action*="find"]',
                'form[action*="lookup"]',
                '.search-form',
                '#search-form',
                '[data-testid*="search"]',
                'input[name*="search"]',
                'input[name*="keyword"]',
                'input[name*="q"]'
            ];

            for (const selector of formSelectors) {
                const element = await this.page.$(selector);
                if (element) {
                    console.log(`Found search form with selector: ${selector}`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error('Error finding search form:', error);
            return false;
        }
    }

    /**
     * Fill search form with keyword and location
     */
    private async fillSearchForm(keyword: string, location: string): Promise<void> {
        if (!this.page) return;

        try {
            // Common input field selectors
            const keywordSelectors = [
                'input[name="q"]',
                'input[name="keyword"]',
                'input[name="search"]',
                'input[name="query"]',
                'input[placeholder*="search"]',
                'input[placeholder*="keyword"]',
                'input[type="text"]'
            ];

            const locationSelectors = [
                'input[name="location"]',
                'input[name="city"]',
                'input[name="state"]',
                'input[name="zip"]',
                'input[name="address"]',
                'input[placeholder*="location"]',
                'input[placeholder*="city"]',
                'input[placeholder*="zip"]'
            ];

            // Fill keyword field with human-like behavior
            let keywordField: any = null;
            for (const selector of keywordSelectors) {
                keywordField = await this.page.$(selector);
                if (keywordField) {
                    console.log(`Filling keyword field: ${selector}`);
                    break;
                }
            }

            if (keywordField && this.page) {
                const selector = keywordSelectors.find(s => this.page!.$(s));
                if (selector) {
                    await this.humanLikeType(this.page, selector, keyword);
                }
            }

            // Small pause between fields
            await this.sleep(Math.random() * 300 + 200);

            // Fill location field if found
            let locationField: any = null;
            for (const selector of locationSelectors) {
                locationField = await this.page.$(selector);
                if (locationField) {
                    console.log(`Filling location field: ${selector}`);
                    break;
                }
            }

            if (locationField && this.page) {
                const selector = locationSelectors.find(s => this.page!.$(s));
                if (selector) {
                    await this.humanLikeType(this.page, selector, location);
                }
            }

            // Wait a bit after filling forms
            await this.sleep(Math.random() * 500 + 300);

        } catch (error) {
            console.error('Error filling search form:', error);
        }
    }



    /**
     * Fill search form using platform-defined selectors
     */
    private async fillSearchFormWithPlatformSelectors(keyword: string, location: string): Promise<void> {
        if (!this.page || !this.platformInfo.selectors.searchForm) return;

        try {
            const searchForm = this.platformInfo.selectors.searchForm;

            // Fill keyword field if selector exists
            if (searchForm.keywordInput) {
                const keywordField = await this.page.$(searchForm.keywordInput);
                if (keywordField) {
                    console.log(`Filling keyword field with platform selector: ${searchForm.keywordInput}`);

                    // Log action for AI training
                    if (this.sessionManager.getRecordingStatus() && this.page) {
                        const currentState = await this.sessionManager.capturePageState(this.page);
                        this.sessionManager.logAction(currentState, `type('${searchForm.keywordInput}', '${keyword}')`);
                    }
                    // Scroll the page to bring the keyword field into view
                    await keywordField.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));

                    // Clear field first
                    await keywordField.click({ clickCount: 3 });
                    await keywordField.type(keyword, { delay: 100 }); // Human-like typing
                } else {
                    console.warn(`Keyword input field not found with selector: ${searchForm.keywordInput}`);
                }
            }

            // Fill location field if selector exists
            if (searchForm.locationInput) {
                const locationField = await this.page.$(searchForm.locationInput);
                if (locationField) {
                    console.log(`Filling location field with platform selector: ${searchForm.locationInput}`);

                    // Log action for AI training
                    if (this.sessionManager.getRecordingStatus() && this.page) {
                        const currentState = await this.sessionManager.capturePageState(this.page);
                        this.sessionManager.logAction(currentState, `type('${searchForm.locationInput}', '${location}')`);
                    }

                    // Clear field first
                    await locationField.click({ clickCount: 3 });
                    await locationField.type(location, { delay: 100 }); // Human-like typing
                } else {
                    console.warn(`Location input field not found with selector: ${searchForm.locationInput}`);
                }
            }

            // Wait a bit after filling forms
            await this.sleep(500);

        } catch (error) {
            console.error('Error filling search form with platform selectors:', error);
        }
    }

    /**
     * Submit search form using platform-defined selector
     */
    private async submitSearchFormWithPlatformSelector(): Promise<void> {
        if (!this.page || !this.platformInfo.selectors.searchForm) return;

        try {
            const searchForm = this.platformInfo.selectors.searchForm;

            if (searchForm.searchButton) {
                const submitButton = await this.page.$(searchForm.searchButton);
                if (submitButton) {
                    console.log(`Submitting search form with platform selector: ${searchForm.searchButton}`);

                    // Log action for AI training
                    if (this.sessionManager.getRecordingStatus() && this.page) {
                        const currentState = await this.sessionManager.capturePageState(this.page);
                        this.sessionManager.logAction(currentState, `click('${searchForm.searchButton}')`);
                    }

                    await submitButton.click();
                } else {
                    console.warn(`Search button not found with selector: ${searchForm.searchButton}`);

                    // Log action for AI training (fallback)
                    if (this.sessionManager.getRecordingStatus() && this.page) {
                        const currentState = await this.sessionManager.capturePageState(this.page);
                        this.sessionManager.logAction(currentState, `keyboard.press('Enter')`);
                    }

                    // Fallback to Enter key
                    await this.page.keyboard.press('Enter');
                    console.log('Submitted search form using Enter key (fallback)');
                }
            } else {
                // No search button selector, try Enter key

                // Log action for AI training
                if (this.sessionManager.getRecordingStatus() && this.page) {
                    const currentState = await this.sessionManager.capturePageState(this.page);
                    this.sessionManager.logAction(currentState, `keyboard.press('Enter')`);
                }
                // INSERT_YOUR_CODE
                // Scroll the search button into view before clicking or pressing Enter
                if (searchForm.searchButton) {
                    const submitButton = await this.page.$(searchForm.searchButton);
                    if (submitButton) {
                        await submitButton.evaluate((el: Element) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                    }
                }
                await this.page.keyboard.press('Enter');
                console.log('Submitted search form using Enter key (no button selector)');
            }

            // Wait for navigation
            await this.page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: 15000
            });

            // Check for Cloudflare protection after form submission
            await this.handleCloudflareDetection();

            // Check for robot verification challenge after form submission
            await this.handleRobotVerificationDetection();

        } catch (error) {
            console.error('Error submitting search form with platform selector:', error);
        }
    }

    /**
     * Navigate to specific page number
     */
    private async navigateToPage(pageNum: number): Promise<void> {
        if (!this.page || pageNum <= 1) return;

        try {
            // Check if platform has pagination selectors defined
            const hasPaginationSelectors = this.platformInfo.selectors.pagination &&
                typeof this.platformInfo.selectors.pagination === 'object';

            if (hasPaginationSelectors) {
                // Use platform-defined pagination selectors
                await this.navigateToPageWithPlatformSelectors(pageNum);
            } else {
                // Fallback to generic pagination detection
                await this.navigateToPageWithGenericSelectors(pageNum);
            }

        } catch (error) {
            console.error(`Error navigating to page ${pageNum}:`, error);
        }
    }

    /**
     * Navigate to page using platform-defined pagination selectors
     */
    private async navigateToPageWithPlatformSelectors(pageNum: number): Promise<void> {
        if (!this.page || !this.platformInfo.selectors.pagination) return;

        try {
            const pagination = this.platformInfo.selectors.pagination;

            // Try to find page number link using platform selector
            if (pagination.pageNumbers) {
                const pageSelector = pagination.pageNumbers.replace('{page}', pageNum.toString());
                const pageLink = await this.page.$(pageSelector);

                if (pageLink) {
                    console.log(`Found page ${pageNum} link with platform selector: ${pageSelector}`);
                    await pageLink.click();
                    await this.page.waitForNavigation({
                        waitUntil: 'networkidle2',
                        timeout: 15000
                    });
                    console.log(`Navigated to page ${pageNum} using platform selector`);

                    // Check for Cloudflare protection after navigation
                    await this.handleCloudflareDetection();

                    // Check for robot verification challenge after navigation
                    await this.handleRobotVerificationDetection();

                    return;
                }
            }

            // Fallback to generic selectors if platform selector doesn't work
            console.log('Platform pagination selector failed, falling back to generic selectors');
            await this.navigateToPageWithGenericSelectors(pageNum);

        } catch (error) {
            console.error(`Error navigating to page ${pageNum} with platform selectors:`, error);
            // Fallback to generic selectors
            await this.navigateToPageWithGenericSelectors(pageNum);
        }
    }

    /**
     * Navigate to page using generic pagination selectors (fallback)
     */
    private async navigateToPageWithGenericSelectors(pageNum: number): Promise<void> {
        if (!this.page) return;

        try {
            // Common pagination selectors
            const paginationSelectors = [
                `a[href*="page=${pageNum}"]`,
                `a[href*="p=${pageNum}"]`,
                `a[href*="pg=${pageNum}"]`,
                `button[data-page="${pageNum}"]`,
                `[data-testid="page-${pageNum}"]`,
                `a:contains("${pageNum}")`
            ];

            let pageLink: any = null;
            for (const selector of paginationSelectors) {
                pageLink = await this.page.$(selector);
                if (pageLink) {
                    console.log(`Found page ${pageNum} link: ${selector}`);
                    break;
                }
            }

            if (pageLink) {
                await pageLink.click();
                await this.page.waitForNavigation({
                    waitUntil: 'networkidle2',
                    timeout: 15000
                });
                console.log(`Navigated to page ${pageNum}`);

                // Check for Cloudflare protection after navigation
                await this.handleCloudflareDetection();

                // Check for robot verification challenge after navigation
                await this.handleRobotVerificationDetection();
            } else {
                console.log(`Could not find page ${pageNum} link, staying on current page`);
            }

        } catch (error) {
            console.error(`Error navigating to page ${pageNum} with generic selectors:`, error);
        }
    }

    /**
     * Build fallback search URL (used when form interaction fails)
     */
    private buildFallbackSearchUrl(keyword: string, location: string, pageNum: number): string {
        const settings = this.platformInfo.settings || {};
        const searchUrlPattern = settings.searchUrlPattern || `${this.platformInfo.base_url}/search`;

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
    private async extractBusinessData(): Promise<ScrapingResult[]> {
        const selectors = this.platformInfo.selectors;
        const results: ScrapingResult[] = [];

        try {
            if (!this.page) {
                throw new Error('Page is not initialized');
            }
            // Wait for business list to load
            await this.page.waitForSelector(selectors.businessList, { timeout: 10000 });

            // Check for Cloudflare protection before proceeding with data extraction
            await this.handleCloudflareDetection();

            // Check for robot verification challenge before proceeding with data extraction
            await this.handleRobotVerificationDetection();

            // Check if robot verification was detected and paused the task
            // Wait if paused
            while (this.isPaused && this.isRunning) {
                await this.sleep(1000);
            }

            // Log data extraction action for AI training
            if (this.sessionManager.getRecordingStatus() && this.page) {
                const currentState = await this.sessionManager.capturePageState(this.page);
                this.sessionManager.logAction(currentState, `extract('${selectors.businessList}')`);
            }
            console.log('selectors.businessItem', selectors.businessItem);
            // Extract all business listings
            const businessElements = await this.page.$$(selectors.businessItem);
            console.log(`Found ${businessElements.length} business listings`);

            // Track processed businesses to prevent duplicates when platforms add more results to current page
            const processedBusinessIds = new Set<string>();

            // Store selectors for re-querying after page re-renders
            const businessSelectors = {
                businessItem: selectors.businessItem,
                businessList: selectors.businessList,
                businessName: selectors.businessName,
                email: selectors.email,
                phone: selectors.phone,
                website: selectors.website,
                address: selectors.address,
                address_city: selectors.address_city,
                address_state: selectors.address_state,
                address_zip: selectors.address_zip,
                address_country: selectors.address_country,
                socialMedia: selectors.socialMedia,
                categories: selectors.categories,
                businessHours: selectors.businessHours,
                description: selectors.description,
                rating: selectors.rating,
                reviewCount: selectors.reviewCount,
                faxNumber: selectors.faxNumber,
                contactPerson: selectors.contactPerson,
                yearEstablished: selectors.yearEstablished,
                numberOfEmployees: selectors.numberOfEmployees,
                paymentMethods: selectors.paymentMethods,
                specialties: selectors.specialties,
                navigation: selectors.navigation
            };

            for (let i = 0; i < businessElements.length; i++) {
                if (!this.isRunning) break;

                try {
                    // Log current item being processed
                    const itemNumber = i + 1; // Convert to 1-based indexing for user-friendly display
                    console.log(`\n📋 Processing business item ${itemNumber}/${businessElements.length}`);

                    // Re-query the element after each detail page navigation to handle page re-renders
                    let currentElement = businessElements[i];

                    // Check if element is still valid, if not, re-query it
                    try {
                        await currentElement.evaluate(el => el.isConnected);
                    } catch (error) {
                        console.log(`Element ${itemNumber} became stale, re-querying...`);
                        const freshElements = await this.page!.$$(businessSelectors.businessItem);
                        if (freshElements[i]) {
                            currentElement = freshElements[i];
                            console.log(`✅ Successfully re-queried element ${itemNumber}`);
                        } else {
                            console.error(`❌ Could not re-query element ${itemNumber}, skipping`);
                            continue;
                        }
                    }

                    // Generate a unique identifier for this business to prevent duplicates
                    const businessId = await this.generateBusinessIdentifier(currentElement, businessSelectors);

                    // Check if this business has already been processed
                    if (processedBusinessIds.has(businessId)) {
                        console.log(`🔄 Skipping duplicate business: ${businessId}`);
                        continue;
                    }

                    // Mark this business as processed
                    processedBusinessIds.add(businessId);

                    const result = await this.extractBusinessFromElement(currentElement, businessSelectors);
                    console.log(`📊 Extraction result for item ${itemNumber}:`, result?.business_name || 'No business name found');
                    if (result) {
                        // Check if navigation to detail page is available
                        if (businessSelectors.navigation?.detailLink) {
                            console.log(`🔗 Navigating to detail page for item ${itemNumber}`);
                            console.log('detailLink', businessSelectors.navigation.detailLink);
                            const enhancedResult = await this.navigateToDetailPageAndExtract(currentElement, businessSelectors, result);
                            if (enhancedResult) {
                                results.push(enhancedResult);
                                console.log(`✅ Enhanced data extracted for item ${itemNumber}: ${enhancedResult.business_name}`);
                            } else {
                                console.log(`⚠️ No enhanced data for item ${itemNumber}, using basic result`);
                                results.push(result);
                            }

                            // After returning from detail page, re-query all elements to handle page re-render
                            console.log(`🔄 Re-querying business elements after detail page navigation for item ${itemNumber}...`);
                            const refreshedElements = await this.page!.$$(businessSelectors.businessItem);
                            if (refreshedElements.length > 0) {
                                // Update the businessElements array with fresh references
                                businessElements.splice(0, businessElements.length, ...refreshedElements);
                                console.log(`✅ Refreshed ${businessElements.length} business elements after item ${itemNumber}`);

                                // Check if new businesses were added (indicating "load more" functionality)
                                if (refreshedElements.length > processedBusinessIds.size) {
                                    console.log(`🆕 Detected ${refreshedElements.length - processedBusinessIds.size} new businesses added to page`);
                                }
                            }
                        } else {
                            results.push(result);
                            console.log(`✅ Basic data extracted for item ${itemNumber}: ${result.business_name}`);
                        }
                    } else {
                        console.log(`⚠️ No data extracted for item ${itemNumber}`);
                    }

                    // Log progress summary
                    console.log(`📈 Progress: ${results.length}/${businessElements.length} items processed successfully`);

                } catch (error) {
                    console.error(`❌ Error processing item ${i + 1}:`, error);
                    // Continue with next element
                }
            }

        } catch (error) {
            console.error('Error extracting business data from page:', error);
        }

        return results;
    }

    /**
     * Generate a unique identifier for a business to prevent duplicate extraction
     * Uses business name, phone, and address to create a reliable identifier
     */
    private async generateBusinessIdentifier(element: any, selectors: any): Promise<string> {
        try {
            const identifierParts: string[] = [];

            // Extract business name
            if (selectors.businessName) {
                const name = await element.$(selectors.businessName);
                if (name) {
                    const nameText = await name.evaluate(el => el.textContent?.trim() || '');
                    if (nameText) {
                        identifierParts.push(`name:${nameText.toLowerCase()}`);
                    }
                }
            }

            // Extract phone number for identifier (basic extraction only)
            let phoneText: string | undefined = undefined;
            if (selectors.phone) {
                const phone = await element.$(selectors.phone);
                if (phone) {
                    phoneText = await phone.evaluate(el => el.textContent?.trim() || '');
                }
            }

            if (phoneText) {
                // Clean phone number to standardize format
                const cleanPhone = phoneText.replace(/[^\d+]/g, '');
                if (cleanPhone) {
                    identifierParts.push(`phone:${cleanPhone}`);
                }
            }

            // Extract address
            if (selectors.address) {
                const address = await element.$(selectors.address);
                if (address) {
                    const addressText = await address.evaluate(el => el.textContent?.trim() || '');
                    if (addressText) {
                        identifierParts.push(`addr:${addressText.toLowerCase()}`);
                    }
                }
            }

            // Extract website URL
            if (selectors.website) {
                const website = await element.$(selectors.website);
                if (website) {
                    const websiteUrl = await website.evaluate(el => el.getAttribute('href') || '');
                    if (websiteUrl) {
                        identifierParts.push(`url:${websiteUrl.toLowerCase()}`);
                    }
                }
            }

            // If we have enough data, create a hash-like identifier
            if (identifierParts.length > 0) {
                return identifierParts.join('|');
            }

            // Fallback: use element position and basic text content
            const fallbackText = await element.evaluate(el => el.textContent?.trim() || '');
            const elementIndex = await element.evaluate(el => {
                const parent = el.parentElement;
                if (parent) {
                    return Array.from(parent.children).indexOf(el);
                }
                return 0;
            });

            return `fallback:${elementIndex}:${fallbackText.substring(0, 50).toLowerCase()}`;

        } catch (error) {
            console.warn('Error generating business identifier:', error);
            // Ultimate fallback: use timestamp and element reference
            return `error:${Date.now()}:${Math.random()}`;
        }
    }

    /**
     * Check if the platform uses "load more" functionality instead of traditional pagination
     * This helps prevent duplicate extraction when new results are added to the current page
     */
    private async detectLoadMoreFunctionality(): Promise<boolean> {
        if (!this.page) return false;

        try {
            // Common "load more" button selectors
            const loadMoreSelectors = [
                'button[data-testid="load-more"]',
                'button[data-testid="loadMore"]',
                'button[data-testid="show-more"]',
                'button[data-testid="showMore"]',
                'button:contains("Load More")',
                'button:contains("Show More")',
                'button:contains("Load more")',
                'button:contains("Show more")',
                'a[data-testid="load-more"]',
                'a[data-testid="loadMore"]',
                'a:contains("Load More")',
                'a:contains("Show More")',
                'a.next-page-btn',
                '.load-more',
                '.loadMore',
                '.show-more',
                '.showMore',
                '[class*="load-more"]',
                '[class*="loadMore"]',
                '[class*="show-more"]',
                '[class*="showMore"]'
            ];

            for (const selector of loadMoreSelectors) {
                try {
                    const loadMoreButton = await this.page.$(selector);
                    if (loadMoreButton) {
                        const isVisible = await loadMoreButton.isVisible();
                        if (isVisible) {
                            console.log(`🔍 Detected "Load More" functionality with selector: ${selector}`);
                            return true;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            // Check for infinite scroll indicators
            const infiniteScrollIndicators = [
                '[data-testid="infinite-scroll"]',
                '[class*="infinite-scroll"]',
                '[class*="infiniteScroll"]',
                '.infinite-scroll',
                '.infiniteScroll'
            ];

            for (const selector of infiniteScrollIndicators) {
                try {
                    const indicator = await this.page.$(selector);
                    if (indicator) {
                        console.log(`🔍 Detected infinite scroll functionality with selector: ${selector}`);
                        return true;
                    }
                } catch (error) {
                    continue;
                }
            }

            return false;
        } catch (error) {
            console.warn('Error detecting load more functionality:', error);
            return false;
        }
    }

    /**
     * Handle "load more" functionality by clicking the load more button and waiting for new content
     */
    private async handleLoadMoreFunctionality(): Promise<boolean> {
        if (!this.page) return false;

        try {
            // Common "load more" button selectors
            const loadMoreSelectors = [
                'button[data-testid="load-more"]',
                'button[data-testid="loadMore"]',
                'button[data-testid="show-more"]',
                'button[data-testid="showMore"]',
                'button:contains("Load More")',
                'button:contains("Show More")',
                'button:contains("Load more")',
                'button:contains("Show more")',
                'a[data-testid="load-more"]',
                'a[data-testid="loadMore"]',
                'a:contains("Load More")',
                'a:contains("Show More")',
                '.load-more',
                '.loadMore',
                '.show-more',
                '.showMore',
                '[class*="load-more"]',
                '[class*="loadMore"]',
                '[class*="show-more"]',
                '[class*="showMore"]'
            ];

            for (const selector of loadMoreSelectors) {
                try {
                    const loadMoreButton = await this.page.$(selector);
                    if (loadMoreButton) {
                        const isVisible = await loadMoreButton.isVisible();
                        const isClickable = await loadMoreButton.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            const style = window.getComputedStyle(el);
                            const htmlEl = el as HTMLElement;
                            const buttonEl = el as HTMLButtonElement;
                            return rect.width > 0 &&
                                rect.height > 0 &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                !buttonEl.disabled &&
                                htmlEl.offsetParent !== null;
                        });

                        if (isVisible && isClickable) {
                            console.log(`🔄 Clicking "Load More" button with selector: ${selector}`);

                            // Store current number of business elements
                            const currentBusinessCount = await this.page.$$(this.platformInfo.selectors.businessItem).then(elements => elements.length);

                            // Click the load more button
                            await loadMoreButton.click();

                            // Wait for new content to load
                            await this.sleep(3000);

                            // Wait for new business elements to appear
                            await this.page.waitForFunction(
                                (selector, previousCount) => {
                                    const elements = document.querySelectorAll(selector);
                                    return elements.length > previousCount;
                                },
                                { timeout: 10000 },
                                this.platformInfo.selectors.businessItem,
                                currentBusinessCount
                            );

                            // Get new count
                            const newBusinessCount = await this.page.$$(this.platformInfo.selectors.businessItem).then(elements => elements.length);
                            const newBusinesses = newBusinessCount - currentBusinessCount;

                            console.log(`✅ Loaded ${newBusinesses} new businesses (${currentBusinessCount} → ${newBusinessCount})`);
                            return true;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            return false;
        } catch (error) {
            console.warn('Error handling load more functionality:', error);
            return false;
        }
    }

    /**
     * Enhanced pagination handling that supports both traditional pagination and "load more" functionality
     */
    private async handleEnhancedPagination(currentPage: number, maxPages: number): Promise<boolean> {
        if (!this.page) return false;

        try {
            // Check if we're currently in a new tab (detail page) and need to switch back to search page
            if (this.isInNewTab) {
                console.log('🆕 Currently in new tab, switching back to search page for pagination');

                // Close the current detail page
                await this.page.close();

                // Find and switch to the search results page
                const browser = this.page.browser();
                if (browser) {
                    const pages = await browser.pages();
                    const searchResultsPage = await this.findSearchResultsPage(pages);

                    if (searchResultsPage) {
                        this.page = searchResultsPage;
                        console.log(`🔍 Switched back to search results page: ${searchResultsPage.url()}`);

                        // Wait for search results to be ready
                        await searchResultsPage.waitForSelector(this.platformInfo.selectors.businessList, { timeout: 10000 });

                        // Update captured search page URL
                        this.searchPageUrl = searchResultsPage.url();
                        console.log(`📝 Updated search page URL: ${this.searchPageUrl}`);

                        // Check for Cloudflare protection
                        await this.handleCloudflareDetection();

                        // Clear the new tab flag
                        this.isInNewTab = false;

                        console.log('✅ Successfully switched back to search page for pagination');
                    } else {
                        console.log('⚠️ Could not find search results page after closing detail tab');
                        return false;
                    }
                }
            }

            // Scroll the page down to trigger any lazy-loaded "load more" buttons or infinite scroll
            if (this.page) {
                await this.page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
            }
            // Give the page a moment to load new content if applicable
            await this.sleep(1000);
            // First, try traditional pagination
            console.log(`📄 Attempting traditional pagination for page ${currentPage + 1}`);
            const traditionalPaginationWorked = await this.navigateToNextPage();

            if (traditionalPaginationWorked) {
                console.log(`✅ Traditional pagination successful for page ${currentPage + 1}`);
                return true;
            } else {
                console.log(`⚠️ Traditional pagination failed, checking for "Load More" functionality`);

                // Save HTML content for debugging when traditional pagination fails
                await this.savePageHtmlForDebugging(currentPage + 1, 'traditional_pagination_failed');

                // Fallback: Check if this platform uses "load more" functionality
                const usesLoadMore = await this.detectLoadMoreFunctionality();

                if (usesLoadMore) {
                    console.log(`🔄 Platform uses "Load More" functionality as fallback`);

                    // Try to load more content
                    const loadedMore = await this.handleLoadMoreFunctionality();
                    if (loadedMore) {
                        return true; // Successfully loaded more content
                    } else {
                        console.log(`⚠️ No more content to load or load more button not available`);
                        return false; // No more content available
                    }
                } else {
                    console.log(`⚠️ No pagination or load more functionality available`);
                    return false; // No pagination available
                }
            }
        } catch (error) {
            console.error('Error in enhanced pagination handling:', error);
            return false;
        }
    }

    /**
     * Navigate to next page using traditional pagination
     */
    private async navigateToNextPage(): Promise<boolean> {
        if (!this.page) return false;

        try {
            const selectors = this.platformInfo.selectors;

            // Check if platform has pagination selectors defined
            if (selectors.pagination && typeof selectors.pagination === 'object' && selectors.pagination.nextButton) {
                console.log(`📄 Checking for next page button: ${selectors.pagination.nextButton}`);
                const nextButton = await this.page.$(selectors.pagination.nextButton);

                if (nextButton) {
                    const isClickable = await nextButton.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        const htmlEl = el as HTMLElement;
                        const buttonEl = el as HTMLButtonElement;
                        return rect.width > 0 &&
                            rect.height > 0 &&
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            !buttonEl.disabled &&
                            htmlEl.offsetParent !== null;
                    });

                    if (isClickable) {
                        console.log(`🔄 Clicking next page button: ${selectors.pagination.nextButton}`);
                        await nextButton.click();

                        // Wait for navigation to complete
                        await this.page.waitForNavigation({
                            waitUntil: 'networkidle2',
                            timeout: 30000
                        });

                        // Wait for new results to load
                        await this.page.waitForSelector(selectors.businessList, { timeout: 10000 });

                        // Update captured search page URL after successful navigation
                        this.searchPageUrl = this.page.url();
                        console.log(`📝 Updated search page URL after pagination: ${this.searchPageUrl}`);

                        console.log(`✅ Successfully navigated to next page`);
                        return true;
                    }
                }
            }

            return false;
        } catch (error) {
            console.error('Error navigating to next page:', error);
            return false;
        }
    }

    /**
     * Navigate to detail page and extract enhanced data
     */
    private async navigateToDetailPageAndExtract(
        element: any,
        selectors: PlatformInfo['selectors'],
        basicResult: ScrapingResult
    ): Promise<ScrapingResult | null> {
        if (!this.page || !selectors.navigation?.detailLink) return basicResult;

        try {
            // Find the detail page link
            const detailLink = await element.$(selectors.navigation.detailLink);
            console.log('detailLink2', detailLink);
            if (!detailLink) {
                console.log('Detail link not found, using basic result');
                return basicResult;
            }

            // Check if the element is clickable (visible and enabled)
            const isClickable = await detailLink.evaluate(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    !el.disabled &&
                    el.offsetParent !== null;
            });

            if (!isClickable) {
                console.log('Detail link is not clickable, using basic result');
                return basicResult;
            }

            console.log('Detail link is clickable, clicking to navigate to detail page');

            // Store current page context for AI training
            if (this.sessionManager.getRecordingStatus() && this.page) {
                const currentState = await this.sessionManager.capturePageState(this.page);
                this.sessionManager.logAction(currentState, `click('${selectors.navigation.detailLink}')`);
            }

            // Click the detail link and handle both same-tab and new-tab scenarios
            await this.handleDetailLinkClick(detailLink);

            // Wait for page to load
            await this.sleep(selectors.navigation.delayAfterNavigation || 2000);

            // Check for Cloudflare protection after detail page navigation
            await this.handleCloudflareDetection();

            // Check for robot verification challenge after detail page navigation
            await this.handleRobotVerificationDetection();

            // Check if robot verification was detected and paused the task
            // Wait if paused
            while (this.isPaused && this.isRunning) {
                await this.sleep(1000);
            }

            // Call custom onPageLoad method if it exists in the adapter
            if (this.adapter && typeof this.adapter.onPageLoad === 'function') {
                try {
                    console.log('🔧 Calling custom onPageLoad method for detail page');
                    await this.adapter.onPageLoad(this.page);
                    console.log('✅ Custom onPageLoad method for detail page completed');
                } catch (error) {
                    console.warn('⚠️ Error in custom onPageLoad method for detail page:', error);
                    // Don't fail the process if onPageLoad fails
                }
            }

            // Capture detail page content for AI training if session recording is enabled
            if (this.sessionManager.getRecordingStatus() && this.page) {
                await this.captureDetailPageForTraining(basicResult.business_name);
            }

            // Extract enhanced data from detail page
            const enhancedResult = await this.extractEnhancedDataFromDetailPage(basicResult, selectors);

            // Navigate back to search results (if needed)
            await this.navigateBackToSearchResults(selectors);

            console.log('enhancedResult', enhancedResult);
            return enhancedResult;

        } catch (error) {
            console.error('Error navigating to detail page:', error);
            // Return basic result if navigation fails
            return basicResult;
        }
    }

    /**
     * Handle detail link click with automatic detection of new tab vs same-tab navigation
     */
    private async handleDetailLinkClick(detailLink: any): Promise<void> {
        if (!this.page) return;

        try {
            // Get current page count and URL before clicking
            const pagesBefore = await this.page.browser()?.pages() || [];
            const initialPageCount = pagesBefore.length;
            const initialUrl = this.page.url();

            console.log(`📄 Pages before click: ${initialPageCount}`);
            console.log(`🌐 Current URL: ${initialUrl}`);

            // Set up promises to wait for both navigation scenarios
            const navigationPromise = this.page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: 8000 // Shorter timeout for same-tab navigation
            }).catch(() => null); // Don't throw if no navigation occurs

            // This promise waits for a new browser tab (page) to be opened after clicking the detail link.
            // It uses Puppeteer's waitForTarget to detect when a new 'page' target appears.
            // We'll wait for any new page target, then validate if it's different from current page.
            const newPagePromise = new Promise<any>((resolve) => {
                const browser = this.page?.browser();
                if (!browser) {
                    resolve(null);
                    return;
                }

                const timeout = setTimeout(() => resolve(null), 8000);

                browser.on('targetcreated', async (target) => {
                    if (target.type() === 'page') {
                        try {
                            const newPage = await target.page();
                            if (newPage && newPage !== this.page) {
                                clearTimeout(timeout);
                                console.log(`🆕 New page detected: ${newPage.url()}`);
                                resolve(newPage);
                            }
                        } catch (error) {
                            // Continue waiting
                        }
                    }
                });
            });

            // Click the detail link
            await detailLink.click();
            console.log('🖱️ Detail link clicked');

            // Small delay to allow the browser to process the click
            await this.sleep(500);

            // Wait for either navigation or new page with a race condition
            const [navigationResult, newPageResult] = await Promise.allSettled([
                navigationPromise,
                newPagePromise
            ]);

            // Check the results and determine what happened
            const pagesAfter = await this.page.browser()?.pages() || [];
            const finalPageCount = pagesAfter.length;
            const currentUrl = this.page.url();

            console.log(`📄 Pages after click: ${finalPageCount} (was ${initialPageCount})`);
            console.log(`🌐 Current URL after click: ${currentUrl}`);
            console.log(`🌐 Initial URL: ${initialUrl}`);

            // Debug: Show all page URLs
            const allPages = await this.page.browser()?.pages() || [];
            console.log('📄 All page URLs:', allPages.map((p, i) => `${i}: ${p.url()}`));

            // Determine the navigation type based on results
            let newTabOpened = finalPageCount > initialPageCount &&
                newPageResult.status === 'fulfilled' &&
                newPageResult.value !== null;
            const sameTabNavigated = navigationResult.status === 'fulfilled' && navigationResult.value !== null;
            const urlChanged = currentUrl !== initialUrl;

            console.log(`🔍 Detection results: newTab=${newTabOpened}, sameTab=${sameTabNavigated}, urlChanged=${urlChanged}`);

            // Fallback: If event-based detection failed, manually check for new pages
            if (!newTabOpened && finalPageCount > initialPageCount) {
                console.log('🔍 Event detection failed, manually checking for new pages...');
                const allPages = await this.page.browser()?.pages() || [];
                const newPage = allPages.find(p =>
                    p !== this.page &&
                    p.url() !== initialUrl &&
                    p.url() !== 'about:blank' &&
                    !p.isClosed()
                );

                if (newPage) {
                    console.log('🆕 Found new page manually:', newPage.url());
                    newTabOpened = true;
                    // Update the result for the following logic
                    (newPageResult as any).value = newPage;
                    (newPageResult as any).status = 'fulfilled';
                }
            }

            if (newTabOpened) {
                // New tab was opened
                console.log('🆕 New tab detected, switching to it');
                const newPageInstance = (newPageResult as PromiseFulfilledResult<any>).value;

                // Mark that we're in a new tab scenario (for return navigation)
                this.isInNewTab = true;

                // Switch to the new detail page (search results page remains open automatically)
                this.page = newPageInstance;

                // Wait for the new page to load completely
                if (this.page) {
                    await this.page.waitForFunction(() => document.readyState === 'complete', { timeout: 30000 });
                    console.log(`🌐 New tab URL: ${this.page.url()}`);
                }

                console.log('✅ Successfully switched to new tab');
            } else if (sameTabNavigated || urlChanged) {
                // Same tab navigation occurred
                console.log('🔄 Same tab navigation detected');

                // Wait a bit more for the page to stabilize
                await this.sleep(1000);

                console.log('✅ Same tab navigation completed');
            } else {
                // No clear navigation occurred - this might be a JavaScript-based page update
                console.log('⚠️ No clear navigation detected, checking for dynamic content updates');

                // Wait a bit for any dynamic content to load
                await this.sleep(2000);

                // Check if the page content has changed (indicating a dynamic update)
                const hasContentChanged = await this.page.evaluate(() => {
                    // Simple check for common dynamic content indicators
                    return document.querySelector('.loading, .spinner') === null &&
                        document.querySelector('[data-loaded="true"]') !== null ||
                        document.readyState === 'complete';
                });

                if (hasContentChanged) {
                    console.log('✅ Dynamic content update detected');
                } else {
                    console.log('⚠️ No navigation or content update detected, continuing with current page');
                }
            }

        } catch (error) {
            console.error('❌ Error handling detail link click:', error);
            // Don't throw - let the process continue
        }
    }

    /**
     * Calculate URL similarity score between two URLs
     * Returns a score from 0 to 10 based on how similar the URLs are
     */
    private calculateUrlSimilarity(url1: string, url2: string): number {
        try {
            const parsedUrl1 = new URL(url1);
            const parsedUrl2 = new URL(url2);
            let score = 0;

            // Same hostname (most important)
            if (parsedUrl1.hostname === parsedUrl2.hostname) {
                score += 4;
            }

            // Same pathname base (without page numbers)
            const path1 = parsedUrl1.pathname.replace(/\/page\/\d+|\/p\/\d+|\?.*page=\d+/, '');
            const path2 = parsedUrl2.pathname.replace(/\/page\/\d+|\/p\/\d+|\?.*page=\d+/, '');
            if (path1 === path2) {
                score += 3;
            }

            // Similar query parameters (ignoring page numbers)
            const params1 = new URLSearchParams(parsedUrl1.search);
            const params2 = new URLSearchParams(parsedUrl2.search);

            // Remove page-related parameters for comparison
            ['page', 'p', 'offset', 'start'].forEach(param => {
                params1.delete(param);
                params2.delete(param);
            });

            const params1Str = params1.toString();
            const params2Str = params2.toString();

            if (params1Str === params2Str) {
                score += 2;
            } else if (params1Str && params2Str) {
                // Partial match for query parameters
                const sharedParams = Array.from(params1.keys()).filter(key => params2.has(key));
                if (sharedParams.length > 0) {
                    score += 1;
                }
            }

            // Same protocol
            if (parsedUrl1.protocol === parsedUrl2.protocol) {
                score += 0.5;
            }

            return Math.min(score, 10); // Cap at 10
        } catch (error) {
            console.log(`⚠️ Error calculating URL similarity: ${error}`);
            return 0;
        }
    }

    /**
     * Find the search results page among open browser pages
     * Uses multiple criteria to identify the correct search results page and avoid error pages
     */
    private async findSearchResultsPage(pages: any[]): Promise<any | null> {
        if (!pages || pages.length === 0) return null;

        console.log('🔍 Searching for search results page among open tabs...');

        if (this.searchPageUrl) {
            console.log(`📝 Using captured search page URL for similarity matching: ${this.searchPageUrl}`);
        }

        // Score each page based on multiple criteria
        const pageScores = await Promise.all(
            pages.map(async (page) => {
                if (page.isClosed()) return { page, score: -1 };

                try {
                    const url = page.url();
                    let score = 0;

                    // Skip about:blank and chrome:// pages
                    if (url === 'about:blank' || url.startsWith('chrome://')) {
                        return { page, score: -1 };
                    }

                    // PRIMARY CRITERION: URL similarity to captured search page URL
                    if (this.searchPageUrl) {
                        const similarityScore = this.calculateUrlSimilarity(url, this.searchPageUrl);
                        score += similarityScore; // This can be up to 10 points
                        console.log(`🔗 URL similarity to search page: ${similarityScore} (${url})`);
                    }

                    // SECONDARY CRITERIA (lower weights since URL similarity is primary)

                    // Check if URL contains base domain
                    if (url.includes(new URL(this.platformInfo.base_url).hostname)) {
                        score += 2; // Reduced from 3
                    }

                    // Check if URL contains search-related keywords
                    const searchKeywords = ['search', 'results', 'find', 'directory', 'listing'];
                    if (searchKeywords.some(keyword => url.toLowerCase().includes(keyword))) {
                        score += 1; // Reduced from 2
                    }

                    // Check if URL contains query parameters (typical for search results)
                    if (url.includes('?') && (url.includes('q=') || url.includes('query=') || url.includes('keyword='))) {
                        score += 1; // Reduced from 2
                    }

                    // Try to check if page contains business list selector
                    try {
                        const hasBusinessList = await page.$(this.platformInfo.selectors.businessList);
                        if (hasBusinessList) {
                            score += 3; // Reduced from 5 since URL similarity is primary
                        }
                    } catch (error) {
                        // Page might not be ready, don't penalize
                        console.log(`⚠️ Could not check business list selector on page ${url}: ${error}`);
                    }

                    // Penalize obvious error pages
                    const errorKeywords = ['error', '404', '500', 'not found', 'access denied', 'blocked'];
                    if (errorKeywords.some(keyword => url.toLowerCase().includes(keyword))) {
                        score -= 5;
                    }

                    // Try to check page title for search-related content
                    try {
                        const title = await page.title();
                        if (title && searchKeywords.some(keyword => title.toLowerCase().includes(keyword))) {
                            score += 0.5; // Reduced from 1
                        }
                    } catch (error) {
                        // Title check failed, continue without penalty
                    }

                    console.log(`📊 Page ${url} scored: ${score}`);
                    return { page, score };

                } catch (error) {
                    console.log(`⚠️ Error evaluating page: ${error}`);
                    return { page, score: -1 };
                }
            })
        );

        // Find the page with the highest score
        const bestMatch = pageScores
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score)[0];

        if (bestMatch) {
            console.log(`✅ Found best search results page with score ${bestMatch.score}: ${bestMatch.page.url()}`);
            return bestMatch.page;
        }

        // Fallback: if no page scored positively, return the first non-closed page
        const fallbackPage = pages.find(page => !page.isClosed());
        if (fallbackPage) {
            console.log(`⚠️ No ideal search results page found, using fallback: ${fallbackPage.url()}`);
            return fallbackPage;
        }

        console.log('❌ No suitable search results page found');
        return null;
    }

    /**
     * Navigate back to search results, handling both same-tab and new-tab scenarios
     */
    private async navigateBackToSearchResults(selectors: PlatformInfo['selectors']): Promise<void> {
        if (!this.page) return;

        try {
            // Check if we're in a new tab scenario
            const isInNewTab = this.isInNewTab;

            if (isInNewTab) {
                // We're in a new tab - simply close it to return to search results
                console.log('🆕 In new tab scenario, closing detail page to return to search results');

                // Close the current detail page
                await this.page.close();

                // Browser will automatically focus back to the search results page
                // We need to find and reference that page
                const browser = this.page.browser();
                if (browser) {
                    const pages = await browser.pages();
                    // Use improved search results page detection
                    const searchResultsPage = await this.findSearchResultsPage(pages);

                    if (searchResultsPage) {
                        this.page = searchResultsPage;
                        console.log(`🔍 Switched back to search results page: ${searchResultsPage.url()}`);

                        // Wait for search results to be ready
                        await searchResultsPage.waitForSelector(selectors.businessList, { timeout: 10000 });

                        // Update captured search page URL
                        this.searchPageUrl = searchResultsPage.url();
                        console.log(`📝 Updated search page URL: ${this.searchPageUrl}`);

                        // Check for Cloudflare protection
                        await this.handleCloudflareDetection();

                        // Clear the new tab flag
                        this.isInNewTab = false;

                        console.log('✅ Successfully closed detail page and returned to search results');
                    } else {
                        console.log('⚠️ Could not find search results page after closing detail tab');
                    }
                }
            } else {
                // Same tab scenario - use normal back navigation
                console.log('🔄 Same tab scenario, navigating back to search results');
                await this.page.goBack({ waitUntil: 'networkidle2' });

                // Wait for search results to reload
                await this.page.waitForSelector(selectors.businessList, { timeout: 10000 });

                // Update captured search page URL
                this.searchPageUrl = this.page.url();
                console.log(`📝 Updated search page URL after back navigation: ${this.searchPageUrl}`);

                // Check for Cloudflare protection after returning to search results
                await this.handleCloudflareDetection();

                console.log('✅ Successfully navigated back to search results');
            }
        } catch (error) {
            console.error('❌ Error navigating back to search results:', error);
            // Don't throw - let the process continue
        }
    }

    /**
     * Extract enhanced data from business detail page
     */
    private async extractEnhancedDataFromDetailPage(
        basicResult: ScrapingResult,
        selectors: PlatformInfo['selectors']
    ): Promise<ScrapingResult> {
        if (!this.page || !selectors.navigation?.detailPage) return basicResult;

        const detailSelectors = selectors.navigation.detailPage;
        console.log('detailSelectors', detailSelectors);
        const enhancedResult = { ...basicResult };

        try {
            // Extract enhanced business name if available
            if (detailSelectors.businessName) {
                const enhancedName = await this.extractTextFromPage(detailSelectors.businessName);
                if (enhancedName) enhancedResult.business_name = enhancedName;
            }

            // Extract website from detail page if available (this takes precedence over list page)
            if (detailSelectors.website) {
                const website = await this.extractAttributeFromPage(detailSelectors.website, 'href');
                if (website) {
                    enhancedResult.website = website;
                    console.log(`📱 Extracted website from detail page: ${website}`);
                }
            }

            // Use adapter-specific website extraction if available (for detail page)
            if (this.adapter && typeof this.adapter.extractWebsiteWithReveal === 'function') {
                try {
                    console.log('🔧 Using adapter-specific website extraction method on detail page');
                    const adapterWebsite = await this.adapter.extractWebsiteWithReveal(this.page!, null);
                    if (adapterWebsite && this.isValidWebsiteUrl(adapterWebsite)) {
                        enhancedResult.website = adapterWebsite;
                        console.log(`🌐 Valid website extracted using adapter method on detail page: ${adapterWebsite}`);
                    } else if (adapterWebsite) {
                        console.log(`⚠️ Invalid website format from adapter method on detail page: ${adapterWebsite}`);
                    }
                } catch (error) {
                    console.warn('⚠️ Error in adapter website extraction method on detail page:', error);
                }
            }

            // Extract full address if available
            if (detailSelectors.fullAddress) {
                const fullAddress = await this.extractTextFromPage(detailSelectors.fullAddress);
                if (fullAddress) {
                    enhancedResult.address = {
                        ...enhancedResult.address,
                        street: fullAddress
                    };
                }
            }

            // Use adapter-specific address extraction if available (for detail page)
            if (this.adapter && typeof this.adapter.extractAddressFromBusinessSection === 'function') {
                try {
                    console.log('🔧 Using adapter-specific address extraction method on detail page');
                    const adapterAddress = await this.adapter.extractAddressFromBusinessSection(this.page!);
                    if (adapterAddress && adapterAddress.trim() !== '') {
                        // Parse the address string into components if needed
                        const addressParts = this.parseAddressString(adapterAddress);
                        enhancedResult.address = {
                            ...enhancedResult.address,
                            ...addressParts
                        };
                        console.log(`📍 Valid address extracted using adapter method on detail page: ${adapterAddress}`);
                    }
                } catch (error) {
                    console.warn('⚠️ Error in adapter address extraction method on detail page:', error);
                }
            }

            // Extract detailed business hours if available
            if (detailSelectors.businessHours) {
                const detailedHours = await this.extractObjectFromPage(detailSelectors.businessHours);
                if (detailedHours) enhancedResult.business_hours = detailedHours;
            }

            // Extract complete description if available
            if (detailSelectors.description) {
                const fullDescription = await this.extractTextFromPage(detailSelectors.description);
                if (fullDescription) enhancedResult.description = fullDescription;
            }

            // Extract contact information if available
            if (detailSelectors.contactInfo) {
                const contactInfo = await this.extractTextFromPage(detailSelectors.contactInfo);
                if (contactInfo) {
                    // Parse contact info for additional fields
                    const parsedContact = this.parseContactInfo(contactInfo);
                    enhancedResult.contact_person = parsedContact.contactPerson || enhancedResult.contact_person;
                    enhancedResult.fax_number = parsedContact.faxNumber || enhancedResult.fax_number;
                }
            }

            // Extract services if available
            if (detailSelectors.services) {
                const services = await this.extractArrayFromPage(detailSelectors.services);
                if (services) enhancedResult.specialties = services;
            }

            // Extract additional phone numbers if available
            if (detailSelectors.additionalPhone) {
                const additionalPhone = await this.extractTextFromPage(detailSelectors.additionalPhone);
                if (additionalPhone) enhancedResult.phone = additionalPhone;
            }

            // Use adapter-specific phone extraction if available (for detail page)
            if (this.adapter && typeof this.adapter.extractPhoneNumberWithReveal === 'function') {
                try {
                    console.log('🔧 Using adapter-specific phone extraction method on detail page');
                    const adapterPhone = await this.adapter.extractPhoneNumberWithReveal(this.page!, null);
                    if (adapterPhone && this.isValidPhoneNumber(adapterPhone)) {
                        enhancedResult.phone = adapterPhone;
                        console.log(`📞 Valid phone extracted using adapter method on detail page: ${adapterPhone}`);
                    } else if (adapterPhone) {
                        console.log(`⚠️ Invalid phone format from adapter method on detail page: ${adapterPhone}`);
                    }
                } catch (error) {
                    console.warn('⚠️ Error in adapter phone extraction method on detail page:', error);
                }
            }

            // Extract additional email addresses if available
            let emailExtracted = false;

            // First try adapter-specific email extraction if available
            if (this.adapter && typeof this.adapter.extractEmailFromDetailPage === 'function') {
                try {
                    console.log('🔧 Using adapter-specific email extraction method');
                    const adapterEmail = await this.adapter.extractEmailFromDetailPage(this.page!);
                    if (adapterEmail && this.isValidEmail(adapterEmail)) {
                        enhancedResult.email = adapterEmail;
                        emailExtracted = true;
                        console.log(`📧 Valid email extracted using adapter method: ${adapterEmail}`);
                    } else if (adapterEmail) {
                        console.log(`⚠️ Invalid email format from adapter method: ${adapterEmail}`);
                    }
                } catch (error) {
                    console.warn('⚠️ Error in adapter email extraction method:', error);
                }
            }

            // If adapter method didn't find email, try standard selector-based extraction
            if (!emailExtracted && detailSelectors.additionalEmail) {
                console.log('🔧 Falling back to selector-based email extraction');
                const additionalEmail = await this.extractTextFromPage(detailSelectors.additionalEmail);
                if (additionalEmail && this.isValidEmail(additionalEmail)) {
                    enhancedResult.email = additionalEmail;
                    console.log(`📧 Valid email extracted from detail page selector: ${additionalEmail}`);
                } else if (additionalEmail) {
                    console.log(`⚠️ Invalid email format from detail page selector: ${additionalEmail}`);
                }
            }

            // Extract social media links if available
            if (detailSelectors.socialMedia) {
                const socialMedia = await this.extractArrayFromPage(detailSelectors.socialMedia);
                if (socialMedia) enhancedResult.social_media = socialMedia;
            }

            // Extract detailed categories if available
            if (detailSelectors.categories) {
                const detailedCategories = await this.extractArrayFromPage(detailSelectors.categories);
                if (detailedCategories) enhancedResult.categories = detailedCategories;
            }

            // Extract year established if available
            if (detailSelectors.yearEstablished) {
                const yearEstablished = await this.extractNumberFromPage(detailSelectors.yearEstablished);
                if (yearEstablished) enhancedResult.year_established = yearEstablished;
            }

            // Extract number of employees if available
            if (detailSelectors.numberOfEmployees) {
                const numberOfEmployees = await this.extractTextFromPage(detailSelectors.numberOfEmployees);
                if (numberOfEmployees) enhancedResult.number_of_employees = numberOfEmployees;
            }

            // Extract payment methods if available
            if (detailSelectors.paymentMethods) {
                const paymentMethods = await this.extractArrayFromPage(detailSelectors.paymentMethods);
                if (paymentMethods) enhancedResult.payment_methods = paymentMethods;
            }

            // Extract business specialties if available
            if (detailSelectors.specialties) {
                const specialties = await this.extractArrayFromPage(detailSelectors.specialties);
                if (specialties) enhancedResult.specialties = specialties;
            }

            console.log('Enhanced data extracted from detail page');

        } catch (error) {
            console.error('Error extracting enhanced data from detail page:', error);
        }

        return enhancedResult;
    }

    /**
     * Extract text from current page using selector
     */
    private async extractTextFromPage(selector: string): Promise<string | undefined> {
        if (!this.page) return undefined;

        try {
            const element = await this.page.$(selector);
            if (element) {
                return await element.evaluate(el => el.textContent?.trim());
            }
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Extract attribute from current page using selector
     */
    private async extractAttributeFromPage(selector: string, attribute: string): Promise<string | undefined> {
        if (!this.page) return undefined;

        try {
            const element = await this.page.$(selector);
            if (element) {
                const attrValue = await element.evaluate((el, attr) => el.getAttribute(attr), attribute);
                return attrValue || undefined;
            }
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Capture detail page content for AI training purposes
     * This method captures the raw HTML and page state for training data
     */
    private async captureDetailPageForTraining(businessName: string): Promise<void> {
        if (!this.page) return;

        try {
            console.log(`📹 Capturing detail page content for AI training: ${businessName}`);

            // Capture the current URL
            const currentUrl = this.page.url();

            // Capture the raw HTML content
            const rawHtml = await this.page.content();

            // Capture page metadata
            const pageMetadata = await this.page.evaluate(() => {
                return {
                    title: document.title,
                    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
                    keywords: document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '',
                    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
                    language: document.documentElement.lang || 'en',
                    timestamp: new Date().toISOString()
                };
            });

            // Capture page structure information
            const pageStructure = await this.page.evaluate(() => {
                const getElementInfo = (selector: string) => {
                    const element = document.querySelector(selector);
                    if (!element) return null;

                    // Cast to HTMLElement to access offsetWidth and offsetHeight
                    const htmlElement = element as HTMLElement;

                    return {
                        exists: true,
                        text: element.textContent?.trim().substring(0, 200) || '',
                        classes: Array.from(element.classList),
                        id: element.id || '',
                        tagName: element.tagName.toLowerCase(),
                        isVisible: htmlElement.offsetWidth > 0 && htmlElement.offsetHeight > 0
                    };
                };

                // Common selectors to check for business information
                const selectors = [
                    'h1', 'h2', 'h3', // Headers
                    '.business-name', '.company-name', '.title',
                    '.address', '.contact', '.phone', '.email', '.website',
                    '.description', '.about', '.services',
                    '.hours', '.schedule', '.open',
                    '.rating', '.reviews', '.stars',
                    '.categories', '.tags', '.specialties'
                ];

                const structureInfo: Record<string, any> = {};
                selectors.forEach(selector => {
                    const info = getElementInfo(selector);
                    if (info) {
                        structureInfo[selector] = info;
                    }
                });

                return {
                    totalElements: document.querySelectorAll('*').length,
                    bodyTextLength: document.body.textContent?.length || 0,
                    hasForms: document.querySelectorAll('form').length > 0,
                    hasImages: document.querySelectorAll('img').length > 0,
                    hasLinks: document.querySelectorAll('a').length > 0,
                    structureInfo
                };
            });

            // Create training data object
            const trainingData = {
                businessName,
                url: currentUrl,
                timestamp: new Date().toISOString(),
                pageMetadata,
                pageStructure,
                rawHtml: rawHtml.substring(0, 50000), // Limit HTML size for storage
                htmlLength: rawHtml.length,
                taskId: this.taskData.taskId,
                platform: this.taskData.platform,
                keywords: this.taskData.keywords,
                location: this.taskData.location
            };

            // Log the training data capture
            console.log(`📊 Detail page training data captured:`, {
                businessName,
                url: currentUrl,
                htmlLength: rawHtml.length,
                hasBusinessInfo: !!pageStructure.structureInfo['h1'] || !!pageStructure.structureInfo['.business-name'],
                timestamp: trainingData.timestamp
            });

            // Store the training data in the session manager
            if (this.sessionManager.getRecordingStatus()) {
                // Add to session data for later processing
                this.sessionManager.addDetailPageTrainingData(trainingData);
            }

        } catch (error) {
            console.warn('⚠️ Error capturing detail page for training:', error);
            // Don't fail the scraping process if training capture fails
        }
    }

    /**
     * Extract array from current page using selector
     */
    private async extractArrayFromPage(selector: string): Promise<string[] | undefined> {
        if (!this.page) return undefined;

        try {
            const elements = await this.page.$$(selector);
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
     * Extract object from current page using selector
     */
    private async extractObjectFromPage(selector: string): Promise<object | undefined> {
        if (!this.page) return undefined;

        try {
            const text = await this.extractTextFromPage(selector);
            if (text) {
                return JSON.parse(text);
            }
        } catch (error) {
            // Ignore extraction errors
        }
        return undefined;
    }

    /**
     * Extract number from current page using selector
     */
    private async extractNumberFromPage(selector: string): Promise<number | undefined> {
        if (!this.page) return undefined;

        try {
            const text = await this.extractTextFromPage(selector);
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
     * Validate email format
     */
    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.trim());
    }

    /**
     * Parse contact information text for additional fields
     */
    private parseContactInfo(contactText: string): { contactPerson?: string; faxNumber?: string } {
        const result: { contactPerson?: string; faxNumber?: string } = {};

        // Simple parsing logic - you can enhance this based on your needs
        const lines = contactText.split('\n').map(line => line.trim());

        for (const line of lines) {
            if (line.toLowerCase().includes('contact') || line.toLowerCase().includes('person')) {
                result.contactPerson = line;
            }
            if (line.toLowerCase().includes('fax')) {
                result.faxNumber = line;
            }
        }

        return result;
    }

    /**
     * Parse address string into components
     */
    private parseAddressString(addressString: string): {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
    } {
        if (!addressString || addressString.trim() === '') {
            return {};
        }

        const result: { street?: string; city?: string; state?: string; zip?: string } = {};

        try {
            // Clean the address string
            const cleanAddress = addressString.trim();

            // For full address strings, try to parse components
            // Common format: "123 Main St, City, State 12345"
            const addressRegex = /^(.+?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i;
            const match = cleanAddress.match(addressRegex);

            if (match) {
                result.street = match[1].trim();
                result.city = match[2].trim();
                result.state = match[3].trim().toUpperCase();
                result.zip = match[4].trim();
            } else {
                // If regex doesn't match, treat the whole string as street address
                result.street = cleanAddress;

                // Try to extract ZIP code from the end
                const zipMatch = cleanAddress.match(/\b(\d{5}(?:-\d{4})?)\b$/);
                if (zipMatch) {
                    result.zip = zipMatch[1];
                    result.street = cleanAddress.replace(/\s*\b\d{5}(?:-\d{4})?\b$/, '').trim();
                }

                // Try to extract state abbreviation
                const stateMatch = cleanAddress.match(/\b([A-Z]{2})\s*\d{5}(?:-\d{4})?\b$/i);
                if (stateMatch) {
                    result.state = stateMatch[1].toUpperCase();
                    result.street = cleanAddress.replace(/\s*\b[A-Z]{2}\s*\d{5}(?:-\d{4})?\b$/i, '').trim();
                }
            }

            return result;
        } catch (error) {
            console.warn('Error parsing address string:', error);
            // Fallback: return the whole string as street address
            return { street: addressString };
        }
    }



    /**
     * Validate phone number format
     */
    private isValidPhoneNumber(phone: string): boolean {
        if (!phone || phone.trim() === '') return false;

        // Remove common phone number formatting
        const cleanPhone = phone.replace(/[\s\-\(\)\+\.]/g, '');

        // Check if it contains mostly digits and has reasonable length
        const hasDigits = /\d/.test(cleanPhone);
        const isReasonableLength = cleanPhone.length >= 8 && cleanPhone.length <= 15;
        const isNotJustText = !/^[a-zA-Z\s]+$/.test(phone);

        return hasDigits && isReasonableLength && isNotJustText;
    }

    /**
     * Validate website URL format
     */
    private isValidWebsiteUrl(url: string): boolean {
        if (!url || url.trim() === '') return false;

        try {
            // Check if it's a valid URL format
            const urlPattern = /^https?:\/\/.+/i;
            return urlPattern.test(url);
        } catch (error) {
            return false;
        }
    }

    /**
     * Extract business data from a single element
     */
    private async extractBusinessFromElement(element: any, selectors: PlatformInfo['selectors']): Promise<ScrapingResult | null> {
        try {
            // Wait for page to finish loading before extracting data
            if (this.page) {
                await this.page.waitForSelector('body', { timeout: 10000 });
            }

            const business_name = await this.extractText(element, selectors.businessName);
            console.log('element', element);
            console.log('selectors', selectors.businessName);
            console.log('business_name', business_name);
            if (this.page) {
                const currentUrl = this.page.url();
                console.log('Current page URL:', currentUrl);
            }
            if (!business_name) return null;

            // Extract phone number from list page (basic extraction only)
            let phoneNumber: string | undefined = undefined;
            if (selectors.phone) {
                phoneNumber = await this.extractText(element, selectors.phone);
            }

            // Extract website URL from list page (basic extraction only)
            let websiteUrl: string | undefined = undefined;
            if (selectors.website) {
                websiteUrl = await this.extractAttribute(element, selectors.website, 'href');
            }

            const result: ScrapingResult = {
                business_name,
                email: selectors.email ? await this.extractText(element, selectors.email) : undefined,
                phone: phoneNumber,
                website: websiteUrl,
                address: {
                    street: selectors.address ? await this.extractText(element, selectors.address) : undefined,
                    city: selectors.address_city ? await this.extractText(element, selectors.address_city) : undefined,
                    state: selectors.address_state ? await this.extractText(element, selectors.address_state) : undefined,
                    zip: selectors.address_zip ? await this.extractText(element, selectors.address_zip) : undefined,
                    country: selectors.address_country ? await this.extractText(element, selectors.address_country) : undefined
                },
                social_media: selectors.socialMedia ? await this.extractArray(element, selectors.socialMedia) : undefined,
                categories: selectors.categories ? await this.extractArray(element, selectors.categories) : undefined,
                business_hours: selectors.businessHours ? await this.extractObject(element, selectors.businessHours) : undefined,
                description: selectors.description ? await this.extractText(element, selectors.description) : undefined,
                rating: selectors.rating ? await this.extractNumber(element, selectors.rating) : undefined,
                review_count: selectors.reviewCount ? await this.extractNumber(element, selectors.reviewCount) : undefined,
                fax_number: selectors.faxNumber ? await this.extractText(element, selectors.faxNumber) : undefined,
                contact_person: selectors.contactPerson ? await this.extractText(element, selectors.contactPerson) : undefined,
                year_established: selectors.yearEstablished ? await this.extractNumber(element, selectors.yearEstablished) : undefined,
                number_of_employees: selectors.numberOfEmployees ? await this.extractText(element, selectors.numberOfEmployees) : undefined,
                payment_methods: selectors.paymentMethods ? await this.extractArray(element, selectors.paymentMethods) : undefined,
                specialties: selectors.specialties ? await this.extractArray(element, selectors.specialties) : undefined
            };

            return result;
        } catch (error) {
            console.error('Error extracting business from element:', error);
            return null;
        }
    }

    /**
     * Extract text from element - handles page re-rendering
     */
    private async extractText(element: any, selector: string): Promise<string | undefined> {
        if (!selector) return undefined;

        // Add small delay to handle page re-rendering
        await this.sleep(100);

        // Retry logic with fresh element queries
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                // Always get a fresh element reference to avoid stale DOM references
                const textElement = await element.$(selector);
                if (textElement) {
                    // Immediately extract text without validation to avoid additional DOM queries
                    const text = await textElement.evaluate(el => {
                        try {
                            return el.textContent?.trim() || '';
                        } catch {
                            return '';
                        }
                    });

                    if (text) {
                        return text;
                    }
                } else {
                    console.error('textElement not found', selector);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                if (errorMessage.includes('Protocol error') || errorMessage.includes('Could not find object')) {
                    console.log(`DOM re-rendering detected, attempt ${attempt + 1}/3 for selector: ${selector}`);

                    // Wait longer between retries to allow page to stabilize
                    await this.sleep(200 * (attempt + 1));

                    // Continue to next attempt
                    continue;
                } else {
                    console.error('error extracting text', errorMessage);
                    break;
                }
            }
        }

        return undefined;
    }

    /**
     * Extract attribute from element - handles page re-rendering
     */
    private async extractAttribute(element: any, selector: string, attribute: string): Promise<string | undefined> {
        if (!selector) return undefined;

        // Add small delay to handle page re-rendering
        await this.sleep(100);

        // Retry logic with fresh element queries
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                // Always get a fresh element reference to avoid stale DOM references
                const attrElement = await element.$(selector);
                if (attrElement) {
                    // Immediately extract attribute without validation to avoid additional DOM queries
                    const attrValue = await attrElement.evaluate((el, attr) => {
                        try {
                            return el.getAttribute(attr);
                        } catch {
                            return null;
                        }
                    }, attribute);

                    if (attrValue) {
                        return attrValue;
                    }
                } else {
                    console.error('attrElement not found', selector);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                if (errorMessage.includes('Protocol error') || errorMessage.includes('Could not find object')) {
                    console.log(`DOM re-rendering detected, attempt ${attempt + 1}/3 for attribute selector: ${selector}`);

                    // Wait longer between retries to allow page to stabilize
                    await this.sleep(200 * (attempt + 1));

                    // Continue to next attempt
                    continue;
                } else {
                    console.error('error extracting attribute', errorMessage);
                    break;
                }
            }
        }

        return undefined;
    }

    /**
     * Extract array from element - handles page re-rendering
     */
    private async extractArray(element: any, selector: string): Promise<string[] | undefined> {
        if (!selector) return undefined;

        // Add small delay to handle page re-rendering
        await this.sleep(100);

        // Retry logic with fresh element queries
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                // Always get fresh element references to avoid stale DOM references
                const elements = await element.$$(selector);
                const array: string[] = [];

                for (const el of elements) {
                    try {
                        const text = await el.evaluate(element => {
                            try {
                                return element.textContent?.trim() || '';
                            } catch {
                                return '';
                            }
                        });
                        if (text) array.push(text);
                    } catch (elementError) {
                        // Skip this element if it becomes stale
                        const elementErrorMessage = elementError instanceof Error ? elementError.message : String(elementError);
                        if (elementErrorMessage.includes('Protocol error') || elementErrorMessage.includes('Could not find object')) {
                            console.log('Skipping stale element in array extraction');
                            continue;
                        }
                    }
                }

                return array.length > 0 ? array : undefined;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                if (errorMessage.includes('Protocol error') || errorMessage.includes('Could not find object')) {
                    console.log(`DOM re-rendering detected, attempt ${attempt + 1}/3 for array selector: ${selector}`);

                    // Wait longer between retries to allow page to stabilize
                    await this.sleep(200 * (attempt + 1));

                    // Continue to next attempt
                    continue;
                } else {
                    console.error('error extracting array', errorMessage);
                    break;
                }
            }
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
     * Report progress to parent process
     */
    private reportProgress(progress: ScrapingProgress): void {
        if (this.onProgressCallback) {
            this.onProgressCallback(progress);
        }
    }

    /**
     * Sleep utility with human-like randomization
     */
    private async sleep(ms: number): Promise<void> {
        // Add random jitter to make timing more human-like
        const jitter = Math.random() * 200 - 100; // ±100ms random variation
        const actualDelay = Math.max(100, ms + jitter); // Minimum 100ms delay
        return new Promise(resolve => setTimeout(resolve, actualDelay));
    }

    /**
     * Detect if the current page is blocked by Cloudflare protection
     * @returns true if Cloudflare protection is detected, false otherwise
     */
    private async detectCloudflareProtection(): Promise<boolean> {
        if (!this.page) return false;

        try {
            // Common Cloudflare protection indicators
            const cloudflareSelectors = [
                // Cloudflare challenge page
                '#challenge-form',
                '#challenge-running',
                '.cf-browser-verification',
                '.cf-wrapper',
                '#cf-please-wait',
                '.cf-error-code',
                // Cloudflare error pages
                '.cf-error-title',
                '.cf-error-description',
                // Cloudflare security check
                '#cf-wrapper',
                '.cf-browser-verification',
                // Additional indicators
                'iframe[src*="cloudflare"]',
                'script[src*="cloudflare"]',
                // Text content indicators
                'text="Checking your browser"',
                'text="Please wait while we verify"',
                'text="DDoS protection by Cloudflare"',
                'text="Security check by Cloudflare"',
                'text="Just a moment"',
                'text="Checking if the site connection is secure"',
                'text="Please complete the security check"',
                'text="One more step"',
                'text="Please wait"',
                'text="Verifying you are human"',
                'text="Turn on JavaScript"',
                'text="Enable JavaScript and cookies"'
            ];

            // Check for Cloudflare-specific elements
            for (const selector of cloudflareSelectors) {
                try {
                    if (selector.startsWith('text=')) {
                        // Check for text content
                        const text = selector.replace('text=', '');
                        const hasText = await this.page!.evaluate((searchText) => {
                            return document.body.innerText.includes(searchText) ||
                                document.title.includes(searchText) ||
                                document.documentElement.innerText.includes(searchText);
                        }, text);
                        if (hasText) {
                            console.log(`🔒 Cloudflare protection detected via text: "${text}"`);
                            return true;
                        }
                    } else {
                        // Check for element existence
                        const element = await this.page!.$eval(selector, () => true).catch(() => false);
                        if (element) {
                            console.log(`🔒 Cloudflare protection detected via selector: ${selector}`);
                            return true;
                        }
                    }
                } catch (error) {
                    // Continue checking other selectors if one fails
                    continue;
                }
            }

            // Check page title for Cloudflare indicators
            const pageTitle = await this.page!.title();
            const cloudflareTitlePatterns = [
                /cloudflare/i,
                /checking your browser/i,
                /please wait/i,
                /security check/i,
                /ddos protection/i,
                /browser verification/i,
                /just a moment/i,
                /verifying you are human/i,
                /one more step/i,
                /turn on javascript/i,
                /enable javascript/i
            ];

            for (const pattern of cloudflareTitlePatterns) {
                if (pattern.test(pageTitle)) {
                    console.log(`🔒 Cloudflare protection detected via page title: "${pageTitle}"`);
                    return true;
                }
            }

            // Check URL for Cloudflare indicators
            const currentUrl = this.page!.url();
            if (currentUrl.includes('cloudflare') ||
                currentUrl.includes('challenge') ||
                currentUrl.includes('cf-') ||
                currentUrl.includes('security-check')) {
                console.log(`🔒 Cloudflare protection detected via URL: ${currentUrl}`);
                return true;
            }

            // Check for Cloudflare-specific HTTP headers (if accessible)
            try {
                const response = await this.page!.evaluate(() => {
                    // This might not work in all contexts, but worth trying
                    return (window as any).performance?.getEntriesByType?.('resource') || [];
                });

                // Look for Cloudflare resources in performance entries
                const hasCloudflareResources = response.some((entry: any) =>
                    entry.name && (
                        entry.name.includes('cloudflare') ||
                        entry.name.includes('cf-') ||
                        entry.name.includes('challenge')
                    )
                );

                if (hasCloudflareResources) {
                    console.log('🔒 Cloudflare protection detected via resource loading');
                    return true;
                }
            } catch (error) {
                // Performance API might not be available, continue
            }

            // Check for common Cloudflare page structure patterns
            try {
                const hasCloudflareStructure = await this.page!.evaluate(() => {
                    // Check for common Cloudflare page structures
                    const bodyText = document.body.innerText.toLowerCase();
                    const hasChallengeForm = document.getElementById('challenge-form') !== null;
                    const hasCfWrapper = document.querySelector('.cf-wrapper') !== null;
                    const hasSecurityCheck = bodyText.includes('security check') ||
                        bodyText.includes('verifying') ||
                        bodyText.includes('just a moment');

                    return hasChallengeForm || hasCfWrapper || hasSecurityCheck;
                });

                if (hasCloudflareStructure) {
                    console.log('🔒 Cloudflare protection detected via page structure analysis');
                    return true;
                }
            } catch (error) {
                // Continue if evaluation fails
            }

            return false;
        } catch (error) {
            console.warn('Error detecting Cloudflare protection:', error);
            return false;
        }
    }

    /**
     * Check if an element is visible on the page
     * @param element - The element to check
     * @returns true if the element is visible, false otherwise
     */
    private async isElementVisible(element: any): Promise<boolean> {
        try {
            return await element.evaluate((el: Element) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= window.innerHeight &&
                    rect.right <= window.innerWidth
                );
            });
        } catch (error) {
            return false;
        }
    }

    /**
     * Detect if the page shows robot verification challenge
     * @returns true if robot verification is detected, false otherwise
     */
    private async detectRobotVerification(): Promise<boolean> {
        if (!this.page) return false;

        try {
            // Check for robot verification text and elements
            const robotVerificationIndicators = [
                'We want to make sure you are not a robot',
                'Please verify you are human',
                'Verify you are not a robot',
                'Robot verification',
                'Human verification',
                'Security check',
                'Anti-bot verification',
                // 'Captcha verification',
                'reCAPTCHA',
                //'hCaptcha',
                'Please complete the security check',
                'Verify your identity',
                'Security verification required',
                'Complete the verification',
                'Prove you are human',
                'Anti-robot verification',
                'Bot detection',
                'Automated access blocked',
                'You have been blocked'
            ];
            // Wait for the page to be fully loaded before evaluating
            await this.page.waitForFunction(() => document.readyState === 'complete');
            // Check page content for robot verification text (only visible text)
            const hasRobotText = await this.page.evaluate((indicators) => {
                // Get all text content from visible elements only
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode: (node) => {
                            const element = node.parentElement;
                            if (!element) return NodeFilter.FILTER_REJECT;

                            const style = window.getComputedStyle(element);
                            const rect = element.getBoundingClientRect();

                            // Check if the element containing the text is visible
                            const isVisible = (
                                style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                style.opacity !== '0' &&
                                rect.width > 0 &&
                                rect.height > 0
                            );

                            return isVisible ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                        }
                    }
                );

                let visibleText = '';
                let node;
                while (node = walker.nextNode()) {
                    visibleText += node.textContent + ' ';
                }

                // Check if any robot verification indicators are in the visible text
                const foundIndicator = indicators.find(indicator =>
                    visibleText.toLowerCase().includes(indicator.toLowerCase())
                );

                if (foundIndicator) {
                    return {
                        found: true,
                        indicator: foundIndicator,
                        visibleText: visibleText.trim().substring(0, 500) // First 500 chars for debugging
                    };
                }

                return { found: false };
            }, robotVerificationIndicators);

            if (hasRobotText.found) {
                console.log('🤖 Robot verification challenge detected in visible page content');
                console.log(`🔍 Found indicator: "${hasRobotText.indicator}"`);
                console.log(`📝 Visible text context: "${hasRobotText.visibleText}"`);
                return true;
            }

            // Additional check: Look for specific visible elements that might contain robot verification text
            const visibleRobotElements = await this.page.evaluate((indicators) => {
                const elements = document.querySelectorAll('*');
                for (const element of elements) {
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();

                    // Check if element is visible
                    const isVisible = (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 &&
                        rect.height > 0
                    );

                    if (isVisible && element.textContent) {
                        const text = element.textContent.toLowerCase();
                        const foundIndicator = indicators.find(indicator => text.includes(indicator.toLowerCase()));
                        if (foundIndicator) {
                            return {
                                found: true,
                                indicator: foundIndicator,
                                elementText: element.textContent.trim().substring(0, 200) // First 200 chars for debugging
                            };
                        }
                    }
                }
                return { found: false };
            }, robotVerificationIndicators);

            if (visibleRobotElements.found) {
                console.log(`🤖 Robot verification challenge detected in visible elements`);
                console.log(`🔍 Found indicator: "${visibleRobotElements.indicator}"`);
                console.log(`📝 Element text: "${visibleRobotElements.elementText}"`);
                return true;
            }

            // Check for robot verification specific selectors
            const robotVerificationSelectors = [
                '[data-testid*="captcha"]',
                '[data-testid*="robot"]',
                '[data-testid*="verification"]',
                '.captcha',
                '.recaptcha',
                '.hcaptcha',
                '.robot-verification',
                '.human-verification',
                '.security-check',
                '.verification-challenge',
                '#captcha',
                '#recaptcha',
                '#hcaptcha',
                'iframe[src*="recaptcha"]',
                'iframe[src*="hcaptcha"]',
                'iframe[src*="captcha"]',
                '.g-recaptcha',
                '.h-captcha',
                '[class*="captcha"]',
                '[class*="robot"]',
                '[class*="verification"]'
            ];

            for (const selector of robotVerificationSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        // Check if the element is visible
                        const isVisible = await this.isElementVisible(element);

                        if (isVisible) {
                            console.log(`🤖 Robot verification detected with visible selector: ${selector}`);
                            return true;
                        }
                    }
                } catch (error) {
                    // Continue checking other selectors if one fails
                    continue;
                }
            }

            // Check for common captcha/verification iframe patterns
            const iframes = await this.page.$$('iframe');
            for (const iframe of iframes) {
                const src = await iframe.evaluate(el => el.getAttribute('src') || '');
                if (src && (
                    src.includes('recaptcha') ||
                    src.includes('hcaptcha') ||
                    src.includes('captcha') ||
                    src.includes('verification') ||
                    src.includes('robot')
                )) {
                    // Check if the iframe is visible
                    const isVisible = await this.isElementVisible(iframe);

                    if (isVisible) {
                        console.log(`🤖 Robot verification iframe detected and visible: ${src}`);
                        return true;
                    }
                }
            }

            // Check page title for robot verification indicators
            const pageTitle = await this.page.title();
            const robotTitlePatterns = [
                /robot/i,
                /captcha/i,
                /verification/i,
                /human verification/i,
                /security check/i,
                /prove you are human/i,
                /anti-bot/i,
                /bot detection/i
            ];

            for (const pattern of robotTitlePatterns) {
                if (pattern.test(pageTitle)) {
                    console.log(`🤖 Robot verification detected via page title: "${pageTitle}"`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.warn('Error detecting robot verification:', error);
            return false;
        }
    }

    /**
     * Handle robot verification detection and notify parent process
     */
    private async handleRobotVerificationDetection(): Promise<void> {
        if (!this.page) return;

        try {
            const isRobotVerification = await this.detectRobotVerification();
            if (isRobotVerification) {
                console.log('🤖 Robot verification challenge detected! Notifying parent process...');

                // Get additional context for the notification
                const currentUrl = this.page.url();
                const userAgent = await this.page.evaluate(() => navigator.userAgent);
                const timestamp = new Date().toISOString();

                // Try to get more detailed information about the verification page
                let additionalInfo = '';
                try {
                    const pageInfo = await this.page.evaluate(() => {
                        const title = document.title;
                        const bodyText = document.body.innerText.substring(0, 500); // First 500 chars
                        const hasCaptcha = !!document.querySelector('.captcha, .recaptcha, .hcaptcha, [class*="captcha"]');
                        const hasVerificationForm = !!document.querySelector('[class*="verification"], [class*="robot"]');

                        return {
                            title,
                            bodyText,
                            hasCaptcha,
                            hasVerificationForm
                        };
                    });

                    additionalInfo = `Page Title: "${pageInfo.title}", Has Captcha: ${pageInfo.hasCaptcha}, Has Verification Form: ${pageInfo.hasVerificationForm}`;
                } catch (error) {
                    additionalInfo = 'Unable to extract additional page information';
                }

                // Create robot verification detection message
                const robotVerificationMessage = {
                    type: 'SCRAPING_ROBOT_VERIFICATION_DETECTED',
                    taskId: this.taskData.taskId,
                    content: `Robot verification challenge detected at ${currentUrl}. Scraping has been automatically paused. Manual intervention is required to complete the verification.`,
                    details: {
                        url: currentUrl,
                        timestamp: timestamp,
                        userAgent: userAgent,
                        additionalInfo: additionalInfo,
                        platform: this.platformInfo.name,
                        message: 'The scraping process has been paused due to a robot verification challenge. Please complete the verification manually and resume the task.'
                    }
                };

                // Send message to parent process
                if (process.parentPort) {
                    process.parentPort.postMessage(robotVerificationMessage);
                }

                // Pause the scraping process
                console.log('⏸️ Pausing scraping due to robot verification challenge...');
                this.pause();

                console.log('✅ Robot verification detection notification sent to parent process');
            }
        } catch (error) {
            console.error('Error handling robot verification detection:', error);
        }
    }

    /**
     * Handle Cloudflare protection detection and notify parent process
     */
    private async handleCloudflareDetection(): Promise<void> {
        if (!this.page) return;

        try {
            const isBlocked = await this.detectCloudflareProtection();
            if (isBlocked) {
                console.log('🚨 Cloudflare protection detected! Notifying parent process...');

                // Get additional context for the notification
                const currentUrl = this.page.url();
                const userAgent = await this.page.evaluate(() => navigator.userAgent);
                const timestamp = new Date().toISOString();

                // Try to get more detailed information about the Cloudflare page
                let additionalInfo = '';
                try {
                    const pageInfo = await this.page.evaluate(() => {
                        const title = document.title;
                        const bodyText = document.body.innerText.substring(0, 500); // First 500 chars
                        const hasChallengeForm = !!document.getElementById('challenge-form');
                        const hasCfWrapper = !!document.querySelector('.cf-wrapper');

                        return {
                            title,
                            bodyText,
                            hasChallengeForm,
                            hasCfWrapper
                        };
                    });

                    additionalInfo = `Page Title: "${pageInfo.title}", Challenge Form: ${pageInfo.hasChallengeForm}, CF Wrapper: ${pageInfo.hasCfWrapper}`;
                } catch (error) {
                    additionalInfo = 'Unable to extract additional page information';
                }

                // Create Cloudflare detection message
                const cloudflareMessage = {
                    type: 'SCRAPING_CLOUDFLARE_DETECTED',
                    taskId: this.taskData.taskId,
                    content: `Cloudflare protection detected at ${currentUrl}. Scraping has been automatically paused to avoid blocking. Manual intervention may be required.`,
                    details: {
                        url: currentUrl,
                        timestamp: timestamp,
                        userAgent: userAgent,
                        additionalInfo: additionalInfo
                    }
                };

                // Send message to parent process via IPC
                if (process.parentPort) {
                    process.parentPort.postMessage(cloudflareMessage);
                    console.log('✅ Cloudflare detection message sent to parent process');
                } else {
                    console.warn('⚠️ Cannot send Cloudflare message: process.parentPort not available');
                }

                // Log the detection for debugging
                console.log('🔒 Cloudflare protection details:', {
                    url: currentUrl,
                    timestamp: timestamp,
                    userAgent: userAgent,
                    additionalInfo: additionalInfo
                });

                // Provide user guidance
                console.log('💡 Cloudflare Protection Detected - User Guidance:');
                console.log('   • The target website is protected by Cloudflare');
                console.log('   • This may be due to:');
                console.log('     - High request frequency');
                console.log('     - Suspicious traffic patterns');
                console.log('     - Geographic restrictions');
                console.log('     - Browser fingerprinting');
                console.log('   • Recommended actions:');
                console.log('     - Wait before retrying (15-30 minutes)');
                console.log('     - Use different proxy/VPN if available');
                console.log('     - Reduce scraping frequency');
                console.log('     - Check if manual access works in browser');

                // Pause the scraping process due to Cloudflare protection
                if (this.isRunning) {
                    console.log('⏸️ Pausing scraping process due to Cloudflare protection...');
                    try {
                        await this.pause();
                        console.log('✅ Scraping paused successfully due to Cloudflare protection');

                        // Send additional pause notification to parent
                        const pauseNotificationMessage = {
                            type: 'SCRAPING_PAUSED_CLOUDFLARE',
                            taskId: this.taskData.taskId,
                            content: `Scraping paused due to Cloudflare protection at ${currentUrl}. Please wait 15-30 minutes before retrying or manually verify the site is accessible.`,
                            details: {
                                reason: 'Cloudflare protection detected',
                                url: currentUrl,
                                timestamp: timestamp,
                                recommendation: 'Manual intervention required - wait 15-30 minutes before retrying'
                            }
                        };

                        if (process.parentPort) {
                            process.parentPort.postMessage(pauseNotificationMessage);
                            console.log('✅ Cloudflare pause notification sent to parent process');
                        }

                    } catch (pauseError) {
                        console.error('❌ Failed to pause scraping due to Cloudflare protection:', pauseError);
                    }
                }
            }
        } catch (error) {
            console.error('Error handling Cloudflare detection:', error);
        }
    }

    /**
     * Human-like mouse movement with natural curves
     */
    private async humanLikeMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
        try {
            // Get current mouse position (Puppeteer doesn't have position() method, so we'll use a default)
            const startX = 0;
            const startY = 0;

            // Calculate distance
            const distance = Math.sqrt(Math.pow(targetX - startX, 2) + Math.pow(targetY - startY, 2));

            // Number of steps based on distance (more steps for longer distances)
            const steps = Math.max(10, Math.floor(distance / 20));

            // Generate natural curve using Bezier-like interpolation
            for (let i = 0; i <= steps; i++) {
                const progress = i / steps;

                // Add some randomness to make movement more natural
                const randomOffsetX = (Math.random() - 0.5) * 10;
                const randomOffsetY = (Math.random() - 0.5) * 10;

                // Smooth interpolation with slight curve
                const x = startX + (targetX - startX) * progress + randomOffsetX;
                const y = startY + (targetY - startY) * progress + randomOffsetY;

                await page.mouse.move(x, y);

                // Random delay between movements
                await this.sleep(Math.random() * 5 + 2); // 2-7ms delay
            }
        } catch (error) {
            // Fallback to direct movement if human-like movement fails
            await page.mouse.move(targetX, targetY);
        }
    }

    /**
     * Human-like click with natural behavior
     */
    private async humanLikeClick(page: Page, selector: string): Promise<void> {
        try {
            const element = await page.$(selector);
            if (!element) {
                throw new Error(`Element not found: ${selector}`);
            }

            // Get element position
            const box = await element.boundingBox();
            if (!box) {
                throw new Error('Could not get element bounding box');
            }

            // Calculate click position (slightly randomized within the element)
            const clickX = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
            const clickY = box.y + box.height / 2 + (Math.random() - 0.5) * 10;

            // Human-like mouse movement to the element
            await this.humanLikeMouseMove(page, clickX, clickY);

            // Small pause before clicking (like a human would)
            await this.sleep(Math.random() * 100 + 50); // 50-150ms pause

            // Click with natural pressure
            await page.mouse.click(clickX, clickY, {
                button: 'left',
                clickCount: 1,
                delay: Math.random() * 50 + 25 // 25-75ms delay between mousedown and mouseup
            });

            // Small pause after clicking
            await this.sleep(Math.random() * 100 + 50);

        } catch (error) {
            console.error(`Error in human-like click: ${error}`);
            // Fallback to regular click
            await page.click(selector);
        }
    }

    /**
     * Human-like typing with realistic delays and mistakes
     */
    private async humanLikeType(page: Page, selector: string, text: string): Promise<void> {
        try {
            const element = await page.$(selector);
            if (!element) {
                throw new Error(`Element not found: ${selector}`);
            }

            // Focus on the element
            await element.focus();
            await this.sleep(Math.random() * 200 + 100); // 100-300ms pause

            // Clear the field first
            await element.click({ clickCount: 3 }); // Select all text
            await element.press('Backspace');
            await this.sleep(Math.random() * 100 + 50);

            // Type with human-like characteristics
            for (let i = 0; i < text.length; i++) {
                const char = text[i];

                // Random typing speed (50-150ms per character)
                const typingDelay = Math.random() * 100 + 50;

                // Occasionally make a "typo" and correct it (5% chance)
                if (Math.random() < 0.05 && i > 0) {
                    // Type wrong character
                    await element.type(char === ' ' ? 'x' : 'x', { delay: 0 });
                    await this.sleep(Math.random() * 200 + 100);

                    // Delete it
                    await element.press('Backspace');
                    await this.sleep(Math.random() * 100 + 50);
                }

                // Type the correct character
                await element.type(char, { delay: 0 });
                await this.sleep(typingDelay);

                // Occasionally pause longer (like thinking)
                if (Math.random() < 0.1) {
                    await this.sleep(Math.random() * 300 + 200); // 200-500ms thinking pause
                }
            }

            // Final pause after typing
            await this.sleep(Math.random() * 200 + 100);

        } catch (error) {
            console.error(`Error in human-like typing: ${error}`);
            // Fallback to regular typing
            await page.type(selector, text);
        }
    }

    /**
     * Random scroll behavior to simulate human browsing
     */
    private async humanLikeScroll(page: Page): Promise<void> {
        try {
            // Random scroll amount (100-500px)
            const scrollAmount = Math.random() * 400 + 100;

            // Random scroll direction (mostly down, occasionally up)
            const direction = Math.random() < 0.9 ? 1 : -1;

            await page.evaluate((amount, dir) => {
                window.scrollBy(0, amount * dir);
            }, scrollAmount, direction);

            // Pause after scrolling
            await this.sleep(Math.random() * 300 + 200);

        } catch (error) {
            // Ignore scroll errors
        }
    }



    /**
     * Submit search form with human-like behavior
     */
    private async submitSearchForm(): Promise<void> {
        if (!this.page) return;

        try {
            // Common submit button selectors
            const submitSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button:contains("Search")',
                'button:contains("Find")',
                'button:contains("Go")',
                '.search-button',
                '#search-button',
                '[data-testid*="submit"]'
            ];

            let submitButton: any = null;
            for (const selector of submitSelectors) {
                submitButton = await this.page.$(selector);
                if (submitButton) {
                    console.log(`Found submit button: ${selector}`);
                    break;
                }
            }

            if (submitButton && this.page) {
                // Human-like click on submit button
                const selector = submitSelectors.find(s => this.page!.$(s));
                if (selector) {
                    await this.humanLikeClick(this.page, selector);
                    console.log('Submitted search form');
                }
            } else {
                // Try pressing Enter key with human-like timing
                await this.sleep(Math.random() * 200 + 100);
                await this.page.keyboard.press('Enter');
                console.log('Submitted search form using Enter key');
            }

            // Wait for navigation
            await this.page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: 15000
            });

            // Check for Cloudflare protection after form submission
            await this.handleCloudflareDetection();

        } catch (error) {
            console.error('Error submitting search form:', error);
        }
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

    /**
     * Check if adapter supports a specific feature
     */
    private adapterSupportsFeature(feature: string): boolean {
        if (!this.adapter) return false;

        switch (feature) {
            case 'custom-search':
                return this.adapter.searchBusinesses !== BasePlatformAdapter.prototype.searchBusinesses;
            case 'custom-extraction':
                return this.adapter.extractBusinessData !== BasePlatformAdapter.prototype.extractBusinessData;
            case 'custom-pagination':
                return this.adapter.handlePagination !== BasePlatformAdapter.prototype.handlePagination;
            case 'custom-page-load':
                return this.adapter.onPageLoad !== BasePlatformAdapter.prototype.onPageLoad;
            case 'custom-email-extraction':
                return this.adapter.extractEmailFromDetailPage !== BasePlatformAdapter.prototype.extractEmailFromDetailPage;
            case 'custom-phone-extraction':
                return this.adapter.extractPhoneNumberWithReveal !== BasePlatformAdapter.prototype.extractPhoneNumberWithReveal;
            case 'custom-website-extraction':
                return this.adapter.extractWebsiteWithReveal !== BasePlatformAdapter.prototype.extractWebsiteWithReveal;
            case 'custom-address-extraction':
                return this.adapter.extractAddressFromBusinessSection !== BasePlatformAdapter.prototype.extractAddressFromBusinessSection;
            default:
                return false;
        }
    }

    /**
     * Get adapter capabilities
     */
    private getAdapterCapabilities(): string[] {
        if (!this.adapter) {
            return ['configuration-based'];
        }

        const capabilities: string[] = ['class-based'];

        // Check what methods the adapter provides
        if (this.adapter.searchBusinesses !== BasePlatformAdapter.prototype.searchBusinesses) capabilities.push('custom-search');
        if (this.adapter.extractBusinessData !== BasePlatformAdapter.prototype.extractBusinessData) capabilities.push('custom-extraction');
        if (this.adapter.handlePagination !== BasePlatformAdapter.prototype.handlePagination) capabilities.push('custom-pagination');
        if (this.adapter.onPageLoad !== BasePlatformAdapter.prototype.onPageLoad) capabilities.push('custom-page-load');
        if (this.adapter.extractEmailFromDetailPage !== BasePlatformAdapter.prototype.extractEmailFromDetailPage) capabilities.push('custom-email-extraction');
        if (this.adapter.extractPhoneNumberWithReveal !== BasePlatformAdapter.prototype.extractPhoneNumberWithReveal) capabilities.push('custom-phone-extraction');
        if (this.adapter.extractWebsiteWithReveal !== BasePlatformAdapter.prototype.extractWebsiteWithReveal) capabilities.push('custom-website-extraction');
        if (this.adapter.extractAddressFromBusinessSection !== BasePlatformAdapter.prototype.extractAddressFromBusinessSection) capabilities.push('custom-address-extraction');

        return capabilities;
    }

    /**
     * Filter out duplicate results based on business name and other identifying fields
     */
    private filterDuplicateResults(results: ScrapingResult[]): ScrapingResult[] {
        if (results.length <= 1) {
            return results;
        }

        const uniqueResults: ScrapingResult[] = [];
        const seenBusinesses = new Set<string>();

        for (const result of results) {
            if (!result.business_name) {
                continue; // Skip results without business names
            }

            // Create a unique key for this business
            const businessKey = this.createBusinessKey(result);

            if (!seenBusinesses.has(businessKey)) {
                seenBusinesses.add(businessKey);
                uniqueResults.push(result);
            } else {
                console.log(`🔄 Duplicate business filtered out: ${result.business_name}`);
            }
        }

        return uniqueResults;
    }

    /**
     * Create a unique key for a business to identify duplicates
     */
    private createBusinessKey(result: ScrapingResult): string {
        const businessName = result.business_name.toLowerCase().trim();

        // Include location information if available to distinguish businesses with same name in different locations
        let locationKey = '';
        if (result.address) {
            const city = result.address.city?.toLowerCase().trim() || '';
            const state = result.address.state?.toLowerCase().trim() || '';
            const zip = result.address.zip?.toLowerCase().trim() || '';
            locationKey = `${city}${state}${zip}`;
        }

        // Include phone number if available for additional uniqueness
        const phoneKey = result.phone?.replace(/\D/g, '') || '';

        // Combine all identifying information
        return `${businessName}|${locationKey}|${phoneKey}`;
    }

    /**
     * Convert BusinessData to ScrapingResult
     */
    private convertBusinessDataToScrapingResult(businessData: any): ScrapingResult {
        const result: ScrapingResult = {
            business_name: businessData.business_name || '',
            email: businessData.email || undefined,
            phone: businessData.phone || undefined,
            website: businessData.website || undefined,
            address: {
                street: businessData.address?.street || undefined,
                city: businessData.address?.city || undefined,
                state: businessData.address?.state || undefined,
                zip: businessData.address?.zip || undefined,
                country: businessData.address?.country || undefined
            },
            social_media: businessData.social_media || undefined,
            categories: businessData.categories || undefined,
            business_hours: businessData.business_hours || undefined,
            description: businessData.description || undefined,
            rating: businessData.rating?.score || businessData.rating || undefined,
            review_count: businessData.rating?.review_count || businessData.review_count || undefined,
            fax_number: businessData.fax_number || undefined,
            contact_person: businessData.contact_person || undefined,
            year_established: businessData.year_established || undefined,
            number_of_employees: businessData.number_of_employees || undefined,
            payment_methods: businessData.payment_methods || undefined,
            specialties: businessData.specialties || undefined
        };
        return result;
    }

    /**
     * Wait for Cloudflare challenge to complete (if possible)
     * @param maxWaitTime Maximum time to wait in milliseconds (default: 30 seconds)
     * @returns true if Cloudflare challenge appears to be resolved, false otherwise
     */
    private async waitForCloudflareChallenge(maxWaitTime: number = 30000): Promise<boolean> {
        if (!this.page) return false;

        console.log(`⏳ Waiting for Cloudflare challenge to complete (max: ${maxWaitTime}ms)...`);

        const startTime = Date.now();
        const checkInterval = 2000; // Check every 2 seconds

        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check if Cloudflare protection is still active
                const isStillBlocked = await this.detectCloudflareProtection();

                if (!isStillBlocked) {
                    console.log('✅ Cloudflare challenge appears to be resolved');
                    return true;
                }

                // Wait before next check
                await this.sleep(checkInterval);

                // Log progress
                const elapsed = Date.now() - startTime;
                const remaining = maxWaitTime - elapsed;
                console.log(`⏳ Still waiting... (${Math.round(remaining / 1000)}s remaining)`);

            } catch (error) {
                console.warn('Error while waiting for Cloudflare challenge:', error);
                await this.sleep(checkInterval);
            }
        }

        console.log('⏰ Timeout waiting for Cloudflare challenge to complete');
        return false;
    }

    /**
     * Attempt to handle Cloudflare protection with retry logic
     * @param maxRetries Maximum number of retry attempts
     * @returns true if Cloudflare protection was handled successfully, false otherwise
     */
    private async handleCloudflareWithRetry(maxRetries: number = 3): Promise<boolean> {
        if (!this.page) return false;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`🔄 Cloudflare handling attempt ${attempt}/${maxRetries}`);

            try {
                // Check if Cloudflare protection is detected
                const isBlocked = await this.detectCloudflareProtection();

                if (!isBlocked) {
                    console.log('✅ No Cloudflare protection detected, continuing...');
                    return true;
                }

                // Notify parent process about the detection
                await this.handleCloudflareDetection();

                // Wait for challenge to complete
                const challengeResolved = await this.waitForCloudflareChallenge();

                if (challengeResolved) {
                    console.log('✅ Cloudflare challenge resolved, continuing with scraping...');
                    return true;
                }

                // If challenge not resolved, try refreshing the page
                if (attempt < maxRetries) {
                    console.log(`🔄 Attempting page refresh (attempt ${attempt + 1}/${maxRetries})`);
                    await this.page.reload({ waitUntil: 'networkidle2' });
                    await this.sleep(5000); // Wait 5 seconds after refresh
                }

            } catch (error) {
                console.error(`Error in Cloudflare handling attempt ${attempt}:`, error);
                if (attempt < maxRetries) {
                    await this.sleep(5000); // Wait before retry
                }
            }
        }

        console.log('❌ Failed to handle Cloudflare protection after all retry attempts');
        return false;
    }

    /**
     * Save current page HTML content to ~/tmp/ directory for debugging purposes
     */
    private async savePageHtmlForDebugging(pageNumber: number, reason: string): Promise<void> {
        if (!this.page) return;

        try {
            // Create ~/tmp/ directory if it doesn't exist
            const fs = require('fs').promises;
            const path = require('path');
            const os = require('os');

            const tmpDir = path.join(os.homedir(), 'tmp');
            await fs.mkdir(tmpDir, { recursive: true });
            // Also save the current page URL to a separate file for debugging
            // const urlFilename = `debug_${platform}_task${taskId}_page${pageNumber}_${reason}_${timestamp}.url.txt`;
            // const urlFilePath = path.join(tmpDir, urlFilename);
            //const currentpageUrl = this.page.url();
            // await fs.writeFile(urlFilePath, 'utf8');
            // Generate filename with timestamp, platform, and reason
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const platform = this.taskData.platform;
            const taskId = this.taskData.taskId;
            const filename = `debug_${platform}_task${taskId}_page${pageNumber}_${reason}_${timestamp}.html`;
            const filePath = path.join(tmpDir, filename);

            // Get page HTML content
            const htmlContent = await this.page.content();
            const currentUrl = this.page.url();

            // Create debug HTML with metadata
            const debugHtml = `<!-- DEBUG INFO
Platform: ${platform}
Task ID: ${taskId}
Page Number: ${pageNumber}
Reason: ${reason}
URL: ${currentUrl}
Timestamp: ${new Date().toISOString()}
Keywords: ${this.taskData.keywords.join(', ')}
Location: ${this.taskData.location}
-->

${htmlContent}`;

            // Save HTML content to file
            await fs.writeFile(filePath, debugHtml, 'utf8');

            console.log(`💾 Saved debug HTML to: ${filePath}`);
            console.log(`🔍 Debug info - Platform: ${platform}, Task: ${taskId}, Page: ${pageNumber}, URL: ${currentUrl}`);

        } catch (error) {
            console.error('❌ Error saving debug HTML:', error);
            // Don't throw - this is just for debugging
        }
    }
}
console.log('🚀 YellowPagesScraperProcess loaded');

// Global scraper instance for pause/resume operations
let globalScraper: YellowPagesScraperProcess | null = null;

// Handle process messages
process.parentPort.on('message', async (e) => {
    console.log(e);
    const message = JSON.parse(e.data);
    console.log('📨 Received message:', message.type);

    if (message.type === 'START' && message.taskData && message.platformInfo) {
        console.log('🚀 Starting scraper with data:', {
            taskId: message.taskData.taskId,
            platform: message.taskData.platform,
            hasAdapter: !!message.platformInfo.adapterClass,
            adapterClass: message.platformInfo.adapterClass?.className || 'None'
        });
        let scraper: YellowPagesScraperProcess;
        try {
            scraper = new YellowPagesScraperProcess(message.taskData, message.platformInfo);
            globalScraper = scraper; // Store reference for pause/resume operations
        } catch (error) {
            console.error('Error initializing scraper:', error);
            const errorMessage: ErrorMessage = {
                type: 'ERROR',
                taskId: message.taskData.taskId,
                content: `Failed to initialize scraper: ${error instanceof Error ? error.message : String(error)}`,
                error: error instanceof Error ? error.message : String(error)
            };
            process.parentPort?.postMessage(errorMessage);
            return;
        }
        // Set up callbacks for IPC communication
        scraper.onProgress((progress) => {
            const progressMessage: ProgressMessage = {
                type: 'PROGRESS',
                taskId: message.taskData.taskId,
                content: `Scraping progress: Page ${progress.currentPage}/${progress.totalPages} (${progress.percentage.toFixed(1)}%) - ${progress.resultsCount} results found`,
                progress
            };
            process.parentPort?.postMessage(progressMessage);
        });

        scraper.onComplete((results) => {
            const completedMessage: CompletedMessage = {
                type: 'COMPLETED',
                taskId: message.taskData.taskId,
                content: `Scraping completed successfully. Found ${results.length} business results.`,
                results
            };
            process.parentPort?.postMessage(completedMessage);
        });

        scraper.onError((error) => {
            const errorMessage: ErrorMessage = {
                type: 'ERROR',
                taskId: message.taskData.taskId,
                content: `Scraping failed with error: ${error.message}`,
                error: error.message
            };
            process.parentPort?.postMessage(errorMessage);
        });

        try {
            console.log('🚀 Starting scraper real');
            await scraper.start();
        } catch (error) {
            const errorMessage: ErrorMessage = {
                type: 'ERROR',
                taskId: message.taskData.taskId,
                content: `Failed to start scraping: ${error instanceof Error ? error.message : String(error)}`,
                error: error instanceof Error ? error.message : String(error)
            };
            process.parentPort?.postMessage(errorMessage);
        }
    } else if (message.type === 'PAUSE') {
        console.log('⏸️ Received pause command');
        if (globalScraper) {
            try {
                await globalScraper.pause();
            } catch (error) {
                console.error('Failed to pause scraper:', error);
            }
        } else {
            console.warn('No active scraper to pause');
        }
    } else if (message.type === 'RESUME') {
        console.log('▶️ Received resume command');
        if (globalScraper) {
            try {
                await globalScraper.resume();
            } catch (error) {
                console.error('Failed to resume scraper:', error);
            }
        } else {
            console.warn('No active scraper to resume');
        }
    } else {
        console.log('⚠️ Unknown message type:', message.type);
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
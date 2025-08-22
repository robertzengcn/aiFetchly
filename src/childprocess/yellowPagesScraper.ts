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

import { Page, Browser } from 'puppeteer';
import { BrowserManager } from '@/modules/browserManager';
import { ChildProcessAdapterFactory } from '@/modules/ChildProcessAdapterFactory';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { ProcessMessage } from '@/entityTypes/processMessage-type';
import { StartTaskMessage, ProgressMessage, CompletedMessage, ErrorMessage } from '@/interfaces/BackgroundProcessMessages';
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
    raw_data?: object;
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

    // IPC integration
    private onProgressCallback?: (progress: ScrapingProgress) => void;
    private onCompleteCallback?: (results: ScrapingResult[]) => void;
    private onErrorCallback?: (error: Error) => void;
    private pauseResumePromise: PauseResumePromise | null = null;

    constructor(taskData: TaskData, platformInfo: PlatformInfo) {
        this.taskData = taskData;
        this.platformInfo = platformInfo;
        this.sessionManager = new SessionRecordingManager();

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
                taskId: this.taskData.taskId
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
                taskId: this.taskData.taskId
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

        console.log(`🔧 Platform capabilities:`, {
            customSearch: hasCustomSearch,
            customExtraction: hasCustomExtraction,
            customPagination: hasCustomPagination,
            adapterClass: this.platformInfo.adapterClass?.className || 'None'
        });

        if (this.adapter) {
            console.log(`🚀 Using platform adapter: ${this.platformInfo.adapterClass?.className}`);
            console.log(`📋 Adapter methods:`, {
                searchBusinesses: hasCustomSearch ? 'Custom' : 'Default',
                extractBusinessData: hasCustomExtraction ? 'Custom' : 'Default',
                handlePagination: hasCustomPagination ? 'Custom' : 'Default'
            });
        } else {
            console.log(`🔧 No platform adapter available, using configuration-based approach`);
        }

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
                    let results: ScrapingResult[] = [];

                    if (hasCustomSearch && hasCustomExtraction) {
                        // Use platform-specific adapter methods for complete control
                        console.log(`🔧 Using platform-specific adapter for keyword: ${keyword}, page: ${pageNum}`);
                        
                        try {
                            // Use adapter's custom search method
                            const searchResults = await this.adapter!.searchBusinesses(
                                this.page!, 
                                [keyword], 
                                location
                            );
                            
                            console.log(`🔍 Adapter search returned ${searchResults.length} results`);
                            
                            // Use adapter's custom data extraction method
                            if (searchResults.length > 0) {
                                const businessData = await this.adapter!.extractBusinessData(this.page!);
                                console.log(`📊 Adapter extracted business data:`, businessData.business_name);
                                // Convert BusinessData to ScrapingResult format
                                results = [this.convertBusinessDataToScrapingResult(businessData)];
                            }
                            
                            // Handle pagination using adapter if available
                            if (hasCustomPagination && pageNum < maxPages) {
                                console.log(`📄 Using adapter pagination for page ${pageNum}`);
                                await this.adapter!.handlePagination(this.page!, maxPages);
                            }
                        } catch (error) {
                            console.error(`❌ Error using platform-specific adapter:`, error);
                            console.log(`🔄 Falling back to generic scraping logic`);
                            // Fallback to generic method
                            await this.navigateToSearchPage(keyword, location, pageNum);
                            while (this.isPaused && this.isRunning) {
                                await this.sleep(1000);
                            }
                            results = await this.extractBusinessData();
                        }
                        
                    } else if (hasCustomExtraction) {
                        // Use adapter's custom data extraction but generic navigation
                        console.log(`🔧 Using hybrid approach: generic navigation + custom extraction for keyword: ${keyword}, page: ${pageNum}`);
                        
                        try {
                            // Navigate to search page using generic method
                            await this.navigateToSearchPage(keyword, location, pageNum);
                            
                            // Wait if paused
                            while (this.isPaused && this.isRunning) {
                                await this.sleep(1000);
                            }
                            
                            // Use adapter's custom data extraction
                            const businessData = await this.adapter!.extractBusinessData(this.page!);
                            console.log(`📊 Adapter extracted business data:`, businessData.business_name);
                            results = [this.convertBusinessDataToScrapingResult(businessData)];
                            
                            // Handle pagination using adapter if available
                            if (hasCustomPagination && pageNum < maxPages) {
                                console.log(`📄 Using adapter pagination for page ${pageNum}`);
                                await this.adapter!.handlePagination(this.page!, maxPages);
                            }
                        } catch (error) {
                            console.error(`❌ Error using hybrid approach:`, error);
                            console.log(`🔄 Falling back to generic scraping logic`);
                            // Fallback to generic method
                            results = await this.extractBusinessData();
                        }
                        
                    } else {
                        // Fallback to generic scraping logic
                        console.log(`🔧 Using generic scraping logic for keyword: ${keyword}, page: ${pageNum}`);
                        
                        // Navigate to search page using human-like interaction
                        await this.navigateToSearchPage(keyword, location, pageNum);
                        
                        // Wait if paused
                        while (this.isPaused && this.isRunning) {
                            await this.sleep(1000);
                        }
                        
                        // Extract business data using generic method
                        results = await this.extractBusinessData();
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

                    // Delay between requests (only for generic approach or when not using custom pagination)
                    if (pageNum < maxPages && (!hasCustomPagination || !hasCustomSearch)) {
                        await this.sleep(delayBetweenRequests);
                    }

                } catch (error) {
                    console.error(`Error scraping page ${pageNum}:`, error);
                    // Continue with next page
                }
            }
        }

        // Complete session recording and save if results > 1
        if (this.sessionManager.getRecordingStatus()) {
            console.log(`📹 Completing session recording with ${totalResults.length} results`);
            await this.sessionManager.endSession(totalResults.length, totalResults);
            await this.sessionManager.saveSession();
        }

        return totalResults;
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
                timeout: 30000
            });

            // Wait for page to load completely
            await this.sleep(2000);

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

                    // Navigate to specific page if needed
                    if (pageNum > 1) {
                        await this.navigateToPage(pageNum);
                    }
                } else {
                    // Fallback to URL-based navigation if no form found
                    console.log('No search form found, using URL-based navigation');
                    const searchUrl = this.buildFallbackSearchUrl(keyword, location, pageNum);
                    await this.page.goto(searchUrl, { waitUntil: 'networkidle2' });
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

                await this.page.keyboard.press('Enter');
                console.log('Submitted search form using Enter key (no button selector)');
            }

            // Wait for navigation
            await this.page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: 15000
            });

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

            // Log data extraction action for AI training
            if (this.sessionManager.getRecordingStatus() && this.page) {
                const currentState = await this.sessionManager.capturePageState(this.page);
                this.sessionManager.logAction(currentState, `extract('${selectors.businessList}')`);
            }

            // Extract all business listings
            const businessElements = await this.page.$$(selectors.businessList);

            for (const element of businessElements) {
                if (!this.isRunning) break;

                try {
                    const result = await this.extractBusinessFromElement(element, selectors);
                    if (result) {
                        // Check if navigation to detail page is required
                        if (selectors.navigation?.required && selectors.navigation.detailLink) {
                            const enhancedResult = await this.navigateToDetailPageAndExtract(element, selectors, result);
                            if (enhancedResult) {
                                results.push(enhancedResult);
                            }
                        } else {
                            results.push(result);
                        }
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
            if (!detailLink) {
                console.log('Detail link not found, using basic result');
                return basicResult;
            }

            // Get the href attribute
            const detailUrl = await detailLink.evaluate(el => el.getAttribute('href'));
            if (!detailUrl) {
                console.log('Detail URL not found, using basic result');
                return basicResult;
            }

            // Convert relative URL to absolute if needed
            const absoluteUrl = detailUrl.startsWith('http') ? detailUrl : new URL(detailUrl, this.platformInfo.base_url).href;

            console.log(`Navigating to detail page: ${absoluteUrl}`);

            // Store current page context for AI training
            if (this.sessionManager.getRecordingStatus() && this.page) {
                const currentState = await this.sessionManager.capturePageState(this.page);
                this.sessionManager.logAction(currentState, `goto('${absoluteUrl}')`);
            }

            // Navigate to detail page
            if (this.page) {
                await this.page.goto(absoluteUrl, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });

                // Wait for page to load
                await this.sleep(selectors.navigation.delayAfterNavigation || 2000);

                // Extract enhanced data from detail page
                const enhancedResult = await this.extractEnhancedDataFromDetailPage(basicResult, selectors);

                // Navigate back to search results (if needed)
                await this.page.goBack({ waitUntil: 'networkidle2' });

                // Wait for search results to reload
                await this.page.waitForSelector(selectors.businessList, { timeout: 10000 });

                return enhancedResult;
            }

            return basicResult;

        } catch (error) {
            console.error('Error navigating to detail page:', error);
            // Return basic result if navigation fails
            return basicResult;
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
        const enhancedResult = { ...basicResult };

        try {
            // Extract enhanced business name if available
            if (detailSelectors.businessName) {
                const enhancedName = await this.extractTextFromPage(detailSelectors.businessName);
                if (enhancedName) enhancedResult.business_name = enhancedName;
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

            // Extract additional email addresses if available
            if (detailSelectors.additionalEmail) {
                const additionalEmail = await this.extractTextFromPage(detailSelectors.additionalEmail);
                if (additionalEmail) enhancedResult.email = additionalEmail;
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
     * Extract business data from a single element
     */
    private async extractBusinessFromElement(element: any, selectors: PlatformInfo['selectors']): Promise<ScrapingResult | null> {
        try {
            const business_name = await this.extractText(element, selectors.businessName);
            if (!business_name) return null;

            const result: ScrapingResult = {
                business_name,
                email: selectors.email ? await this.extractText(element, selectors.email) : undefined,
                phone: selectors.phone ? await this.extractText(element, selectors.phone) : undefined,
                website: selectors.website ? await this.extractAttribute(element, selectors.website, 'href') : undefined,
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
                raw_data: await this.extractRawData(element),
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

        return capabilities;
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
            raw_data: businessData,
            fax_number: businessData.fax_number || undefined,
            contact_person: businessData.contact_person || undefined,
            year_established: businessData.year_established || undefined,
            number_of_employees: businessData.number_of_employees || undefined,
            payment_methods: businessData.payment_methods || undefined,
            specialties: businessData.specialties || undefined
        };
        return result;
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

        const scraper = new YellowPagesScraperProcess(message.taskData, message.platformInfo);
        globalScraper = scraper; // Store reference for pause/resume operations

        // Set up callbacks for IPC communication
        scraper.onProgress((progress) => {
            const progressMessage: ProgressMessage = {
                type: 'PROGRESS',
                taskId: message.taskData.taskId,
                progress
            };
            process.parentPort?.postMessage(progressMessage);
        });

        scraper.onComplete((results) => {
            const completedMessage: CompletedMessage = {
                type: 'COMPLETED',
                taskId: message.taskData.taskId,
                results
            };
            process.parentPort?.postMessage(completedMessage);
        });

        scraper.onError((error) => {
            const errorMessage: ErrorMessage = {
                type: 'ERROR',
                taskId: message.taskData.taskId,
                error: error.message
            };
            process.parentPort?.postMessage(errorMessage);
        });

        try {
            await scraper.start();
        } catch (error) {
            const errorMessage: ErrorMessage = {
                type: 'ERROR',
                taskId: message.taskData.taskId,
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
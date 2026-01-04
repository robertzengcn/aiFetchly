import { Page } from 'puppeteer';

/**
 * Core scraping engine interface that defines the contract for all scraping operations.
 * 
 * This interface ensures consistent behavior across different scraping implementations
 * and provides a standardized way to interact with various yellow pages platforms.
 * 
 * @example
 * ```typescript
 * const scraper = new YellowPagesScraperEngine(platformAdapter, dataExtractor, progressReporter);
 * await scraper.start();
 * const results = await scraper.scrapeTask(task);
 * await scraper.stop();
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface IScraperEngine {
    /**
     * Core scraping functionality to extract business data from a task
     * @param task - The scraping task configuration
     * @returns Promise resolving to an array of scraped business results
     */
    scrapeTask(task: YellowPagesTask): Promise<YellowPagesResult[]>;

    /**
     * Extract business data from a web page using provided selectors
     * @param page - Puppeteer Page object
     * @param selectors - Platform-specific CSS selectors
     * @returns Promise resolving to structured business data
     */
    extractBusinessData(page: Page, selectors: PlatformSelectors): Promise<BusinessData>;

    /**
     * Handle pagination on the current page
     * @param page - Puppeteer Page object
     * @param maxPages - Maximum number of pages to process
     * @returns Promise that resolves when pagination is complete
     */
    handlePagination(page: Page, maxPages: number): Promise<void>;

    /**
     * Start the scraping process
     * @returns Promise that resolves when scraping starts
     */
    start(): Promise<void>;

    /**
     * Stop the scraping process gracefully
     * @returns Promise that resolves when scraping stops
     */
    stop(): Promise<void>;

    /**
     * Pause the scraping process
     * @returns Promise that resolves when scraping is paused
     */
    pause(): Promise<void>;

    /**
     * Resume the scraping process
     * @returns Promise that resolves when scraping resumes
     */
    resume(): Promise<void>;

    /**
     * Register a progress callback function
     * @param callback - Function to call with progress updates
     */
    onProgress(callback: (progress: ScrapingProgress) => void): void;

    /**
     * Register an error callback function
     * @param callback - Function to call when errors occur
     */
    onError(callback: (error: ScrapingError) => void): void;

    /**
     * Register a completion callback function
     * @param callback - Function to call when scraping completes
     */
    onComplete(callback: (results: YellowPagesResult[]) => void): void;
}

/**
 * Business data structure extracted from web pages
 */
export interface BusinessData {
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

/**
 * Platform-specific CSS selectors for data extraction
 */
export interface PlatformSelectors {
    businessList: string;
    businessName: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    address_country?: string;
    categories?: string;
    socialMedia?: string;
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
    pagination?: {
        nextButton?: string;
        currentPage?: string;
        maxPages?: string;
    };
}

/**
 * Scraping progress information
 */
export interface ScrapingProgress {
    currentPage: number;
    totalPages: number;
    resultsCount: number;
    percentage: number;
    estimatedTimeRemaining?: number;
}

/**
 * Scraping error information
 */
export interface ScrapingError {
    message: string;
    taskId: number;
    timestamp: Date;
    stack?: string;
}

/**
 * Yellow Pages task configuration
 */
export interface YellowPagesTask {
    id: number;
    name: string;
    platform: string;
    keywords: string[];
    location: string;
    max_pages: number;
    concurrency: number;
    status: TaskStatus;
    created_at: Date;
    updated_at: Date;
    scheduled_at?: Date;
    completed_at?: Date;
    error_log?: string;
    run_log?: string;
    account_id?: number;
    proxy_config?: object;
    delay_between_requests: number;
}

/**
 * Yellow Pages result data
 */
export interface YellowPagesResult {
    id: number;
    task_id: number;
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
    scraped_at: Date;
    platform: string;
    raw_data?: object;
    fax_number?: string;
    contact_person?: string;
    year_established?: number;
    number_of_employees?: string;
    payment_methods?: string[];
    specialties?: string[];
}

/**
 * Task status enumeration
 */
export enum TaskStatus {
    Pending = 0,
    InProgress = 1,
    Completed = 2,
    Failed = 3,
    Paused = 4
} 
/**
 * Progress reporting interface that defines the contract for reporting scraping progress.
 * 
 * This interface ensures consistent progress tracking across the system and provides
 * real-time updates on scraping operations. It supports both synchronous and asynchronous
 * progress reporting with callback-based notifications.
 * 
 * @example
 * ```typescript
 * const reporter = new ProgressReporter();
 * reporter.onProgressUpdate((progress) => {
 *   console.log(`Progress: ${progress.percentage}%`);
 * });
 * reporter.reportProgress({ currentPage: 1, totalPages: 10, percentage: 10 });
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface IProgressReporter {
    /**
     * Report progress update
     * @param progress - Progress information to report
     */
    reportProgress(progress: ScrapingProgress): void;

    /**
     * Report an error that occurred during scraping
     * @param error - Error information to report
     */
    reportError(error: ScrapingError): void;

    /**
     * Report task completion
     * @param results - Array of scraped results
     */
    reportCompletion(results: YellowPagesResult[]): void;

    /**
     * Get the current progress information
     * @returns Current progress information
     */
    getCurrentProgress(): ScrapingProgress;

    /**
     * Get estimated time remaining for the current task
     * @returns Estimated time remaining in milliseconds
     */
    getEstimatedTimeRemaining(): number;

    /**
     * Get the success rate of the current scraping operation
     * @returns Success rate as a percentage (0-100)
     */
    getSuccessRate(): number;

    /**
     * Register a callback for progress updates
     * @param callback - Function to call with progress updates
     */
    onProgressUpdate(callback: (progress: ScrapingProgress) => void): void;

    /**
     * Register a callback for error events
     * @param callback - Function to call when errors occur
     */
    onError(callback: (error: ScrapingError) => void): void;

    /**
     * Register a callback for completion events
     * @param callback - Function to call when scraping completes
     */
    onCompletion(callback: (results: YellowPagesResult[]) => void): void;
}

/**
 * Scraping progress information
 */
export interface ScrapingProgress {
    taskId: number;
    currentPage: number;
    totalPages: number;
    resultsCount: number;
    percentage: number;
    estimatedTimeRemaining?: number;
    startTime?: Date;
    lastUpdateTime: Date;
    status: TaskStatus;
    errorMessage?: string;
}

/**
 * Scraping error information
 */
export interface ScrapingError {
    message: string;
    taskId: number;
    timestamp: Date;
    stack?: string;
    severity: 'error' | 'warning';
    recoverable: boolean;
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

/**
 * Yellow Pages result structure
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
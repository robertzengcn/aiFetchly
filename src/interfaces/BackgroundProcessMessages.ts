/**
 * Message types for communication between main process and background processes
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */

import { ScrapingProgress } from './IPCMessage';

/**
 * Base interface for all background process messages
 */
export interface BaseBackgroundMessage {
    type: string;
    taskId: number;
}

/**
 * Message sent from main process to start a task
 */
export interface StartTaskMessage extends BaseBackgroundMessage {
    type: 'START';
    taskData: {
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
    };
    platformInfo: {
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
        };
        adapterClass?: {
            className: string;
            modulePath: string;
        };
    };
}

/**
 * Message sent from background process to report progress
 */
export interface ProgressMessage extends BaseBackgroundMessage {
    type: 'PROGRESS';
    progress: ScrapingProgress;
}

/**
 * Message sent from background process when task is completed
 */
export interface CompletedMessage extends BaseBackgroundMessage {
    type: 'COMPLETED';
    results: any[]; // Array of scraped business data
}

/**
 * Message sent from background process when an error occurs
 */
export interface ErrorMessage extends BaseBackgroundMessage {
    type: 'ERROR';
    error: string;
}

/**
 * Message sent from background process when scraping starts
 */
export interface ScrapingStartedMessage extends BaseBackgroundMessage {
    type: 'SCRAPING_STARTED';
}

/**
 * Message sent from background process when a page is completed
 */
export interface ScrapingPageCompleteMessage extends BaseBackgroundMessage {
    type: 'SCRAPING_PAGE_COMPLETE';
    page: number;
    totalPages: number;
}

/**
 * Message sent from background process when a result is found
 */
export interface ScrapingResultFoundMessage extends BaseBackgroundMessage {
    type: 'SCRAPING_RESULT_FOUND';
    result: {
        businessName?: string;
        [key: string]: any;
    };
}

/**
 * Message sent from background process when rate limited
 */
export interface ScrapingRateLimitedMessage extends BaseBackgroundMessage {
    type: 'SCRAPING_RATE_LIMITED';
}

/**
 * Message sent from background process when CAPTCHA is detected
 */
export interface ScrapingCaptchaDetectedMessage extends BaseBackgroundMessage {
    type: 'SCRAPING_CAPTCHA_DETECTED';
}

/**
 * Message sent from main process to pause a task
 */
export interface PauseTaskMessage extends BaseBackgroundMessage {
    type: 'PAUSE';
}

/**
 * Message sent from main process to resume a task
 */
export interface ResumeTaskMessage extends BaseBackgroundMessage {
    type: 'RESUME';
}

/**
 * Message sent from background process when task is paused
 */
export interface TaskPausedMessage extends BaseBackgroundMessage {
    type: 'TASK_PAUSED';
}

/**
 * Message sent from background process when task is resumed
 */
export interface TaskResumedMessage extends BaseBackgroundMessage {
    type: 'TASK_RESUMED';
}

/**
 * Union type for all possible background process messages
 */
export type BackgroundProcessMessage = 
    | StartTaskMessage
    | ProgressMessage
    | CompletedMessage
    | ErrorMessage
    | ScrapingStartedMessage
    | ScrapingPageCompleteMessage
    | ScrapingResultFoundMessage
    | ScrapingRateLimitedMessage
    | ScrapingCaptchaDetectedMessage
    | PauseTaskMessage
    | ResumeTaskMessage
    | TaskPausedMessage
    | TaskResumedMessage;

/**
 * Type guard to check if a message is a StartTaskMessage
 */
export function isStartTaskMessage(message: any): message is StartTaskMessage {
    return message && message.type === 'START' && message.taskData && message.platformInfo;
}

/**
 * Type guard to check if a message is a ProgressMessage
 */
export function isProgressMessage(message: any): message is ProgressMessage {
    return message && message.type === 'PROGRESS' && message.progress;
}

/**
 * Type guard to check if a message is a CompletedMessage
 */
export function isCompletedMessage(message: any): message is CompletedMessage {
    return message && message.type === 'COMPLETED' && message.results;
}

/**
 * Type guard to check if a message is an ErrorMessage
 */
export function isErrorMessage(message: any): message is ErrorMessage {
    return message && message.type === 'ERROR' && message.error;
}

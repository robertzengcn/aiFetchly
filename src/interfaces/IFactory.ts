import { IScraperEngine } from './IScraperEngine';
import { IPlatformAdapter } from './IPlatformAdapter';
import { IDataExtractor } from './IDataExtractor';

/**
 * Scraper factory interface that defines the contract for creating scraper engine instances.
 * 
 * This interface ensures consistent scraper creation across different platforms and provides
 * a centralized way to manage scraper instances. It supports dynamic registration and
 * unregistration of platform adapters and data extractors.
 * 
 * @example
 * ```typescript
 * const factory = new YellowPagesScraperFactory();
 * const scraper = await factory.createScraperEngine('yellowpages.com');
 * const adapter = await factory.createPlatformAdapter('yelp.com');
 * const extractor = await factory.createDataExtractor('yellowpages.ca');
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface IScraperFactory {
    /**
     * Create a scraper engine for a specific platform
     * @param platform - Platform name to create scraper for
     * @returns Promise resolving to a scraper engine instance
     */
    createScraperEngine(platform: string): Promise<IScraperEngine>;

    /**
     * Create a platform adapter for a specific platform
     * @param platform - Platform name to create adapter for
     * @returns Promise resolving to a platform adapter instance
     */
    createPlatformAdapter(platform: string): Promise<IPlatformAdapter>;

    /**
     * Create a data extractor for a specific platform
     * @param platform - Platform name to create extractor for
     * @returns Promise resolving to a data extractor instance
     */
    createDataExtractor(platform: string): Promise<IDataExtractor>;

    /**
     * Get list of supported platforms
     * @returns Array of supported platform names
     */
    getSupportedPlatforms(): string[];

    /**
     * Register a new platform adapter
     * @param platform - Platform name
     * @param adapter - Platform adapter instance
     */
    registerPlatformAdapter(platform: string, adapter: IPlatformAdapter): void;

    /**
     * Register a new data extractor
     * @param platform - Platform name
     * @param extractor - Data extractor instance
     */
    registerDataExtractor(platform: string, extractor: IDataExtractor): void;

    /**
     * Unregister a platform adapter
     * @param platform - Platform name to unregister
     */
    unregisterPlatformAdapter(platform: string): void;

    /**
     * Unregister a data extractor
     * @param platform - Platform name to unregister
     */
    unregisterDataExtractor(platform: string): void;
}

/**
 * Platform factory interface that defines the contract for creating platform-specific adapters.
 * This interface ensures consistent platform adapter creation.
 */
export interface IPlatformFactory {
    /**
     * Create an adapter for a specific platform
     * @param platformName - Name of the platform
     * @returns Promise resolving to a platform adapter instance
     */
    createAdapter(platformName: string): Promise<IPlatformAdapter>;

    /**
     * Register a new platform adapter
     * @param platformName - Name of the platform
     * @param adapter - Platform adapter instance
     */
    registerAdapter(platformName: string, adapter: IPlatformAdapter): void;

    /**
     * Unregister a platform adapter
     * @param platformName - Name of the platform to unregister
     */
    unregisterAdapter(platformName: string): void;

    /**
     * Get all registered adapters
     * @returns Map of platform names to adapter instances
     */
    getRegisteredAdapters(): Map<string, IPlatformAdapter>;

    /**
     * Check if a platform adapter exists
     * @param platformName - Name of the platform
     * @returns True if adapter exists
     */
    hasAdapter(platformName: string): boolean;

    /**
     * Get list of available platforms
     * @returns Array of available platform names
     */
    getAvailablePlatforms(): string[];
}

/**
 * Data extractor factory interface that defines the contract for creating data extractors.
 * This interface ensures consistent data extractor creation.
 */
export interface IDataExtractorFactory {
    /**
     * Create a data extractor for a specific platform
     * @param platformName - Name of the platform
     * @returns Promise resolving to a data extractor instance
     */
    createExtractor(platformName: string): Promise<IDataExtractor>;

    /**
     * Register a new data extractor
     * @param platformName - Name of the platform
     * @param extractor - Data extractor instance
     */
    registerExtractor(platformName: string, extractor: IDataExtractor): void;

    /**
     * Unregister a data extractor
     * @param platformName - Name of the platform to unregister
     */
    unregisterExtractor(platformName: string): void;

    /**
     * Get all registered extractors
     * @returns Map of platform names to extractor instances
     */
    getRegisteredExtractors(): Map<string, IDataExtractor>;

    /**
     * Check if a data extractor exists
     * @param platformName - Name of the platform
     * @returns True if extractor exists
     */
    hasExtractor(platformName: string): boolean;
}

/**
 * Progress reporter factory interface that defines the contract for creating progress reporters.
 * This interface ensures consistent progress reporter creation.
 */
export interface IProgressReporterFactory {
    /**
     * Create a progress reporter for a specific task
     * @param taskId - ID of the task
     * @returns Promise resolving to a progress reporter instance
     */
    createReporter(taskId: number): Promise<IProgressReporter>;

    /**
     * Get existing progress reporter for a task
     * @param taskId - ID of the task
     * @returns Progress reporter instance or null if not found
     */
    getReporter(taskId: number): IProgressReporter | null;

    /**
     * Remove progress reporter for a task
     * @param taskId - ID of the task
     */
    removeReporter(taskId: number): void;

    /**
     * Get all active progress reporters
     * @returns Map of task IDs to progress reporter instances
     */
    getActiveReporters(): Map<number, IProgressReporter>;
}

/**
 * Progress reporter interface (imported from IProgressReporter)
 */
export interface IProgressReporter {
    reportProgress(progress: any): void;
    reportError(error: any): void;
    reportCompletion(results: any[]): void;
    getCurrentProgress(): any;
    getEstimatedTimeRemaining(): number;
    getSuccessRate(): number;
    onProgressUpdate(callback: (progress: any) => void): void;
    onError(callback: (error: any) => void): void;
    onCompletion(callback: (results: any[]) => void): void;
} 
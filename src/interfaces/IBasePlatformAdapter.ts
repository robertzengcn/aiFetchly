import { Page } from 'puppeteer';
import { PlatformConfig, PlatformSelectors, PlatformSettings, PlatformSummary } from './IPlatformConfig';
import { BusinessData, Address } from './IDataExtractor';

/**
 * Base platform adapter interface that provides default implementations for all platform types.
 * This interface serves as the foundation for configuration-only, class-based, and hybrid platforms.
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface IBasePlatformAdapter {
    /** Platform configuration */
    readonly config: PlatformConfig;
    
    /** Platform name */
    readonly platformName: string;
    
    /** Base URL */
    readonly baseUrl: string;
    
    /** Platform version */
    readonly version: string;
    
    /**
     * Search for businesses using keywords and location
     * @param page - Puppeteer page object
     * @param keywords - Array of search keywords
     * @param location - Location to search in
     * @returns Promise resolving to search results
     * 
     * Note: This method has a default implementation in BasePlatformAdapter.
     * Subclasses can override it for custom search logic, but it's not required.
     */
    searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]>;
    
    /**
     * Extract business data from a page
     * @param page - Puppeteer page object
     * @returns Promise resolving to business data
     */
    extractBusinessData(page: Page): Promise<BusinessData>;
    
    /**
     * Handle pagination on the current page
     * @param page - Puppeteer page object
     * @param maxPages - Maximum number of pages to process
     * @returns Promise that resolves when pagination is complete
     */
    handlePagination(page: Page, maxPages: number): Promise<void>;
    
    /**
     * Apply cookies to the page for authentication
     * @param page - Puppeteer page object
     * @param cookies - Cookies to apply
     * @returns Promise that resolves when cookies are applied
     */
    applyCookies(page: Page, cookies: any): Promise<void>;
    
    /**
     * Get platform selectors
     * @returns Platform selectors object
     */
    getSelectors(): PlatformSelectors;
    
    /**
     * Get rate limiting configuration
     * @returns Rate limiting configuration
     */
    getRateLimitingConfig(): RateLimitingConfig;
    
    /**
     * Get authentication configuration
     * @returns Authentication configuration
     */
    getAuthenticationConfig(): AuthenticationConfig;
    
    /**
     * Check if platform supports authentication
     * @returns True if authentication is supported
     */
    supportsAuthentication(): boolean;
    
    /**
     * Check if platform supports proxy
     * @returns True if proxy is supported
     */
    supportsProxy(): boolean;
    
    /**
     * Check if platform supports cookies
     * @returns True if cookies are supported
     */
    supportsCookies(): boolean;
    
    /**
     * Get supported platform features
     * @returns Array of supported features
     */
    getSupportedFeatures(): string[];
    
    /**
     * Custom function called after page load (optional)
     * This method is called when a page is fully loaded and can be used for
     * platform-specific post-load operations like waiting for dynamic content,
     * handling overlays, or performing custom initialization.
     * @param page - Puppeteer page object
     * @returns Promise that resolves when post-load operations are complete
     * 
     * Note: This method is optional and has a default no-op implementation.
     * Subclasses can override it for custom post-load logic.
     */
    onPageLoad?(page: Page): Promise<void>;
    
    /**
     * Extract phone number with reveal interaction for platforms that hide phone numbers behind click buttons (optional)
     * This method handles phone reveal interactions like clicking "Afficher le N°" buttons
     * @param page - Puppeteer page object
     * @param businessElement - Business element to extract phone from
     * @returns Promise resolving to phone number string or undefined
     * 
     * Note: This method is optional and has a default implementation that returns undefined.
     * Subclasses can override it for platform-specific phone reveal extraction.
     */
    extractPhoneNumberWithReveal?(page: Page, businessElement: any): Promise<string | undefined>;
    
    /**
     * Extract website URL with reveal interaction for platforms that hide website URLs behind click buttons (optional)
     * This method handles website reveal interactions like clicking encoded data attributes
     * @param page - Puppeteer page object
     * @param businessElement - Business element to extract website from
     * @returns Promise resolving to website URL string or undefined
     * 
     * Note: This method is optional and has a default implementation that returns undefined.
     * Subclasses can override it for platform-specific website reveal extraction.
     */
    extractWebsiteWithReveal?(page: Page, businessElement: any): Promise<string | undefined>;
    
    /**
     * Build search URL for the platform
     * @param keywords - Search keywords
     * @param location - Search location
     * @param pageNum - Page number
     * @returns Search URL
     */
    buildSearchUrl(keywords: string[], location: string, pageNum: number): string;
    
    /**
     * Validate platform configuration
     * @returns Validation result
     */
    validateConfig(): ValidationResult;
}

/**
 * Search result interface
 */
export interface SearchResult {
    /** Business name */
    businessName: string;
    
    /** Business URL */
    url?: string;
    
    /** Business address */
    address?: Address;
    
    /** Business phone */
    phone?: string;
    
    /** Business rating */
    rating?: number;
    
    /** Number of reviews */
    reviewCount?: number;
    
    /** Business categories */
    categories?: string[];
}

/**
 * Rate limiting configuration
 */
export interface RateLimitingConfig {
    /** Requests per hour */
    requestsPerHour: number;
    
    /** Delay between requests in milliseconds */
    delayBetweenRequests: number;
    
    /** Maximum concurrent requests */
    maxConcurrentRequests: number;
    
    /** Whether to use exponential backoff */
    useExponentialBackoff?: boolean;
    
    /** Maximum retry attempts */
    maxRetries?: number;
}

/**
 * Authentication configuration
 */
export interface AuthenticationConfig {
    /** Whether authentication is required */
    requiresAuthentication: boolean;
    
    /** Whether cookies are supported */
    supportsCookies: boolean;
    
    /** Whether proxy is supported */
    supportsProxy: boolean;
    
    /** Login URL */
    loginUrl?: string;
    
    /** Logout URL */
    logoutUrl?: string;
    
    /** Session timeout in minutes */
    sessionTimeout?: number;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
    /** Whether the configuration is valid */
    isValid: boolean;
    
    /** Validation errors */
    errors: string[];
    
    /** Validation warnings */
    warnings: string[];
    
    /** Validation score (0-100) */
    score: number;
}

/**
 * Platform adapter factory interface
 */
export interface IPlatformAdapterFactory {
    /**
     * Create platform adapter from configuration
     * @param config - Platform configuration
     * @returns Promise resolving to platform adapter
     */
    createAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter>;
    
    /**
     * Register platform adapter
     * @param platformName - Platform name
     * @param adapter - Platform adapter
     */
    registerAdapter(platformName: string, adapter: IBasePlatformAdapter): void;
    
    /**
     * Unregister platform adapter
     * @param platformName - Platform name
     */
    unregisterAdapter(platformName: string): void;
    
    /**
     * Get registered adapters
     * @returns Map of registered adapters
     */
    getRegisteredAdapters(): Map<string, IBasePlatformAdapter>;
    
    /**
     * Check if adapter exists
     * @param platformName - Platform name
     * @returns True if adapter exists
     */
    hasAdapter(platformName: string): boolean;
    
    /**
     * Get available platforms with basic information
     * @returns Array of platform summaries with id, name, and display_name
     */
    getAvailablePlatforms(): PlatformSummary[];
} 
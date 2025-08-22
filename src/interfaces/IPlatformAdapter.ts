import { Page } from 'puppeteer';

/**
 * Platform adapter interface that standardizes interactions with different yellow pages platforms.
 * 
 * Each platform implementation must conform to this interface to ensure consistent behavior
 * across different yellow pages websites. This interface abstracts platform-specific details
 * and provides a unified way to interact with various platforms.
 * 
 * @example
 * ```typescript
 * const adapter = new YellowPagesComAdapter();
 * const results = await adapter.searchBusinesses(page, ['restaurant'], 'New York');
 * const data = await adapter.extractBusinessData(page);
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface IPlatformAdapter {
    /**
     * Platform name identifier
     */
    readonly platformName: string;

    /**
     * Base URL for the platform
     */
    readonly baseUrl: string;

    /**
     * Platform version
     */
    readonly version: string;

    /**
     * Search for businesses using keywords and location
     * @param page - Puppeteer Page object
     * @param keywords - Array of search keywords
     * @param location - Location to search in
     * @returns Promise resolving to search results
     */
    searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]>;

    /**
     * Extract business data from the current page
     * @param page - Puppeteer Page object
     * @returns Promise resolving to structured business data
     */
    extractBusinessData(page: Page): Promise<BusinessData>;

    /**
     * Handle pagination on the current page
     * @param page - Puppeteer Page object
     * @param maxPages - Maximum number of pages to process
     * @returns Promise that resolves when pagination is complete
     */
    handlePagination(page: Page, maxPages: number): Promise<void>;

    /**
     * Apply cookies to the page for authentication
     * @param page - Puppeteer Page object
     * @param cookies - Cookies to apply
     * @returns Promise that resolves when cookies are applied
     */
    applyCookies(page: Page, cookies: CookiesType): Promise<void>;

    /**
     * Get platform-specific CSS selectors
     * @returns Object containing CSS selectors for data extraction
     */
    getSelectors(): PlatformSelectors;

    /**
     * Get rate limiting configuration for the platform
     * @returns Rate limiting configuration
     */
    getRateLimitingConfig(): RateLimitingConfig;

    /**
     * Get authentication configuration for the platform
     * @returns Authentication configuration
     */
    getAuthenticationConfig(): AuthenticationConfig;

    /**
     * Check if the platform requires authentication
     * @returns True if authentication is required
     */
    supportsAuthentication(): boolean;

    /**
     * Check if the platform supports proxy usage
     * @returns True if proxy is supported
     */
    supportsProxy(): boolean;

    /**
     * Check if the platform supports cookie management
     * @returns True if cookies are supported
     */
    supportsCookies(): boolean;

    /**
     * Get list of supported features for the platform
     * @returns Array of supported feature names
     */
    getSupportedFeatures(): PlatformFeature[];
}

/**
 * Search result structure
 */
export interface SearchResult {
    id: string;
    business_name: string;
    url: string;
    snippet?: string;
    rating?: number;
    review_count?: number;
}

/**
 * Business data structure
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
 * Platform-specific CSS selectors
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
 * Rate limiting configuration
 */
export interface RateLimitingConfig {
    requestsPerHour: number;
    delayBetweenRequests: number;
    maxConcurrentRequests: number;
}

/**
 * Authentication configuration
 */
export interface AuthenticationConfig {
    requiresAuthentication: boolean;
    supportsCookies: boolean;
    supportsProxy: boolean;
}

/**
 * Cookies type for authentication
 */
export type CookiesType = Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}>;

/**
 * Platform feature types
 */
export type PlatformFeature = 
    | 'search'
    | 'pagination'
    | 'cookies'
    | 'proxy'
    | 'authentication'
    | 'business_hours'
    | 'ratings'
    | 'reviews'
    | 'social_media'
    | 'categories'
    | 'contact_info'
    | 'address'
    | 'website'; 
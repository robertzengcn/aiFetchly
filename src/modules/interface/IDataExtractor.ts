import { ElementHandle } from 'puppeteer';

/**
 * Data extraction strategy interface that defines methods for extracting specific data fields
 * from web page elements.
 * 
 * This interface allows for different extraction strategies and provides a standardized
 * way to extract business information from various HTML structures. It supports both
 * simple text extraction and complex structured data extraction.
 * 
 * @example
 * ```typescript
 * const extractor = new DefaultDataExtractor();
 * const businessName = await extractor.extractBusinessName(element);
 * const phone = await extractor.extractPhoneNumber(element);
 * const validation = extractor.validateExtractedData(data);
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface IDataExtractor {
    /**
     * Extract business name from an element
     * @param element - DOM element containing business information
     * @returns Promise resolving to business name string
     */
    extractBusinessName(element: ElementHandle<Element>): Promise<string>;

    /**
     * Extract phone number from an element
     * @param element - DOM element containing phone information
     * @returns Promise resolving to phone number string
     */
    extractPhoneNumber(element: ElementHandle<Element>): Promise<string>;

    /**
     * Extract email address from an element
     * @param element - DOM element containing email information
     * @returns Promise resolving to email string or null if not found
     */
    extractEmail(element: ElementHandle<Element>): Promise<string | null>;

    /**
     * Extract website URL from an element
     * @param element - DOM element containing website information
     * @returns Promise resolving to website URL string or null if not found
     */
    extractWebsite(element: ElementHandle<Element>): Promise<string | null>;

    /**
     * Extract address information from an element
     * @param element - DOM element containing address information
     * @returns Promise resolving to structured address object
     */
    extractAddress(element: ElementHandle<Element>): Promise<Address>;

    /**
     * Extract social media links from an element
     * @param element - DOM element containing social media information
     * @returns Promise resolving to array of social media URLs
     */
    extractSocialMedia(element: ElementHandle<Element>): Promise<string[]>;

    /**
     * Extract business categories from an element
     * @param element - DOM element containing category information
     * @returns Promise resolving to array of category strings
     */
    extractCategories(element: ElementHandle<Element>): Promise<string[]>;

    /**
     * Extract business hours from an element
     * @param element - DOM element containing hours information
     * @returns Promise resolving to business hours object or null if not found
     */
    extractBusinessHours(element: ElementHandle<Element>): Promise<BusinessHours | null>;

    /**
     * Extract rating information from an element
     * @param element - DOM element containing rating information
     * @returns Promise resolving to rating object or null if not found
     */
    extractRating(element: ElementHandle<Element>): Promise<Rating | null>;

    /**
     * Validate extracted data for completeness and accuracy
     * @param data - Business data to validate
     * @returns Validation result with success status and any errors
     */
    validateExtractedData(data: BusinessData): ValidationResult;

    /**
     * Sanitize and clean extracted data
     * @param data - Raw business data to sanitize
     * @returns Cleaned business data
     */
    sanitizeData(data: BusinessData): BusinessData;
}

/**
 * Address structure
 */
export interface Address {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    formatted?: string;
}

/**
 * Business hours structure
 */
export interface BusinessHours {
    monday?: DayHours;
    tuesday?: DayHours;
    wednesday?: DayHours;
    thursday?: DayHours;
    friday?: DayHours;
    saturday?: DayHours;
    sunday?: DayHours;
    special_hours?: string;
}

/**
 * Day hours structure
 */
export interface DayHours {
    open: string;
    close: string;
    closed?: boolean;
    hours?: string;
}

/**
 * Rating structure
 */
export interface Rating {
    score: number;
    max_score: number;
    review_count: number;
    rating_text?: string;
}

/**
 * Business data structure
 */
export interface BusinessData {
    business_name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: Address;
    social_media?: string[];
    categories?: string[];
    business_hours?: BusinessHours;
    description?: string;
    rating?: Rating;
    raw_data?: object;
    fax_number?: string;
    contact_person?: string;
    year_established?: number;
    number_of_employees?: string;
    payment_methods?: string[];
    specialties?: string[];
}

/**
 * Validation result structure
 */
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    completeness: number; // Percentage of completeness (0-100)
}

/**
 * Validation error structure
 */
export interface ValidationError {
    field: string;
    message: string;
    severity: 'error' | 'warning';
}

/**
 * Validation warning structure
 */
export interface ValidationWarning {
    field: string;
    message: string;
    suggestion?: string;
} 
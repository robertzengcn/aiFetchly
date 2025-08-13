/**
 * Core platform configuration interface that defines the structure for platform configurations.
 * This interface supports configuration-only, class-based, and hybrid platform approaches.
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface PlatformConfig {
    /** Unique identifier for the platform */
    id: string;
    
    /** Display name for the platform */
    name: string;
    
    /** Human-readable display name */
    display_name: string;
    
    /** Base URL for the platform */
    base_url: string;
    
    /** Country where the platform operates */
    country: string;
    
    /** Language used by the platform */
    language: string;
    
    /** Whether the platform is active */
    is_active: boolean;
    
    /** Version of the platform configuration */
    version: string;
    
    /** Rate limiting configuration */
    rate_limit: number; // requests per hour
    
    /** Delay between requests in milliseconds */
    delay_between_requests: number;
    
    /** Maximum concurrent requests allowed */
    max_concurrent_requests: number;
    
    /** CSS selectors for data extraction */
    selectors?: PlatformSelectors;
    
    /** Custom extraction functions (for hybrid platforms) */
    custom_extractors?: {
        [key: string]: string; // function name -> module path
    };
    
    /** Platform type: configuration, class, or hybrid */
    type: 'configuration' | 'class' | 'hybrid';
    
    /** Class name for class-based platforms */
    class_name?: string;
    
    /** Module path for class-based platforms */
    module_path?: string;
    
    /** Platform-specific settings */
    settings?: PlatformSettings;
    
    /** Platform metadata */
    metadata?: PlatformMetadata;
    
    /** Platform description */
    description?: string;
    
    /** Platform maintainer */
    maintainer?: string;
    
    /** Documentation URL */
    documentation?: string;
}

/**
 * Platform selectors for data extraction
 */
export type SelectorValue =
    | string
    | {
          /** Selector for next button */
          nextButton?: string;
          /** Selector for current page indicator */
          currentPage?: string;
          /** Selector for max pages indicator */
          maxPages?: string;
      };

export interface PlatformSelectors {
    /** Selector for business list container */
    businessList: string;

    /** Selector for business name */
    businessName: string;

    /** Selector for phone number */
    phone?: string;

    /** Selector for email address */
    email?: string;

    /** Selector for website URL */
    website?: string;

    /** Selector for address */
    address?: string;

    /** Selector for address city */
    address_city?: string;

    /** Selector for address state */
    address_state?: string;

    /** Selector for address zip */
    address_zip?: string;

    /** Selector for address country */
    address_country?: string;

    /** Selector for social media links */
    socialMedia?: string;

    /** Selector for business categories */
    categories?: string;

    /** Selector for business hours */
    businessHours?: string;

    /** Selector for business description */
    description?: string;

    /** Selector for rating */
    rating?: string;

    /** Selector for review count */
    reviewCount?: string;

    /** Selector for fax number */
    faxNumber?: string;

    /** Selector for contact person */
    contactPerson?: string;

    /** Selector for year established */
    yearEstablished?: string;

    /** Selector for number of employees */
    numberOfEmployees?: string;

    /** Selector for payment methods */
    paymentMethods?: string;

    /** Selector for specialties */
    specialties?: string;

    /** Pagination selectors */
    pagination?: {
        /** Selector for next button */
        nextButton?: string;

        /** Selector for current page indicator */
        currentPage?: string;

        /** Selector for max pages indicator */
        maxPages?: string;
    };

    /** Allow platform-specific extra selectors without weakening types */
    [key: string]: SelectorValue | undefined;
}

/**
 * Platform-specific settings
 */
export interface PlatformSettings {
    /** Whether the platform requires authentication */
    requiresAuthentication: boolean;
    
    /** Whether the platform supports proxy */
    supportsProxy: boolean;
    
    /** Whether the platform supports cookies */
    supportsCookies: boolean;
    
    /** Search URL pattern with placeholders */
    searchUrlPattern: string;
    
    /** Result URL pattern with placeholders */
    resultUrlPattern: string;
    
    /** Optional pagination URL pattern for sites using page segments */
    paginationUrlPattern?: string;
    
    /** Supported platform features */
    supportedFeatures?: PlatformFeature[];
    
    /** Custom settings specific to the platform */
    custom?: Record<string, unknown>;
    
    /** Optional pagination offset value for sites using offsets */
    paginationOffset?: number;
}

/**
 * Platform metadata
 */
export interface PlatformMetadata {
    /** Last updated timestamp */
    lastUpdated: Date;
    
    /** Platform version */
    version: string;
    
    /** Platform category */
    category?: string;
    
    /** Optional priority indicator */
    priority?: 'low' | 'medium' | 'high';
    
    /** Platform tags */
    tags?: string[];
    
    /** Platform statistics */
    statistics?: {
        totalBusinesses?: number;
        lastScraped?: Date;
        successRate?: number;
    };
}

/**
 * Platform features enumeration
 */
export enum PlatformFeature {
    SEARCH = 'search',
    PAGINATION = 'pagination',
    DETAILED_EXTRACTION = 'detailed_extraction',
    AUTHENTICATION = 'authentication',
    PROXY = 'proxy',
    COOKIES = 'cookies',
    RATINGS = 'ratings',
    REVIEWS = 'reviews',
    BUSINESS_HOURS = 'business_hours',
    SOCIAL_MEDIA = 'social_media',
    CATEGORIES = 'categories',
    MAPS = 'maps',
    PHOTOS = 'photos'
}

/**
 * Platform type enumeration
 */
export enum PlatformType {
    CONFIGURATION = 'configuration',
    CLASS = 'class',
    HYBRID = 'hybrid'
}

/**
 * Platform status enumeration
 */
export enum PlatformStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    MAINTENANCE = 'maintenance',
    DEPRECATED = 'deprecated'
} 
/**
 * Core platform configuration interface that defines the structure for platform configurations.
 * This interface supports configuration-only, class-based, and hybrid platform approaches.
 * 
 * @example
 * ```typescript
 * const yellowPagesConfig: PlatformConfig = {
 *   id: 'yellowpages',
 *   name: 'yellowpages',
 *   display_name: 'Yellow Pages',
 *   base_url: 'https://www.yellowpages.com',
 *   country: 'US',
 *   language: 'en',
 *   is_active: true,
 *   version: '1.0.0',
 *   rate_limit: 1000,
 *   delay_between_requests: 1000,
 *   max_concurrent_requests: 1,
 *   type: 'configuration',
 *   selectors: {
 *     // Business data extraction
 *     businessList: '.result',
 *     businessName: '.business-name',
 *     phone: '.phone',
 *     email: '.email',
 *     website: '.website',
 *     address: '.address',
 *     address_city: '.city',
 *     address_state: '.state',
 *     address_zip: '.zip',
 *     categories: '.categories',
 *     rating: '.rating',
 *     reviewCount: '.review-count',
 *     
 *     // Search form elements
 *     searchForm: {
 *       keywordInput: '#searchTerms',
 *       locationInput: '#location',
 *       searchButton: '.search-button',
 *       formContainer: '.search-form'
 *     },
 *     
 *     // Pagination navigation
 *     pagination: {
 *       nextButton: '.pagination .next',
 *       previousButton: '.pagination .prev',
 *       currentPage: '.pagination .current',
 *       maxPages: '.pagination .total',
 *       pageNumbers: '.pagination a[href*="page"]',
 *       container: '.pagination'
 *     }
 *   }
 * };
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';

export interface PlatformConfig<T extends BasePlatformAdapter = BasePlatformAdapter> {
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
    
    /** Module path for class-based platforms (legacy support) */
    module_path?: string;
    
    /** Direct class reference for immediate instantiation (recommended) */
    adapter_class?: new (config: PlatformConfig<T>) => T;
    
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
    
    /** Whether the platform requires a location for search */
    locationRequired?: boolean;
}

/**
 * Simplified platform data for listing available platforms
 */
export interface PlatformSummary {
    /** Unique identifier for the platform */
    id: string;
    
    /** Display name for the platform */
    name: string;
    
    /** Human-readable display name */
    display_name: string;
    
    /** Country where the platform operates */
    country: string;
    
    /** Language used by the platform */
    language: string;
    
    /** Rate limiting configuration (requests per hour) */
    rate_limit: number;
    
    /** Whether the platform is active */
    is_active: boolean;
    
    /** Authentication requirements */
    authentication?: {
        /** Whether the platform requires authentication */
        requiresAuthentication?: boolean;
        
        /** Whether cookies are required for authentication */
        requiresCookies?: boolean;
        
        /** Whether user login is required */
        requiresLogin?: boolean;
        
        /** Whether API key is required */
        requiresApiKey?: boolean;
        
        /** Whether OAuth authentication is required */
        requiresOAuth?: boolean;
        
        /** Type of authentication required */
        type?: 'login' | 'api_key' | 'oauth' | 'session' | 'cookie' | 'none';
    };
    
    /** Whether the platform requires a location for search */
    locationRequired?: boolean;
}

/**
 * Platform selectors for data extraction
 * 
 * @example
 * ```typescript
 * // Simple string selector
 * businessName: '.business-name'
 * 
 * // Search form selectors
 * searchForm: {
 *   keywordInput: '#searchTerms',
 *   locationInput: '#location', 
 *   searchButton: '.search-button',
 *   formContainer: '.search-form'
 * }
 * 
 * // Pagination selectors
 * pagination: {
 *   nextButton: '.pagination .next',
 *   currentPage: '.pagination .current',
 *   maxPages: '.pagination .total'
 * }
 * 
 * // Complex nested selectors
 * hours: {
 *   container: '.hours-container',
 *   day: '.day-label',
 *   time: '.time-range'
 * }
 * ```
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
      }
    | {
          /** Selector for keyword input field */
          keywordInput?: string;
          
          /** Selector for location input field */
          locationInput?: string;
          
          /** Selector for search button */
          searchButton?: string;
          
          /** Selector for search form container */
          formContainer?: string;
          
          /** Selector for category/industry dropdown (if applicable) */
          categoryDropdown?: string;
          
          /** Selector for radius/distance dropdown (if applicable) */
          radiusDropdown?: string;
      }
    | {
          /** Selector for next button */
          nextButton?: string;
          /** Selector for current page indicator */
          currentPage?: string;
          /** Selector for max pages indicator */
          maxPages?: string;
          
          /** Selector for previous button */
          previousButton?: string;
          
          /** Selector for page number links */
          pageNumbers?: string;
          
          /** Selector for pagination container */
          container?: string;
      }
    | {
          /** Selector for hours container */
          container?: string;
          /** Selector for day labels */
          day?: string;
          /** Selector for time ranges */
          time?: string;
          /** Selector for open/closed status */
          status?: string;
      }
    | {
          /** Selector for review container */
          container?: string;
          /** Selector for review text */
          text?: string;
          /** Selector for review author */
          author?: string;
          /** Selector for review date */
          date?: string;
          /** Selector for review rating */
          rating?: string;
      }
    | {
          /** Selector for the link/button to navigate to detail page */
          detailLink?: string;
          /** Alternative selectors if primary fails */
          alternatives?: string[];
          /** Whether navigation is required for full data extraction */
          required?: boolean;
          /** Delay after navigation (ms) */
          delayAfterNavigation?: number;
          /** Selectors specific to detail page */
          detailPage?: {
              /** Business name on detail page (might be different from listing) */
              businessName?: string;
              /** Full address on detail page */
              fullAddress?: string;
              /** Detailed business hours */
              businessHours?: string;
              /** Complete description */
              description?: string;
              /** Contact information */
              contactInfo?: string;
              /** Services offered */
              services?: string;
              /** Photos/gallery */
              photos?: string;
              /** Map/location widget */
              map?: string;
              /** Additional phone numbers */
              additionalPhone?: string;
              /** Additional email addresses */
              additionalEmail?: string;
              /** Social media links */
              socialMedia?: string;
              /** Business categories */
              categories?: string;
              /** Year established */
              yearEstablished?: string;
              /** Number of employees */
              numberOfEmployees?: string;
              /** Payment methods */
              paymentMethods?: string;
              /** Business specialties */
              specialties?: string;
              /** Website URL on detail page */
              website?: string;
          };
      };

export interface PlatformSelectors {
    /** Selector for business list container */
    businessList: string;

    /** Selector for business item container */
    businessItem?: string;

    /** Selector for business name */
    businessName: string;

    /** Selector for detail page link */
    detailPageLink?: string;

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

    /** Selector for business logo/image */
    logo?: string;

    /** Selector for business photos */
    photos?: string;

    /** Selector for business image */
    businessImage?: string;

    /** Selector for business URL */
    businessUrl?: string;

    /** Selector for map/location widget */
    map?: string;

    /** Selector for business status (open/closed) */
    status?: string;

    /** Selector for price range indicators */
    priceRange?: string;

    /** Selector for business certifications */
    certifications?: string;

    /** Selector for business licenses */
    licenses?: string;

    /** Selector for insurance information */
    insurance?: string;

    /** Selector for business associations */
    associations?: string;

    /** Selector for awards/recognition */
    awards?: string;

    /** Selector for business hours (detailed) */
    hours?: {
        /** Selector for hours container */
        container?: string;
        /** Selector for day labels */
        day?: string;
        /** Selector for time ranges */
        time?: string;
        /** Selector for open/closed status */
        status?: string;
    };

    /** Selector for business services */
    services?: string;

    /** Selector for business products */
    products?: string;

    /** Selector for business team/staff */
    team?: string;

    /** Selector for business testimonials */
    testimonials?: string;

    /** Selector for business reviews */
    reviews?: {
        /** Selector for review container */
        container?: string;
        /** Selector for review text */
        text?: string;
        /** Selector for review author */
        author?: string;
        /** Selector for review date */
        date?: string;
        /** Selector for review rating */
        rating?: string;
    };

    /** Selector for business events */
    events?: string;

    /** Selector for business news/updates */
    news?: string;

    /** Selector for business blog */
    blog?: string;

    /** Selector for business gallery */
    gallery?: string;

    /** Selector for business videos */
    videos?: string;

    /** Selector for business contact form */
    contactForm?: string;

    /** Selector for business appointment booking */
    appointmentBooking?: string;

    /** Selector for business online ordering */
    onlineOrdering?: string;

    /** Selector for business payment options */
    paymentOptions?: string;

    /** Selector for business accessibility features */
    accessibility?: string;

    /** Selector for business parking information */
    parking?: string;

    /** Selector for business WiFi availability */
    wifi?: string;

    /** Selector for business pet policy */
    petPolicy?: string;

    /** Selector for business smoking policy */
    smokingPolicy?: string;

    /** Selector for business dress code */
    dressCode?: string;

    /** Selector for business age restrictions */
    ageRestrictions?: string;

    /** Search form selectors */
    searchForm?: SelectorValue;

    /** Pagination selectors */
    pagination?: SelectorValue;

    /** Navigation selectors for detail page extraction */
    navigation?: {
        /** Selector for the link/button to navigate to detail page */
        detailLink?: string;
        /** Alternative selectors if primary fails */
        alternatives?: string[];
        /** Whether navigation is required for full data extraction */
        required?: boolean;
        /** Delay after navigation (ms) */
        delayAfterNavigation?: number;
        /** Selectors specific to detail page */
        detailPage?: {
            /** Business name on detail page (might be different from listing) */
            businessName?: string;
            /** Full address on detail page */
            fullAddress?: string;
            /** Detailed business hours */
            businessHours?: string;
            /** Complete description */
            description?: string;
            /** Contact information */
            contactInfo?: string;
            /** Services offered */
            services?: string;
            /** Photos/gallery */
            photos?: string;
            /** Map/location widget */
            map?: string;
            /** Additional phone numbers */
            additionalPhone?: string;
            /** Additional email addresses */
            additionalEmail?: string;
            /** Social media links */
            socialMedia?: string;
            /** Business categories */
            categories?: string;
            /** Year established */
            yearEstablished?: string;
            /** Number of employees */
            numberOfEmployees?: string;
            /** Payment methods */
            paymentMethods?: string;
            /** Business specialties */
            specialties?: string;
            /** Website URL on detail page */
            website?: string;
        };
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
    
    /** Authentication configuration details */
    authentication?: {
        /** Type of authentication required */
        type?: 'login' | 'api_key' | 'oauth' | 'session' | 'cookie' | 'none';
        
        /** Whether user login is required */
        requiresLogin?: boolean;
        
        /** Whether API key is required */
        requiresApiKey?: boolean;
        
        /** Whether OAuth authentication is required */
        requiresOAuth?: boolean;
        
        /** Whether session-based authentication is required */
        // requiresSession: boolean;
        
        /** Whether cookies are required for authentication */
        requiresCookies?: boolean;
        
        /** URL for login page */
        loginUrl?: string;
        
        /** URL for logout page */
        logoutUrl?: string;
        
        /** Selectors for login form elements */
        loginForm?: {
            usernameInput?: string;
            passwordInput?: string;
            emailInput?: string;
            loginButton?: string;
            formContainer?: string;
            captchaSelector?: string;
            rememberMeCheckbox?: string;
        };
        
        /** Selectors for authentication status checks */
        authStatus?: {
            loggedInIndicator?: string;
            loggedOutIndicator?: string;
            userMenuSelector?: string;
            profileLinkSelector?: string;
        };
        
        /** Required credential fields */
        requiredCredentials?: string[];
        
        /** Whether authentication persists across sessions */
        persistentAuth?: boolean;
        
        /** Authentication timeout in milliseconds */
        authTimeout?: number;
        
        /** Whether re-authentication is required after certain actions */
        requiresReauth?: boolean;
        
        /** Rate limiting for authentication attempts */
        authRateLimit?: number;
    };
    
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
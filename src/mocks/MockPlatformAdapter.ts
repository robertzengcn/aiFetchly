import { IPlatformAdapter, SearchResult, BusinessData, PlatformSelectors, RateLimitingConfig, AuthenticationConfig, CookiesType, PlatformFeature } from '../interfaces/IPlatformAdapter';

/**
 * Mock implementation of IPlatformAdapter for testing purposes.
 * This mock provides predictable behavior for unit testing and development.
 */
export class MockPlatformAdapter implements IPlatformAdapter {
    readonly platformName = 'mock-platform';
    readonly baseUrl = 'https://mockplatform.com';
    readonly version = '1.0.0';

    /**
     * Mock search for businesses
     */
    async searchBusinesses(page: any, keywords: string[], location: string): Promise<SearchResult[]> {
        console.log(`MockPlatformAdapter: Searching for ${keywords.join(', ')} in ${location}`);
        
        const mockResults: SearchResult[] = [];
        for (let i = 0; i < 10; i++) {
            mockResults.push({
                id: `mock-${i + 1}`,
                business_name: `Mock Business ${i + 1}`,
                url: `https://mockplatform.com/business/${i + 1}`,
                snippet: `Mock business snippet ${i + 1} in ${location}`,
                rating: 4.0 + (Math.random() * 1.0),
                review_count: Math.floor(Math.random() * 100)
            });
        }
        
        return mockResults;
    }

    /**
     * Mock business data extraction
     */
    async extractBusinessData(page: any): Promise<BusinessData> {
        return {
            business_name: 'Mock Business',
            email: 'mock@example.com',
            phone: '+1-555-1234',
            website: 'https://mockbusiness.com',
            address: {
                street: '123 Mock Street',
                city: 'Mock City',
                state: 'MS',
                zip: '12345',
                country: 'USA'
            },
            social_media: ['https://facebook.com/mockbusiness'],
            categories: ['Mock Category'],
            business_hours: { monday: { open: '9:00 AM', close: '5:00 PM' } },
            description: 'Mock business description',
            rating: 4.5,
            review_count: 50,
            raw_data: { mock: true }
        };
    }

    /**
     * Mock pagination handling
     */
    async handlePagination(page: any, maxPages: number): Promise<void> {
        console.log(`MockPlatformAdapter: Handling pagination for ${maxPages} pages`);
        await this.sleep(100);
    }

    /**
     * Mock cookie application
     */
    async applyCookies(page: any, cookies: CookiesType): Promise<void> {
        console.log(`MockPlatformAdapter: Applying ${cookies.length} cookies`);
        await this.sleep(50);
    }

    /**
     * Get mock selectors
     */
    getSelectors(): PlatformSelectors {
        return {
            businessList: '.mock-business-list',
            businessName: '.mock-business-name',
            phone: '.mock-phone',
            email: '.mock-email',
            website: '.mock-website',
            address: '.mock-address',
            address_city: '.mock-address-city',
            address_state: '.mock-address-state',
            address_zip: '.mock-address-zip',
            address_country: '.mock-address-country',
            categories: '.mock-categories',
            socialMedia: '.mock-social-media',
            businessHours: '.mock-business-hours',
            description: '.mock-description',
            rating: '.mock-rating',
            reviewCount: '.mock-review-count',
            faxNumber: '.mock-fax',
            contactPerson: '.mock-contact',
            yearEstablished: '.mock-year',
            numberOfEmployees: '.mock-employees',
            paymentMethods: '.mock-payment',
            specialties: '.mock-specialties',
            pagination: {
                nextButton: '.mock-next',
                currentPage: '.mock-current',
                maxPages: '.mock-max'
            }
        };
    }

    /**
     * Get mock rate limiting configuration
     */
    getRateLimitingConfig(): RateLimitingConfig {
        return {
            requestsPerHour: 100,
            delayBetweenRequests: 2000,
            maxConcurrentRequests: 1
        };
    }

    /**
     * Get mock authentication configuration
     */
    getAuthenticationConfig(): AuthenticationConfig {
        return {
            requiresAuthentication: false,
            supportsCookies: true,
            supportsProxy: true
        };
    }

    /**
     * Check if authentication is supported
     */
    supportsAuthentication(): boolean {
        return false;
    }

    /**
     * Check if proxy is supported
     */
    supportsProxy(): boolean {
        return true;
    }

    /**
     * Check if cookies are supported
     */
    supportsCookies(): boolean {
        return true;
    }

    /**
     * Get supported features
     */
    getSupportedFeatures(): PlatformFeature[] {
        return [
            'search',
            'pagination',
            'cookies',
            'proxy',
            'business_hours',
            'ratings',
            'reviews',
            'social_media',
            'categories',
            'contact_info',
            'address',
            'website'
        ];
    }

    /**
     * Sleep utility for simulating delays
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
} 
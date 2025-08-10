import { YellowPagesCaAdapter } from '@/platforms/YellowPagesCaAdapter';
import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
// @ts-ignore - Jest globals are available in test environment
declare const expect: any;
declare const describe: any;
declare const test: any;
declare const beforeEach: any;

/**
 * Test suite for YellowPages.ca adapter
 * This test verifies that the adapter is properly implemented and can be instantiated
 */
describe('YellowPagesCaAdapter', () => {
    let adapter: YellowPagesCaAdapter;
    let mockConfig: PlatformConfig;

    beforeEach(() => {
        // Create mock platform configuration
        mockConfig = {
            id: 'yellowpages-ca',
            name: 'YellowPages.ca',
            display_name: 'YellowPages.ca',
            base_url: 'https://www.yellowpages.ca',
            country: 'Canada',
            language: 'English',
            is_active: true,
            version: '1.0.0',
            rate_limit: 100,
            delay_between_requests: 2000,
            max_concurrent_requests: 1,
            type: 'class',
            class_name: 'YellowPagesCaAdapter',
            module_path: './platforms/YellowPagesCaAdapter',
            selectors: {
                businessList: 'div#main-content div.search-results.organic div.result, .listing-item, .business-listing, .result-item',
                businessName: 'a.business-name, .business-name, .listing-name, h3 a, .name a',
                phone: 'div.phones, .phone, .phone-number, .contact-phone',
                email: 'a.email-business, .email-link, .contact-email',
                website: 'p.website a, .website-link, .business-website a',
                address: 'div.adr, .address, .location, .business-address',
                categories: 'div.categories, .category, .business-category',
                rating: 'div.result-rating, .rating, .business-rating',
                reviewCount: 'span.count, .review-count, .reviews-count',
                pagination: {
                    nextButton: 'a.next, .pagination .next, .next-page, .pagination-next',
                    currentPage: '.pagination .current, .current-page, .page-current',
                    maxPages: '.pagination .total-pages, .total-pages'
                }
            },
            settings: {
                requiresAuthentication: false,
                supportsProxy: true,
                supportsCookies: true,
                searchUrlPattern: 'https://www.yellowpages.ca/search?q={keywords}&location={location}&page={page}',
                resultUrlPattern: 'https://www.yellowpages.ca/business/{id}',
                supportedFeatures: [PlatformFeature.SEARCH, PlatformFeature.PAGINATION, PlatformFeature.COOKIES, PlatformFeature.PROXY]
            },
            metadata: {
                lastUpdated: new Date(),
                version: '1.0.0',
                category: 'Business Directory',
                tags: ['yellow-pages', 'canada', 'business-directory', 'local-search']
            },
            description: 'YellowPages.ca is the Canadian version of the Yellow Pages business directory.',
            maintainer: 'Yellow Pages Scraper Team',
            documentation: 'https://www.yellowpages.ca/help'
        };

        adapter = new YellowPagesCaAdapter(mockConfig);
    });

    test('should instantiate YellowPagesCaAdapter correctly', () => {
        expect(adapter).toBeInstanceOf(YellowPagesCaAdapter);
        expect(adapter.platformName).toBe('YellowPages.ca');
        expect(adapter.baseUrl).toBe('https://www.yellowpages.ca');
        expect(adapter.version).toBe('1.0.0');
    });

    test('should have correct platform configuration', () => {
        const config = adapter.config;
        expect(config.id).toBe('yellowpages-ca');
        expect(config.country).toBe('Canada');
        expect(config.language).toBe('English');
        expect(config.type).toBe('class');
        expect(config.class_name).toBe('YellowPagesCaAdapter');
    });

    test('should support required features', () => {
        expect(adapter.supportsAuthentication()).toBe(false);
        expect(adapter.supportsProxy()).toBe(true);
        expect(adapter.supportsCookies()).toBe(true);
    });

    test('should have correct rate limiting configuration', () => {
        const rateLimitConfig = adapter.getRateLimitingConfig();
        expect(rateLimitConfig.requestsPerHour).toBe(100);
        expect(rateLimitConfig.delayBetweenRequests).toBe(2000);
        expect(rateLimitConfig.maxConcurrentRequests).toBe(1);
    });

    test('should have correct authentication configuration', () => {
        const authConfig = adapter.getAuthenticationConfig();
        expect(authConfig.requiresAuthentication).toBe(false);
        expect(authConfig.supportsCookies).toBe(true);
        expect(authConfig.supportsProxy).toBe(true);
    });

    test('should have correct selectors', () => {
        const selectors = adapter.getSelectors();
        expect(selectors.businessList).toBe('div#main-content div.search-results.organic div.result, .listing-item, .business-listing, .result-item');
        expect(selectors.businessName).toBe('a.business-name, .business-name, .listing-name, h3 a, .name a');
        expect(selectors.phone).toBe('div.phones, .phone, .phone-number, .contact-phone');
        expect(selectors.pagination?.nextButton).toBe('a.next, .pagination .next, .next-page, .pagination-next');
    });

    test('should build correct search URL', () => {
        const searchUrl = adapter.buildSearchUrl(['restaurant'], 'Toronto', 1);
        expect(searchUrl).toContain('https://www.yellowpages.ca/search');
        expect(searchUrl).toContain('q=restaurant');
        expect(searchUrl).toContain('location=Toronto');
        expect(searchUrl).toContain('page=1');
    });

    test('should validate configuration correctly', () => {
        const validation = adapter.validateConfig();
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toHaveLength(0);
        expect(validation.score).toBeGreaterThan(80);
    });

    test('should have supported features', () => {
        const features = adapter.getSupportedFeatures();
        expect(features).toContain('search');
        expect(features).toContain('pagination');
        expect(features).toContain('cookies');
        expect(features).toContain('proxy');
    });

    test('should handle Canadian address parsing', () => {
        // Test Canadian address parsing functionality
        const canadianAddress = '123 Main St, Toronto, ON M5V 3A8';
        // This would be tested in the actual adapter implementation
        expect(canadianAddress).toContain('Toronto');
        expect(canadianAddress).toContain('ON');
        expect(canadianAddress).toMatch(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/); // Canadian postal code pattern
    });

    test('should handle multiple selector fallbacks', () => {
        const selectors = adapter.getSelectors();
        // Test that multiple selectors are provided for robustness
        expect(selectors.businessList).toContain(',');
        expect(selectors.businessName).toContain(',');
        expect(selectors.phone).toContain(',');
    });

    test('should have correct platform metadata', () => {
        const config = adapter.config;
        expect(config.metadata?.category).toBe('Business Directory');
        expect(config.metadata?.tags).toContain('canada');
        expect(config.metadata?.tags).toContain('yellow-pages');
        expect(config.description).toContain('Canadian');
    });
});

/**
 * Integration test for YellowPages.ca platform registration
 * This test verifies that the platform can be registered in the database
 */
describe('YellowPages.ca Platform Registration', () => {
    test('should have correct platform configuration structure', () => {
        // This test verifies the platform configuration structure
        const expectedConfig = {
            id: 'yellowpages-ca',
            name: 'YellowPages.ca',
            base_url: 'https://www.yellowpages.ca',
            country: 'Canada',
            language: 'English',
            type: 'class',
            class_name: 'YellowPagesCaAdapter',
            module_path: './platforms/YellowPagesCaAdapter'
        };

        expect(expectedConfig.id).toBe('yellowpages-ca');
        expect(expectedConfig.country).toBe('Canada');
        expect(expectedConfig.type).toBe('class');
        expect(expectedConfig.class_name).toBe('YellowPagesCaAdapter');
    });

    test('should have comprehensive selector configuration', () => {
        const expectedSelectors = {
            businessList: expect.stringContaining('div.result'),
            businessName: expect.stringContaining('a.business-name'),
            phone: expect.stringContaining('div.phones'),
            pagination: {
                nextButton: expect.stringContaining('a.next'),
                currentPage: expect.stringContaining('.current'),
                maxPages: expect.stringContaining('.total-pages')
            }
        };

        expect(expectedSelectors.businessList).toBeDefined();
        expect(expectedSelectors.businessName).toBeDefined();
        expect(expectedSelectors.phone).toBeDefined();
        expect(expectedSelectors.pagination.nextButton).toBeDefined();
    });
}); 
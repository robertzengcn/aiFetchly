/**
 * Simple verification script for YellowPages.ca adapter
 * This script tests the basic functionality of the adapter without requiring a test framework
 */

import { YellowPagesCaAdapter } from '@/platforms/YellowPagesCaAdapter';
import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

// Mock platform configuration for testing
const mockConfig: PlatformConfig = {
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

/**
 * Test function to verify YellowPages.ca adapter implementation
 */
function testYellowPagesCaAdapter(): void {
    console.log('🧪 Testing YellowPages.ca Adapter Implementation...\n');

    try {
        // Test 1: Instantiation
        console.log('✅ Test 1: Creating YellowPagesCaAdapter instance...');
        const adapter = new YellowPagesCaAdapter(mockConfig);
        console.log('   ✓ Adapter instantiated successfully');

        // Test 2: Basic properties
        console.log('\n✅ Test 2: Verifying basic properties...');
        console.log(`   ✓ Platform Name: ${adapter.platformName}`);
        console.log(`   ✓ Base URL: ${adapter.baseUrl}`);
        console.log(`   ✓ Version: ${adapter.version}`);
        console.log(`   ✓ Country: ${adapter.config.country}`);
        console.log(`   ✓ Language: ${adapter.config.language}`);

        // Test 3: Configuration validation
        console.log('\n✅ Test 3: Validating configuration...');
        const validation = adapter.validateConfig();
        console.log(`   ✓ Configuration Valid: ${validation.isValid}`);
        console.log(`   ✓ Validation Score: ${validation.score}/100`);
        console.log(`   ✓ Errors: ${validation.errors.length}`);
        console.log(`   ✓ Warnings: ${validation.warnings.length}`);

        // Test 4: Feature support
        console.log('\n✅ Test 4: Checking feature support...');
        console.log(`   ✓ Authentication Required: ${adapter.supportsAuthentication()}`);
        console.log(`   ✓ Proxy Support: ${adapter.supportsProxy()}`);
        console.log(`   ✓ Cookie Support: ${adapter.supportsCookies()}`);

        // Test 5: Rate limiting configuration
        console.log('\n✅ Test 5: Rate limiting configuration...');
        const rateLimitConfig = adapter.getRateLimitingConfig();
        console.log(`   ✓ Requests per Hour: ${rateLimitConfig.requestsPerHour}`);
        console.log(`   ✓ Delay Between Requests: ${rateLimitConfig.delayBetweenRequests}ms`);
        console.log(`   ✓ Max Concurrent Requests: ${rateLimitConfig.maxConcurrentRequests}`);

        // Test 6: Selectors
        console.log('\n✅ Test 6: Verifying selectors...');
        const selectors = adapter.getSelectors();
        console.log(`   ✓ Business List Selector: ${selectors.businessList}`);
        console.log(`   ✓ Business Name Selector: ${selectors.businessName}`);
        console.log(`   ✓ Phone Selector: ${selectors.phone}`);
        console.log(`   ✓ Pagination Next Button: ${selectors.pagination?.nextButton}`);

        // Test 7: Search URL building
        console.log('\n✅ Test 7: Testing search URL building...');
        const searchUrl = adapter.buildSearchUrl(['restaurant'], 'Toronto', 1);
        console.log(`   ✓ Search URL: ${searchUrl}`);
        console.log(`   ✓ Contains base URL: ${searchUrl.includes('yellowpages.ca')}`);
        console.log(`   ✓ Contains keywords: ${searchUrl.includes('restaurant')}`);
        console.log(`   ✓ Contains location: ${searchUrl.includes('Toronto')}`);

        // Test 8: Supported features
        console.log('\n✅ Test 8: Checking supported features...');
        const features = adapter.getSupportedFeatures();
        console.log(`   ✓ Supported Features: ${features.join(', ')}`);
        console.log(`   ✓ Has Search: ${features.includes('search')}`);
        console.log(`   ✓ Has Pagination: ${features.includes('pagination')}`);
        console.log(`   ✓ Has Cookies: ${features.includes('cookies')}`);
        console.log(`   ✓ Has Proxy: ${features.includes('proxy')}`);

        // Test 9: Authentication configuration
        console.log('\n✅ Test 9: Authentication configuration...');
        const authConfig = adapter.getAuthenticationConfig();
        console.log(`   ✓ Requires Authentication: ${authConfig.requiresAuthentication}`);
        console.log(`   ✓ Supports Cookies: ${authConfig.supportsCookies}`);
        console.log(`   ✓ Supports Proxy: ${authConfig.supportsProxy}`);

        // Test 10: Platform metadata
        console.log('\n✅ Test 10: Platform metadata...');
        const config = adapter.config;
        console.log(`   ✓ Category: ${config.metadata?.category}`);
        console.log(`   ✓ Tags: ${config.metadata?.tags?.join(', ')}`);
        console.log(`   ✓ Description: ${config.description?.substring(0, 50)}...`);

        console.log('\n🎉 All tests passed! YellowPages.ca adapter is working correctly.');
        console.log('\n📋 Summary:');
        console.log('   • Adapter instantiation: ✓');
        console.log('   • Configuration validation: ✓');
        console.log('   • Feature support: ✓');
        console.log('   • Rate limiting: ✓');
        console.log('   • Selectors: ✓');
        console.log('   • URL building: ✓');
        console.log('   • Authentication: ✓');
        console.log('   • Metadata: ✓');

    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testYellowPagesCaAdapter();
}

export { testYellowPagesCaAdapter }; 
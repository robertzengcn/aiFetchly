import { YellowPagesPlatformModel } from '@/model/YellowPagesPlatform.model';
import { Token } from '@/modules/token';
import { USERSDBPATH } from '@/config/usersetting';

/**
 * Script to register YellowPages.ca platform configuration
 * This script creates the platform configuration in the database
 */
async function registerYellowPagesCaPlatform() {
    try {
        console.log('Registering YellowPages.ca platform...');

        // Get database path
        const tokenService = new Token();
        const dbpath = tokenService.getValue(USERSDBPATH);
        
        if (!dbpath) {
            throw new Error('Database path not found');
        }

        // Create platform model
        const platformModel = new YellowPagesPlatformModel(dbpath);

        // Check if platform already exists
        const existingPlatform = await platformModel.getPlatformByName('yellowpages-ca');
        if (existingPlatform) {
            console.log('YellowPages.ca platform already exists, updating configuration...');
            
            // Update existing platform
            const updateResult = await platformModel.updatePlatform(existingPlatform.id, {
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
                    supportedFeatures: ['search', 'pagination', 'cookies', 'proxy']
                },
                metadata: {
                    lastUpdated: new Date(),
                    version: '1.0.0',
                    category: 'Business Directory',
                    tags: ['yellow-pages', 'canada', 'business-directory', 'local-search']
                },
                description: 'YellowPages.ca is the Canadian version of the Yellow Pages business directory. This platform provides business listings, contact information, and reviews for Canadian businesses.',
                maintainer: 'Yellow Pages Scraper Team',
                documentation: 'https://www.yellowpages.ca/help'
            });

            if (updateResult) {
                console.log('Successfully updated YellowPages.ca platform configuration');
            } else {
                throw new Error('Failed to update YellowPages.ca platform');
            }
        } else {
            // Create new platform
            const platformId = await platformModel.saveYellowPagesPlatform({
                name: 'yellowpages-ca',
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
                    supportedFeatures: ['search', 'pagination', 'cookies', 'proxy']
                },
                metadata: {
                    lastUpdated: new Date(),
                    version: '1.0.0',
                    category: 'Business Directory',
                    tags: ['yellow-pages', 'canada', 'business-directory', 'local-search']
                },
                description: 'YellowPages.ca is the Canadian version of the Yellow Pages business directory. This platform provides business listings, contact information, and reviews for Canadian businesses.',
                maintainer: 'Yellow Pages Scraper Team',
                documentation: 'https://www.yellowpages.ca/help'
            });

            console.log(`Successfully created YellowPages.ca platform with ID: ${platformId}`);
        }

        console.log('YellowPages.ca platform registration completed successfully');

    } catch (error) {
        console.error('Error registering YellowPages.ca platform:', error);
        throw error;
    }
}

// Export for use in other modules
export { registerYellowPagesCaPlatform };

// If this script is run directly
if (require.main === module) {
    registerYellowPagesCaPlatform()
        .then(() => {
            console.log('YellowPages.ca platform registration script completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('YellowPages.ca platform registration script failed:', error);
            process.exit(1);
        });
} 
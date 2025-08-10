import { YellowPagesPlatformModel } from '@/model/YellowPagesPlatform.model';
import { Token } from '@/modules/token';
import { USERSDBPATH } from '@/config/usersetting';

/**
 * Script to register 11880.com platform configuration
 * This script creates the platform configuration in the database
 */
async function register11880DePlatform() {
    try {
        console.log('Registering 11880.com platform...');

        // Get database path
        const tokenService = new Token();
        const dbpath = tokenService.getValue(USERSDBPATH);
        
        if (!dbpath) {
            throw new Error('Database path not found');
        }

        // Create platform model
        const platformModel = new YellowPagesPlatformModel(dbpath);

        // Check if platform already exists
        const existingPlatform = await platformModel.getPlatformByName('11880-de');
        
        if (existingPlatform) {
            console.log('11880.com platform already exists, updating configuration...');
            
            // Update existing platform
            const updateResult = await platformModel.updatePlatform(existingPlatform.id, {
                display_name: '11880.com',
                base_url: 'https://www.11880.com',
                country: 'Germany',
                language: 'German',
                is_active: true,
                version: '1.0.0',
                rate_limit: 100,
                delay_between_requests: 2000,
                max_concurrent_requests: 1,
                type: 'configuration',
                selectors: {
                    businessList: 'div.search-results-body',
                    businessItem: 'article.search-result-entry',
                    businessName: 'h2.name a',
                    phone: 'div.phone-number a',
                    email: 'div.email a, a[data-track-event="vcard_email"]',
                    website: 'div.homepage a',
                    address: 'div.address',
                    address_city: 'div.address',
                    address_state: 'div.address',
                    address_zip: 'div.address',
                    address_country: 'div.address',
                    categories: 'div.categories',
                    rating: '.rating, .stars, .business-rating',
                    reviewCount: '.review-count, .reviews-count',
                    description: '.description, .business-description',
                    detailPageLink: 'h2.name a',
                    pagination: {
                        nextButton: 'li.page-item.next a',
                        currentPage: '.pagination .current, .current-page',
                        maxPages: '.pagination .total, .total-pages'
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://www.11880.com/suche/{keywords}/{location}',
                    paginationUrlPattern: '/seite-{page}',
                    resultUrlPattern: 'https://www.11880.com{path}',
                    supportedFeatures: ['search', 'pagination', 'detailed_extraction'],
                    antiScrapingMeasures: {
                        requiresStealthMode: true,
                        cookieConsentSelector: 'button[data-testid="uc-accept-all-button"]',
                        rateLimitDelay: 3000,
                        preScrapeSteps: [
                            {
                                action: 'click',
                                selector: 'button[data-testid="uc-accept-all-button"]',
                                description: 'Accept the Usercentrics cookie consent banner',
                                waitFor: 'networkidle0'
                            }
                        ]
                    }
                },
                metadata: {
                    lastUpdated: new Date(),
                    version: '1.0.0',
                    category: 'Business Directory',
                    tags: ['germany', 'business-directory', 'yellow-pages', 'phase-3'],
                    statistics: {
                        totalBusinesses: 0,
                        lastScraped: new Date(),
                        successRate: 0
                    }
                },
                description: '11880.com is a German business directory and search platform. This platform provides business listings, contact information, and reviews for German businesses.',
                maintainer: 'Platform Development Team',
                documentation: 'https://www.11880.com'
            });

            if (updateResult) {
                console.log('Successfully updated 11880.com platform configuration');
            } else {
                console.error('Failed to update 11880.com platform configuration');
            }
        } else {
            // Create new platform
            const platformId = await platformModel.saveYellowPagesPlatform({
                name: '11880-de',
                display_name: '11880.com',
                base_url: 'https://www.11880.com',
                country: 'Germany',
                language: 'German',
                is_active: true,
                version: '1.0.0',
                rate_limit: 100,
                delay_between_requests: 2000,
                max_concurrent_requests: 1,
                type: 'configuration',
                selectors: {
                    businessList: 'div.search-results-body',
                    businessItem: 'article.search-result-entry',
                    businessName: 'h2.name a',
                    phone: 'div.phone-number a',
                    email: 'div.email a, a[data-track-event="vcard_email"]',
                    website: 'div.homepage a',
                    address: 'div.address',
                    address_city: 'div.address',
                    address_state: 'div.address',
                    address_zip: 'div.address',
                    address_country: 'div.address',
                    categories: 'div.categories',
                    rating: '.rating, .stars, .business-rating',
                    reviewCount: '.review-count, .reviews-count',
                    description: '.description, .business-description',
                    detailPageLink: 'h2.name a',
                    pagination: {
                        nextButton: 'li.page-item.next a',
                        currentPage: '.pagination .current, .current-page',
                        maxPages: '.pagination .total, .total-pages'
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://www.11880.com/suche/{keywords}/{location}',
                    paginationUrlPattern: '/seite-{page}',
                    resultUrlPattern: 'https://www.11880.com{path}',
                    supportedFeatures: ['search', 'pagination', 'detailed_extraction'],
                    antiScrapingMeasures: {
                        requiresStealthMode: true,
                        cookieConsentSelector: 'button[data-testid="uc-accept-all-button"]',
                        rateLimitDelay: 3000,
                        preScrapeSteps: [
                            {
                                action: 'click',
                                selector: 'button[data-testid="uc-accept-all-button"]',
                                description: 'Accept the Usercentrics cookie consent banner',
                                waitFor: 'networkidle0'
                            }
                        ]
                    }
                },
                metadata: {
                    lastUpdated: new Date(),
                    version: '1.0.0',
                    category: 'Business Directory',
                    tags: ['germany', 'business-directory', 'yellow-pages', 'phase-3'],
                    statistics: {
                        totalBusinesses: 0,
                        lastScraped: new Date(),
                        successRate: 0
                    }
                },
                description: '11880.com is a German business directory and search platform. This platform provides business listings, contact information, and reviews for German businesses.',
                maintainer: 'Platform Development Team',
                documentation: 'https://www.11880.com'
            });

            console.log(`Successfully created 11880.com platform with ID: ${platformId}`);
        }

        console.log('11880.com platform registration completed successfully');

    } catch (error) {
        console.error('Error registering 11880.com platform:', error);
        throw error;
    }
}

// Export the function for use in other modules
export { register11880DePlatform };

// Run the registration if this script is executed directly
if (require.main === module) {
    register11880DePlatform()
        .then(() => {
            console.log('11880.com platform registration completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Failed to register 11880.com platform:', error);
            process.exit(1);
        });
}

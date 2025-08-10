import { YellowPagesPlatformModel } from '@/model/YellowPagesPlatform.model';
import { Token } from '@/modules/token';
import { USERSDBPATH } from '@/config/usersetting';

/**
 * Script to register GelbeSeiten.de platform configuration
 * This script creates the platform configuration in the database
 */
async function registerGelbeSeitenDePlatform() {
    try {
        console.log('Registering GelbeSeiten.de platform...');

        // Get database path
        const tokenService = new Token();
        const dbpath = tokenService.getValue(USERSDBPATH);
        
        if (!dbpath) {
            throw new Error('Database path not found');
        }

        // Create platform model
        const platformModel = new YellowPagesPlatformModel(dbpath);

        // Check if platform already exists
        const existingPlatform = await platformModel.getPlatformByName('gelbeseiten-de');
        
        if (existingPlatform) {
            console.log('GelbeSeiten.de platform already exists, updating configuration...');
            
            // Update existing platform
            const updateResult = await platformModel.updatePlatform(existingPlatform.id, {
                display_name: 'GelbeSeiten.de',
                base_url: 'https://www.gelbeseiten.de',
                country: 'Germany',
                language: 'German',
                is_active: true,
                version: '1.0.0',
                rate_limit: 100,
                delay_between_requests: 2000,
                max_concurrent_requests: 1,
                type: 'configuration',
                selectors: {
                    businessList: 'div#gs_treffer',
                    businessItem: 'article.mod.mod-Treffer',
                    businessName: 'h2[data-wipe-name="Titel"]',
                    phone: 'p.mod-Telefonnummer',
                    email: 'a[data-track-event="vcard_email"]',
                    website: 'a[data-track-event="vcard_website"]',
                    address: 'p.mod-Adresse',
                    address_city: 'p.mod-Adresse',
                    address_state: 'p.mod-Adresse',
                    address_zip: 'p.mod-Adresse',
                    address_country: 'p.mod-Adresse',
                    categories: 'div.mod-Branchen',
                    rating: '.mod-Bewertung, .rating-stars',
                    reviewCount: '.mod-Bewertung .count, .review-count',
                    description: '.mod-Beschreibung, .business-description',
                    detailPageLink: 'h2[data-wipe-name="Titel"] a',
                    pagination: {
                        nextButton: 'a[rel="next"]',
                        currentPage: '.pagination .current, .current-page',
                        maxPages: '.pagination .total, .total-pages'
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://www.gelbeseiten.de/suche/{keywords}/{location}',
                    paginationUrlPattern: '/seite-{page}',
                    resultUrlPattern: 'https://www.gelbeseiten.de{path}',
                    supportedFeatures: ['search', 'pagination', 'detailed_extraction'],
                    antiScrapingMeasures: {
                        requiresStealthMode: true,
                        cookieConsentSelector: 'button#uc-btn-accept-all',
                        rateLimitDelay: 3000
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
                description: 'GelbeSeiten.de is the German Yellow Pages directory. This platform provides business listings, contact information, and reviews for German businesses.',
                maintainer: 'Platform Development Team',
                documentation: 'https://www.gelbeseiten.de'
            });

            if (updateResult) {
                console.log('Successfully updated GelbeSeiten.de platform configuration');
            } else {
                console.error('Failed to update GelbeSeiten.de platform configuration');
            }
        } else {
            // Create new platform
            const platformId = await platformModel.saveYellowPagesPlatform({
                name: 'gelbeseiten-de',
                display_name: 'GelbeSeiten.de',
                base_url: 'https://www.gelbeseiten.de',
                country: 'Germany',
                language: 'German',
                is_active: true,
                version: '1.0.0',
                rate_limit: 100,
                delay_between_requests: 2000,
                max_concurrent_requests: 1,
                type: 'configuration',
                selectors: {
                    businessList: 'div#gs_treffer',
                    businessItem: 'article.mod.mod-Treffer',
                    businessName: 'h2[data-wipe-name="Titel"]',
                    phone: 'p.mod-Telefonnummer',
                    email: 'a[data-track-event="vcard_email"]',
                    website: 'a[data-track-event="vcard_website"]',
                    address: 'p.mod-Adresse',
                    address_city: 'p.mod-Adresse',
                    address_state: 'p.mod-Adresse',
                    address_zip: 'p.mod-Adresse',
                    address_country: 'p.mod-Adresse',
                    categories: 'div.mod-Branchen',
                    rating: '.mod-Bewertung, .rating-stars',
                    reviewCount: '.mod-Bewertung .count, .review-count',
                    description: '.mod-Beschreibung, .business-description',
                    detailPageLink: 'h2[data-wipe-name="Titel"] a',
                    pagination: {
                        nextButton: 'a[rel="next"]',
                        currentPage: '.pagination .current, .current-page',
                        maxPages: '.pagination .total, .total-pages'
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://www.gelbeseiten.de/suche/{keywords}/{location}',
                    paginationUrlPattern: '/seite-{page}',
                    resultUrlPattern: 'https://www.gelbeseiten.de{path}',
                    supportedFeatures: ['search', 'pagination', 'detailed_extraction'],
                    antiScrapingMeasures: {
                        requiresStealthMode: true,
                        cookieConsentSelector: 'button#uc-btn-accept-all',
                        rateLimitDelay: 3000
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
                description: 'GelbeSeiten.de is the German Yellow Pages directory. This platform provides business listings, contact information, and reviews for German businesses.',
                maintainer: 'Platform Development Team',
                documentation: 'https://www.gelbeseiten.de'
            });

            console.log(`Successfully created GelbeSeiten.de platform with ID: ${platformId}`);
        }

        console.log('GelbeSeiten.de platform registration completed successfully');

    } catch (error) {
        console.error('Error registering GelbeSeiten.de platform:', error);
        throw error;
    }
}

// Export the function for use in other modules
export { registerGelbeSeitenDePlatform };

// Run the registration if this script is executed directly
if (require.main === module) {
    registerGelbeSeitenDePlatform()
        .then(() => {
            console.log('GelbeSeiten.de platform registration completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Failed to register GelbeSeiten.de platform:', error);
            process.exit(1);
        });
}

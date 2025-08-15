import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { ComAdapter192 } from '@/modules/platforms/192ComAdapter';

export const Platform_192_com: PlatformConfig = {
    id: '192-com',
    name: '192-com',
    display_name: '192.com',
    base_url: 'https://www.192.com',
    country: 'UK',
    language: 'en',
    is_active: true,
    version: '1.0.0',
    rate_limit: 1000,
    delay_between_requests: 1000,
    max_concurrent_requests: 1,
    type: 'class',
    adapter_class: ComAdapter192, // Direct class reference
    description: 'UK business directory platform',
    maintainer: 'Platform Team',
    selectors: {
        businessList: 'div.business-result',
        businessName: 'h3.business-name',
        phone: 'span.business-phone',
        email: 'a.business-email',
        website: 'a.business-website',
        address: 'span.business-address',
        categories: 'span.business-category',
        socialMedia: 'a.business-social',
        rating: 'div.business-rating',
        reviewCount: 'span.business-review-count',
        businessHours: 'div.business-hours',
        description: 'div.business-description',
        pagination: {
            nextButton: 'a.pagination-next',
            currentPage: '.pagination-current',
            maxPages: '.pagination-last',
        },
    },
    settings: {
        requiresAuthentication: false,
        supportsProxy: true,
        supportsCookies: true,
        searchUrlPattern: '{base_url}/search?q={keywords}&location={location}&page={page}',
        resultUrlPattern: '{base_url}/business/{id}',
        supportedFeatures: [
            PlatformFeature.SEARCH,
            PlatformFeature.PAGINATION,
            PlatformFeature.DETAILED_EXTRACTION,
            PlatformFeature.RATINGS,
            PlatformFeature.REVIEWS,
            PlatformFeature.BUSINESS_HOURS
        ]
    },
    metadata: {
        lastUpdated: new Date(),
        version: '1.0.0',
        category: 'business_directory',
        priority: 'high',
        tags: ['uk', 'business', 'directory'],
        statistics: {
            totalBusinesses: 0,
            lastScraped: new Date(),
            successRate: 0
        }
    }
};



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
        searchForm:{
            keywordInput: '#peopleBusinesses_name',
            locationInput: '#where_location',
            searchButton: '#searchBtn',
            formContainer: '#js-ont-header-search-form',
          },
        businessList: '#ont-result-content > ul > li',
        businessName: 'div.test-name',
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
        navigation: {
            required: true,
            detailLink: 'div.viewBtn',
            delayAfterNavigation: 2000,
            detailPage: {
                businessName: 'h1.business-title, .business-header h1',
                fullAddress: '.business-address-full, .address-container',
                businessHours: '.business-hours-detailed, .hours-container',
                description: '.business-description-full, .description-container',
                contactInfo: '.contact-information, .contact-details',
                services: '.business-services, .services-list',
                additionalPhone: '.phone-numbers .phone, .contact-phone',
                additionalEmail: '.email-addresses .email, .contact-email',
                socialMedia: '.social-media-links a, .social-links a',
                categories: '.business-categories-full, .category-list',
                yearEstablished: '.year-established, .established-date',
                numberOfEmployees: '.employee-count, .staff-size',
                paymentMethods: '.payment-methods, .accepted-payments',
                specialties: '.business-specialties, .specialty-list',
                website: '.business-website a, .website-link, a[href*="http"]'
            }
        }
    },
    settings: {
        requiresAuthentication: false,
        authentication: {
            type: 'none',
            requiresLogin: false,
            requiresApiKey: false,
            requiresOAuth: false,
            requiresCookies: true,
            persistentAuth: false
        },
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



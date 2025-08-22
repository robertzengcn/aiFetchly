import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

/**
 * Example platform configuration demonstrating API key authentication
 * This shows how to configure a platform that requires an API key
 * for accessing business data.
 */
export const Platform_api_key_example: PlatformConfig = {
  id: 'api-key-example',
  name: 'API Key Example Platform',
  display_name: 'API Key Business Directory',
  base_url: 'https://api.example.com',
  country: 'US',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'configuration',
  documentation: 'https://docs.example.com/api',
  maintainer: 'API Team',
  description: 'Example platform configuration showing API key authentication',

  rate_limit: 1000,
  delay_between_requests: 100,
  max_concurrent_requests: 5,

  selectors: {
    // API response parsing selectors
    businessList: '.business-item',
    businessName: '.business-name',
    phone: '.phone-number',
    email: '.email-address',
    website: '.website-link',
    address: '.business-address',
    categories: '.business-category',
    rating: '.rating-stars',
    reviewCount: '.review-count',
    
    // Search form selectors (if web interface exists)
    searchForm: {
      keywordInput: '#search-input',
      locationInput: '#location-input',
      searchButton: '.search-button',
      formContainer: '.search-form'
    },
    
    // Pagination selectors
    pagination: {
      nextButton: '.pagination .next',
      currentPage: '.pagination .current',
      maxPages: '.pagination .total',
      pageNumbers: '.pagination a[href*="page"]',
      container: '.pagination'
    }
  },

  settings: {
    requiresAuthentication: true,
    authentication: {
      type: 'api_key',
      requiresLogin: false,
      requiresApiKey: true,
      requiresOAuth: false,
      //requiresSession: false,
      requiresCookies: false,
      requiredCredentials: ['api_key'],
      persistentAuth: true,
      authTimeout: 0, // No timeout for API keys
      requiresReauth: false,
      authRateLimit: 1000 // 1000 requests per hour
    },
    supportsProxy: true,
    supportsCookies: false,
    searchUrlPattern: 'https://api.example.com/v1/search?q={keywords}&location={location}&page={page}&api_key={api_key}',
    resultUrlPattern: 'https://api.example.com/v1/business/{id}?api_key={api_key}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
      PlatformFeature.RATINGS,
      PlatformFeature.REVIEWS,
      PlatformFeature.AUTHENTICATION
    ],
  },

  metadata: {
    lastUpdated: new Date('2024-01-15T00:00:00.000Z'),
    version: '1.0.0',
    tags: ['example', 'api-key', 'authentication', 'business-directory'],
    priority: 'low',
    category: 'api_platform'
  },
};

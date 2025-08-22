import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

/**
 * Example platform configuration demonstrating OAuth authentication
 * This shows how to configure a platform that requires OAuth
 * for accessing business data.
 */
export const Platform_oauth_example: PlatformConfig = {
  id: 'oauth-example',
  name: 'OAuth Example Platform',
  display_name: 'OAuth Business Directory',
  base_url: 'https://oauth.example.com',
  country: 'US',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'configuration',
  documentation: 'https://docs.example.com/oauth',
  maintainer: 'OAuth Team',
  description: 'Example platform configuration showing OAuth authentication',

  rate_limit: 500,
  delay_between_requests: 200,
  max_concurrent_requests: 3,

  selectors: {
    // Business data extraction selectors
    businessList: '.business-listing',
    businessName: '.business-name',
    phone: '.phone-number',
    email: '.email-address',
    website: '.website-link',
    address: '.business-address',
    categories: '.business-category',
    rating: '.rating-stars',
    reviewCount: '.review-count',
    
    // Search form selectors
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
      type: 'oauth',
      requiresLogin: true,
      requiresApiKey: false,
      requiresOAuth: true,
      requiresCookies: true,
      loginUrl: 'https://oauth.example.com/authorize',
      logoutUrl: 'https://oauth.example.com/logout',
      requiredCredentials: ['client_id', 'client_secret', 'redirect_uri'],
      persistentAuth: true,
      authTimeout: 3600000, // 1 hour
      requiresReauth: true,
      authRateLimit: 10 // 10 OAuth flows per hour
    },
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern: 'https://api.oauth.example.com/v1/search?q={keywords}&location={location}&page={page}',
    resultUrlPattern: 'https://api.oauth.example.com/v1/business/{id}',
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
    tags: ['example', 'oauth', 'authentication', 'business-directory'],
    priority: 'low',
    category: 'oauth_platform'
  },
};

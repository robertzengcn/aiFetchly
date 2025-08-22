import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

/**
 * Example platform configuration demonstrating navigation to detail pages
 * This shows how to configure a platform that requires visiting individual
 * business detail pages to extract comprehensive information.
 */
export const Platform_example: PlatformConfig = {
  id: 'example-platform',
  name: 'Example Platform',
  display_name: 'Example Business Directory',
  base_url: 'https://example.com',
  country: 'US',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'configuration',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/example',
  maintainer: 'Example Team',
  description: 'Example platform configuration showing navigation to detail pages',

  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,

  selectors: {
    // Basic listing page selectors
    searchForm: {
      keywordInput: '#search-input',
      locationInput: '#location-input',
      searchButton: '.search-button',
      formContainer: '.search-form'
    },
    businessList: '.business-listing',
    businessName: '.business-name',
    phone: '.phone-number',
    email: '.email-address',
    website: '.website-link',
    address: '.business-address',
    categories: '.business-category',
    rating: '.rating-stars',
    reviewCount: '.review-count',
    
    // Navigation configuration for detail page extraction
    navigation: {
      // Selector for the link to navigate to detail page
      detailLink: '.business-name a, .view-details',
      
      // Alternative selectors if primary fails
      alternatives: [
        'a[href*="/business/"]',
        'a[href*="/detail/"]',
        '.business-listing a[href*="http"]'
      ],
      
      // Whether navigation is required for full data extraction
      required: true,
      
      // Delay after navigation (ms) to allow page to load
      delayAfterNavigation: 3000,
      
      // Selectors specific to detail page
      detailPage: {
        // Enhanced business name on detail page
        businessName: 'h1.business-title, .business-header h1',
        
        // Full address on detail page
        fullAddress: '.full-address, .address-complete',
        
        // Detailed business hours
        businessHours: '.hours-detailed, .business-hours',
        
        // Complete business description
        description: '.business-description, .about-business',
        
        // Contact information section
        contactInfo: '.contact-section, .contact-details',
        
        // Services offered
        services: '.services-list, .offered-services',
        
        // Business photos/gallery
        photos: '.business-gallery, .photo-gallery',
        
        // Map/location widget
        map: '.business-map, .location-map',
        
        // Additional phone numbers
        additionalPhone: '.phone-additional, .contact-phone',
        
        // Additional email addresses
        additionalEmail: '.email-additional, .contact-email',
        
        // Social media links
        socialMedia: '.social-links, .social-media',
        
        // Detailed business categories
        categories: '.categories-detailed, .business-categories',
        
        // Year established
        yearEstablished: '.year-established, .established-date',
        
        // Number of employees
        numberOfEmployees: '.employee-count, .staff-size',
        
        // Payment methods accepted
        paymentMethods: '.payment-accepted, .payment-methods',
        
        // Business specialties
        specialties: '.business-specialties, .specialties-list'
      }
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
      type: 'login',
      requiresLogin: true,
      requiresApiKey: false,
      requiresOAuth: false,
      //requiresSession: true,
      requiresCookies: true,
      loginUrl: 'https://example.com/login',
      logoutUrl: 'https://example.com/logout',
      loginForm: {
        usernameInput: '#username',
        passwordInput: '#password',
        emailInput: '#email',
        loginButton: '.login-button',
        formContainer: '.login-form',
        captchaSelector: '.captcha-container',
        rememberMeCheckbox: '#remember-me'
      },
      authStatus: {
        loggedInIndicator: '.user-menu',
        loggedOutIndicator: '.login-link',
        userMenuSelector: '.user-dropdown',
        profileLinkSelector: '.profile-link'
      },
      requiredCredentials: ['username', 'password'],
      persistentAuth: true,
      authTimeout: 3600000, // 1 hour
      requiresReauth: false,
      authRateLimit: 5 // 5 attempts per minute
    },
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern: 'https://example.com/search?q={keywords}&location={location}&page={page}',
    resultUrlPattern: 'https://example.com/business/{id}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
      PlatformFeature.RATINGS,
      PlatformFeature.REVIEWS,
      PlatformFeature.BUSINESS_HOURS,
      PlatformFeature.SOCIAL_MEDIA,
      PlatformFeature.CATEGORIES,
      PlatformFeature.AUTHENTICATION
    ],
  },

  metadata: {
    lastUpdated: new Date('2024-01-15T00:00:00.000Z'),
    version: '1.0.0',
    tags: ['example', 'business-directory', 'detail-navigation', 'comprehensive-extraction'],
    priority: 'low',
  },
};


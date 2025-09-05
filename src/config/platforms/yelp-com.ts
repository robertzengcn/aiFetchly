import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { YelpComAdapter } from '@/modules/platforms/YelpComAdapter';

export const Platform_yelp_com: PlatformConfig = {
  id: 'yelp-com',
  name: 'Yelp.com',
  display_name: 'Yelp.com',
  base_url: 'https://www.yelp.com',
  country: 'USA',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  adapter_class: YelpComAdapter, // Direct class reference
  documentation: 'https://www.yelp.com/developers',
  maintainer: 'AI Agent',

  rate_limit: 60,
  delay_between_requests: 3000,
  max_concurrent_requests: 1,

  selectors: {
    searchForm: {
      keywordInput: '#search_description',
      locationInput: '#search_location',
      searchButton: 'button[aria-label="Search"].ewsdu8x6',
      formContainer: 'div.y-css-4h0q8r',
    },
    businessList: '#main-content',
    businessItem: 'div.y-css-pwt8yl',
    businessName: 'h3',
    phone: '',
    email: '',
    website: '',
    address: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    address_country: '',
    categories: '',
    rating: '',
    reviewCount: '',
    description: '',
    detailPageLink: '',
    pagination: {
      nextButton: 'button.pagination-button__09f24__kbFYf',
      currentPage: '',
      maxPages: '',
    },
    navigation: {
      required: true,
      detailLink: 'h3',
      delayAfterNavigation: 2000,
      detailPage: {
        businessName: 'h1.y-css-olzveb',
        fullAddress: '',
        businessHours: '',
        description: '',
        contactInfo: '',
        services: '',
        additionalPhone: '',
        additionalEmail: '',
        socialMedia: '',
        categories: '',
        yearEstablished: '',
        numberOfEmployees: '',
        paymentMethods: '',
        specialties: '',
        website: ''
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
      requiresCookies: false,
      persistentAuth: false
    },
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      'https://www.yelp.com/search?find_desc={keywords}&find_loc={location}&start={offset}',
    resultUrlPattern: 'https://www.yelp.com{businessPath}',
    paginationOffset: 10,
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
      PlatformFeature.RATINGS,
      PlatformFeature.REVIEWS,
      PlatformFeature.PHOTOS,
    ],
  },

  description:
    'Official Yelp platform for local business reviews and ratings.',
  metadata: {
    lastUpdated: new Date('2024-07-30T12:00:00Z'),
    version: '1.0.0',
    category: 'business_reviews',
    priority: 'high',
    tags: ['usa', 'business-reviews', 'ratings', 'local-search'],
  },
};



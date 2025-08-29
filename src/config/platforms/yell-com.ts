import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
// import { YellComAdapter } from '@/modules/platforms/YellComAdapter';

export const Platform_yell_com: PlatformConfig = {
  id: 'yell-com',
  name: 'Yell.com',
  display_name: 'Yell.com',
  base_url: 'https://www.yell.com',
  country: 'UK',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  // adapter_class: YellComAdapter, // Direct class reference
  documentation: 'https://docs.yellowpages-scraper.com/platforms/yell-com',
  maintainer: 'UK Platform Scraper Team',
  description:
    "Platform adapter for Yell.com - UK's leading business directory and local search platform",

  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,

  selectors: {
    searchForm:{
      keywordInput: '#search_keyword',
      locationInput: '#search_location',
      searchButton: '#searchBoxForm  .searchBar--submit',
      formContainer: '#searchBoxForm',
    },
    businessList: '.results--capsuleList',
    businessItem:'article.businessCapsule',
    businessName: 'h2.businessCapsule--name',
    phone: 'span.business--telephoneNumber',
    email: '',
    website: 'a[data-test="localBusiness--website"]',
    address: 'span.business--address',
    categories: 'span.business--category',
    socialMedia: '',
    rating: 'span.starRating--average',
    reviewCount: '',
    businessHours: '',
    description: 'div.businessCapsule--classStrap',
    
    // Navigation configuration for detail page extraction
    navigation: {
      detailLink: '.businessCapsule--moreInfoBtn',
      alternatives: [
        'a.businessCapsule--name',
        '.businessCapsule a[href*="/business/"]',
        'a[href*="/business/"]'
      ],
      required: true, // Navigation is required for full data
      delayAfterNavigation: 2000,
      detailPage: {
        businessName: 'h1.businessCard--businessName',
        fullAddress: 'span.address',
        businessHours: 'div.businessCard--openingHours',
        description: 'div.business--aboutUs',
        contactInfo: '',
        services: '',
        photos: '',
        map: '',
        additionalPhone: 'span.business--telephoneNumber',
        additionalEmail: '',
        socialMedia: '',
        categories: '',
        yearEstablished: '',
        numberOfEmployees: '',
        paymentMethods: '',
        specialties: '',
        website: 'a.businessCard--callToAction'
      }
    },
    
    pagination: {
      nextButton: 'a.pagination--next',
      currentPage: '',
      maxPages: '',
    },
  },

  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      'https://www.yell.com/ucs/UcsSearchAction.do?keywords={keywords}&location={location}&pageNum={page}',
    resultUrlPattern: 'https://www.yell.com{path}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
      PlatformFeature.RATINGS,
      PlatformFeature.REVIEWS,
      PlatformFeature.BUSINESS_HOURS,
    ],
  },

  metadata: {
    lastUpdated: new Date('2024-01-15T00:00:00.000Z'),
    version: '1.0.0',
    tags: ['uk', 'business-directory', 'local-search', 'phase-2'],
    priority: 'medium',
  },
};



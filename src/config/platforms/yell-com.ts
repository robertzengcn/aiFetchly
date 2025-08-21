import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { YellComAdapter } from '@/modules/platforms/YellComAdapter';

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
  adapter_class: YellComAdapter, // Direct class reference
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
      searchButton: '#searchBoxForm > fieldset > div:nth-child(7) > div > button',
      formContainer: '#searchBoxForm',
    },
    businessList: '.businessCapsule',
    businessName: 'h2.businessCapsule--name',
    phone: 'span.business--telephoneNumber',
    email: '',
    website: 'a.business--website',
    address: 'span.business--address',
    categories: 'span.business--category',
    socialMedia: '',
    rating: 'span.starRating--average',
    reviewCount: '',
    businessHours: '',
    description: 'div.businessCapsule--classStrap',
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



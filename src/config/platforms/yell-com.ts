import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

export const Platform_yell_com: PlatformConfig = {
  id: 'yell-com',
  name: 'Yell.com',
  display_name: 'Yell.com',
  base_url: 'https://www.yell.com',
  country: 'UK',
  language: 'English',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  class_name: 'YellComAdapter',
  module_path: './platforms/YellComAdapter',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/yell-com',
  maintainer: 'UK Platform Scraper Team',
  description:
    "Platform adapter for Yell.com - UK's leading business directory and local search platform",

  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,

  selectors: {
    businessList: 'div.businessCapsule',
    businessName: 'h2.businessCapsule--name',
    phone: 'span.business--telephoneNumber',
    email: 'a.business--email',
    website: 'a.business--website',
    address: 'span.business--address',
    categories: 'span.business--category',
    socialMedia: 'a.business--social',
    rating: 'div.business--rating',
    reviewCount: 'span.business--reviewCount',
    businessHours: 'div.business--hours',
    description: 'div.business--description',
    pagination: {
      nextButton: 'a.pagination--next',
      currentPage: '.pagination--current',
      maxPages: '.pagination--last',
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



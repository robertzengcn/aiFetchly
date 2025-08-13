import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

export const Platform_192_com: PlatformConfig = {
  id: '192-com',
  name: '192.com',
  display_name: '192.com',
  base_url: 'https://www.192.com',
  country: 'UK',
  language: 'English',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  class_name: '192ComAdapter',
  module_path: './platforms/192ComAdapter',

  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,

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
    searchUrlPattern:
      'https://www.192.com/businesses/search/?what={keywords}&where={location}&page={page}',
    resultUrlPattern: 'https://www.192.com{path}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
      PlatformFeature.RATINGS,
      PlatformFeature.REVIEWS,
      PlatformFeature.BUSINESS_HOURS,
    ],
  },

  description:
    "Platform adapter for 192.com - UK's comprehensive business directory and local search platform",
  metadata: {
    lastUpdated: new Date('2024-01-15T00:00:00.000Z'),
    version: '1.0.0',
    category: undefined,
    tags: ['uk', 'business-directory', 'local-search', 'phase-2'],
    priority: 'medium',
  },
};



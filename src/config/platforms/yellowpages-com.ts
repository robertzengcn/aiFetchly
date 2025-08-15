import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { YellowPagesComAdapter } from '@/modules/platforms/YellowPagesComAdapter';

export const Platform_yellowpages_com: PlatformConfig = {
  id: 'yellowpages-com',
  name: 'YellowPages.com',
  display_name: 'YellowPages.com',
  base_url: 'https://www.yellowpages.com',
  country: 'USA',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  adapter_class: YellowPagesComAdapter, // Direct class reference
  description:
    'Platform adapter for YellowPages.com - the original online business directory for the United States',
  maintainer: 'Yellow Pages Scraper Team',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/yellowpages-com',

  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,

  selectors: {
    businessList:
      'div#main-content div.search-results.organic div.result',
    businessName: 'a.business-name',
    phone: 'div.phones',
    email: 'a.email-business',
    website: 'p.website a',
    address: 'div.adr',
    categories: 'div.categories',
    socialMedia: 'div.social-links a',
    rating: 'div.result-rating',
    reviewCount: 'span.count',
    businessHours: 'table.hours-table tr',
    description: 'div.business-description',
    pagination: {
      nextButton: 'a.next',
      currentPage: '.pagination .current',
      maxPages: '.pagination .last',
    },
  },

  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      'https://www.yellowpages.com/search?search_terms={keywords}&geo_location_terms={location}&page={page}',
    resultUrlPattern: 'https://www.yellowpages.com{path}',
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
    tags: ['usa', 'business-directory', 'local-search', 'phase-1'],
    priority: 'high',
  },
};



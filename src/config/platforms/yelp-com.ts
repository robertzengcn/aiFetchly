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
    businessList: '[data-testid="serp-ia-card"]',
    businessName: 'h3 a',
    phone: 'p[class*="css-1p9ibgf"]',
    email: 'a[href^="mailto:"]',
    website: 'a[href*="biz_redir"]',
    address: 'address p',
    categories: '[class*="priceCategory"] button',
    socialMedia: '[data-testid="services-actions-component"] p[class*="tagText"]',
    rating: '[class^="five-stars"]',
    reviewCount: 'span[class*="css-1fdy0l5"]',
    businessImage: '[data-lcp-target-id="SCROLLABLE_PHOTO_BOX"] img',
    businessUrl: 'h3 a',
    priceRange: '[class^="priceRange"]',
    pagination: {
      nextButton: '[class^="pagination-links"] a',
      currentPage: '.pagination .current',
      maxPages: '.pagination__09f24__VRjN4 .css-chan6m',
    },
  },

  settings: {
    requiresAuthentication: false,
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



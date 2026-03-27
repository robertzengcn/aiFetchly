import { PlatformConfig, PlatformFeature } from '@/modules/interface/IPlatformConfig';
import { YellowPagesComSgAdapter } from '@/modules/platforms/YellowPagesComSgAdapter';

export const Platform_yellowpages_com_sg: PlatformConfig = {
  id: 'yellowpages-com-sg',
  name: 'YellowPages.com.sg',
  display_name: 'Yellow Pages Singapore',
  base_url: 'https://www.yellowpages.com.sg',
  country: 'Singapore',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  adapter_class: YellowPagesComSgAdapter,
  description:
    'Platform adapter for YellowPages.com.sg - Singapore business directory and yellow pages',
  maintainer: 'Yellow Pages Scraper Team',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/yellowpages-com-sg',

  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,

  selectors: {
    businessList: '.product-list, .business-list, .listings, .listing-container',
    businessItem: '.business-item, .listing-item, .company-item, .product-item, .list-card',
    businessName: '.business-name, .company-name, .listing-title, .title, h3.title, h4.title',
    phone: '.phone, .contact-phone, .business-phone, .phone-number, .tel',
    email: '.email, .business-email, .contact-email, .email-address',
    website: '.website, .business-website, .company-website, .web-url, .website-link',
    address: '.address, .business-address, .company-address, .location, .contact-address',
    categories: '.categories, .business-categories, .category',
    socialMedia: '.social-links a, .social-media a',
    rating: '.rating, .stars, .review-rating',
    reviewCount: '.review-count, .reviews-count',
    businessHours: '.business-hours, .opening-hours, .hours',
    description: '.business-description, .description, .company-description',
    pagination: {
      nextButton: '.pagination .next, .next-page, a.next',
      currentPage: '.pagination .current, .page-item.active',
      maxPages: '.pagination .last, .total-pages',
    },
  },

  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      'https://www.yellowpages.com.sg/?s={keywords}&post_type=product',
    resultUrlPattern: 'https://www.yellowpages.com.sg{path}',
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
    lastUpdated: new Date('2025-03-27T00:00:00.000Z'),
    version: '1.0.0',
    tags: ['singapore', 'business-directory', 'local-search', 'asean'],
    priority: 'medium',
  },
};

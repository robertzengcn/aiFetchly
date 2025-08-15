import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

export const Platform_11880_de: PlatformConfig = {
  id: '11880-de',
  name: '11880.com',
  display_name: '11880.com',
  base_url: 'https://www.11880.com',
  country: 'Germany',
  language: 'de',
  is_active: true,
  version: '1.0.0',
  type: 'configuration',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/11880-de',
  maintainer: 'Platform Development Team',
  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,
  selectors: {
    businessList: 'div.search-results-body',
    businessItem: 'article.search-result-entry',
    businessName: 'h2.name a',
    phone: 'div.phone-number a',
    email: 'div.email a, a[data-track-event="vcard_email"]',
    website: 'div.homepage a',
    address: 'div.address',
    address_city: 'div.address',
    address_state: 'div.address',
    address_zip: 'div.address',
    address_country: 'div.address',
    categories: 'div.categories',
    rating: '.rating, .stars, .business-rating',
    reviewCount: '.review-count, .reviews-count',
    description: '.description, .business-description',
    detailPageLink: 'h2.name a',
    pagination: {
      nextButton: 'li.page-item.next a',
      currentPage: '.pagination .current, .current-page',
      maxPages: '.pagination .total, .total-pages',
    },
  },
  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern: 'https://www.11880.com/suche/{keywords}/{location}',
    paginationUrlPattern: '/seite-{page}',
    resultUrlPattern: 'https://www.11880.com{path}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
    ],
    custom: {
      antiScrapingMeasures: {
        requiresStealthMode: true,
        cookieConsentSelector: "button[data-testid='uc-accept-all-button']",
        rateLimitDelay: 3000,
        preScrapeSteps: [
          {
            action: 'click',
            selector: "button[data-testid='uc-accept-all-button']",
            description: 'Accept the Usercentrics cookie consent banner',
            waitFor: 'networkidle0',
          },
        ],
      },
    },
  },
  metadata: {
    lastUpdated: new Date('2024-01-15T10:30:00.000Z'),
    version: '1.0.0',
    category: 'business-directory',
    priority: 'medium',
    tags: ['germany', 'business-directory', 'yellow-pages', 'phase-3'],
    statistics: {
      totalBusinesses: 0,
      lastScraped: new Date('2024-01-15T10:30:00.000Z'),
      successRate: 0,
    },
  },
  description:
    'Platform configuration for 11880.com - German business directory and search platform',
};



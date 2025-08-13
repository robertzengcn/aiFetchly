import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

export const Platform_gelbeseiten_de: PlatformConfig = {
  id: 'gelbeseiten-de',
  name: 'GelbeSeiten.de',
  display_name: 'GelbeSeiten.de',
  base_url: 'https://www.gelbeseiten.de',
  country: 'Germany',
  language: 'German',
  is_active: true,
  version: '1.0.0',
  type: 'configuration',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/gelbeseiten-de',
  maintainer: 'Platform Development Team',
  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,
  selectors: {
    businessList: 'div#gs_treffer',
    businessItem: 'article.mod.mod-Treffer',
    businessName: 'h2[data-wipe-name="Titel"]',
    phone: 'p.mod-Telefonnummer',
    email: 'a[data-track-event="vcard_email"]',
    website: 'a[data-track-event="vcard_website"]',
    address: 'p.mod-Adresse',
    address_city: 'p.mod-Adresse',
    address_state: 'p.mod-Adresse',
    address_zip: 'p.mod-Adresse',
    address_country: 'p.mod-Adresse',
    categories: 'div.mod-Branchen',
    rating: '.mod-Bewertung, .rating-stars',
    reviewCount: '.mod-Bewertung .count, .review-count',
    description: '.mod-Beschreibung, .business-description',
    detailPageLink: 'h2[data-wipe-name="Titel"] a',
    pagination: {
      nextButton: 'a[rel="next"]',
      currentPage: '.pagination .current, .current-page',
      maxPages: '.pagination .total, .total-pages',
    },
  },
  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern: 'https://www.gelbeseiten.de/suche/{keywords}/{location}',
    paginationUrlPattern: '/seite-{page}',
    resultUrlPattern: 'https://www.gelbeseiten.de{path}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
    ],
    custom: {
      antiScrapingMeasures: {
        requiresStealthMode: true,
        cookieConsentSelector: 'button#uc-btn-accept-all',
        rateLimitDelay: 3000,
      },
    },
  },
  metadata: {
    lastUpdated: new Date('2024-01-15T10:30:00.000Z'),
    version: '1.0.0',
    category: 'business-directory',
    tags: ['germany', 'business-directory', 'yellow-pages', 'phase-3'],
    statistics: {
      totalBusinesses: 0,
      lastScraped: new Date('2024-01-15T10:30:00.000Z'),
      successRate: 0,
    },
  },
  description:
    'Platform configuration for GelbeSeiten.de - German Yellow Pages directory',
};



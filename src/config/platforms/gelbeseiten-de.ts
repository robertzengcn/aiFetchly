import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';

export const Platform_gelbeseiten_de: PlatformConfig = {
  id: 'gelbeseiten-de',
  name: 'GelbeSeiten.de',
  display_name: 'GelbeSeiten.de',
  base_url: 'https://www.gelbeseiten.de',
  country: 'Germany',
  language: 'de',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  class_name: 'AdapterGelbeseiten',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/gelbeseiten-de',
  maintainer: 'Platform Development Team',
  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,
  // Selectors are now handled by the AdapterGelbeseiten class
  // This configuration uses the class-based approach for better maintainability
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
      PlatformFeature.COOKIES,
      PlatformFeature.RATINGS,
      PlatformFeature.REVIEWS,
      PlatformFeature.BUSINESS_HOURS,
      PlatformFeature.CATEGORIES,
    ],
    custom: {
      shadowRootCookieHandling: true,
      germanLanguageSupport: true,
      maxRetries: 3,
      retryDelay: 1000,
    },
  },
  metadata: {
    lastUpdated: new Date('2024-01-15T10:30:00.000Z'),
    version: '1.0.0',
    category: 'business-directory',
    priority: 'high',
    tags: ['germany', 'business-directory', 'yellow-pages', 'class-based', 'shadow-root-support'],
    statistics: {
      totalBusinesses: 0,
      lastScraped: new Date('2024-01-15T10:30:00.000Z'),
      successRate: 0,
    },
  },
  description:
    'Platform configuration for GelbeSeiten.de using AdapterGelbeseiten class - German Yellow Pages directory with advanced shadow root support and German language optimization',
};



import { PlatformConfig, PlatformFeature } from '@/modules/interface/IPlatformConfig';
import { Adapter11880 } from '@/modules/platforms/11880Adapter';

export const Platform_11880_de: PlatformConfig = {
  id: '11880-de',
  name: '11880.com',
  display_name: '11880.com',
  base_url: 'https://www.11880.com',
  country: 'Germany',
  language: 'de',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  adapter_class: Adapter11880, // Direct class reference
  documentation: 'https://docs.yellowpages-scraper.com/platforms/11880-de',
  maintainer: 'Platform Development Team',
  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,
  selectors: {
    searchForm: {
      keywordInput: '#form-search-and-find > div > search-part:nth-child(1) > div > input',
      locationInput: '#form-search-and-find > div > search-part:nth-child(2) > div > input',
      searchButton: '#form-search-and-find button',
      formContainer: '#form-search-and-find',
    },
    businessList: '#html-search-result-list',
    businessItem: '#html-search-result-list > li.result-list-entry',
    businessName: 'h2',
    phone: 'span.result-list-entry-phone-number__label',
    email: '',
    website: '',
    address: 'div.result-list-entry-address',
    address_city: '',
    address_state: '',
    address_zip: '',
    address_country: '',
    categories: '',
    rating: '',
    reviewCount: '',
    description: '',
    detailPageLink: '',
    pagination: {
      nextButton: '#searchresultlist  div.next > a',
      currentPage: '',
      maxPages: '',
    },
    navigation: {
      required: true,
      detailLink: 'div.result-list-entry__cta.result-list-entry__cta--button.d-none.d-md-block > button',
      delayAfterNavigation: 2000,
      detailPage: {
        businessName: 'h1.title',
        fullAddress: 'div[title="Adresse"]',
        businessHours: '',
        description: 'div.description',
        contactInfo: '',
        services: '',
        additionalPhone: '.phone-numbers .phone, .contact-phone',
        additionalEmail: '#box-email-link > div.entry-detail-list__label > span',
        socialMedia: '',
        categories: '',
        yearEstablished: '',
        numberOfEmployees: '',
        paymentMethods: '',
        specialties: '',
        website: '#entry > div.detail-information-grid-start > div.item-detail-information > div > div.entry-detail-list > div:nth-child(2) > a > div.entry-detail-list__label'
      }
    }
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



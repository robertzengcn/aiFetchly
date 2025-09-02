import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { PagesJaunesAdapter } from '@/modules/platforms/PagesJaunesAdapter';

export const Platform_pagesjaunes_fr: PlatformConfig = {
  id: 'pagesjaunes-fr',
  name: 'PagesJaunes.fr',
  display_name: 'PagesJaunes.fr',
  base_url: 'https://www.pagesjaunes.fr',
  country: 'France',
  language: 'fr',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  adapter_class: PagesJaunesAdapter,
  documentation: 'https://docs.yellowpages-scraper.com/platforms/pagesjaunes-fr',
  maintainer: 'Platform Development Team',
  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,
  selectors: {
    searchForm: {
      keywordInput: '#quoiqui',
      locationInput: '#ou',
      searchButton: '#findId',
      formContainer: '#form_motor_pagesjaunes',
    },
    businessList: 'div.main-content',
    businessItem: '#listResults ul li.bi',
    businessName: 'div.bi-header-title',
    phone: '',
    email: '',
    website: '',
    address: '',
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
      nextButton: '#pagination-next',
      currentPage: '',
      maxPages: '',
    },
    navigation: {
      required: true,
      detailLink: 'h3',
      delayAfterNavigation: 2000,
      detailPage: {
        businessName: 'h1',
        fullAddress: 'div.address-container',
        businessHours: '',
        description: 'div.zone-activites',
        contactInfo: '',
        services: '',
        additionalPhone: '',
        additionalEmail: '',
        socialMedia: '',
        categories: '',
        yearEstablished: '',
        numberOfEmployees: '',
        paymentMethods: '',
        specialties: '',
        website: 'div.lvs-container.marg-btm-s'
      }
    }
  },
  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      'https://www.pagesjaunes.fr/recherche?quoiqui={keywords}&ou={location}&page={page}',
    resultUrlPattern: 'https://www.pagesjaunes.fr{path}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
    ],
  },
  locationRequired: true,
  metadata: {
    lastUpdated: new Date('2024-01-15T10:30:00.000Z'),
    version: '1.0.0',
    category: 'business-directory',
    priority: 'medium',
    tags: ['france', 'business-directory', 'yellow-pages', 'class-based', 'location-required'],
    statistics: {
      totalBusinesses: 0,
      lastScraped: new Date('2024-01-15T10:30:00.000Z'),
      successRate: 0,
    },
  },
  description:
    'Platform configuration for PagesJaunes.fr using PagesJaunesAdapter class - French Yellow Pages directory with location requirement validation',
};



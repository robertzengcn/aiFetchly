import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { PagineGialleItAdapter } from '@/modules/platforms/PagineGialleItAdapter';

export const Platform_paginegialle_it: PlatformConfig = {
  id: 'paginegialle-it',
  name: 'PagineGialle.it',
  display_name: 'PagineGialle.it',
  base_url: 'https://www.paginegialle.it',
  country: 'Italy',
  language: 'it',
  is_active: true,
  version: '1.0.0',
  type: 'configuration',
  documentation: 'https://docs.yellowpages-scraper.com/platforms/paginegialle-it',
  maintainer: 'Platform Development Team',
  adapter_class: PagineGialleItAdapter,
  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,
  selectors: {
    searchForm: {
      keywordInput: '#cosa',
      locationInput: '#dove',
      searchButton: '#searchSubmit',
      formContainer: '#extendedSearch',
    },
    businessList: 'div.search__cnt',
    businessItem: 'div.search-itm',
    businessName: 'h2',
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
      nextButton: 'a.bttn--white.next-page-btn',
      currentPage: '',
      maxPages: '',
    },
    navigation: {
      required: true,
      detailLink: 'h2',
      delayAfterNavigation: 2000,
      detailPage: {
        businessName: 'h1',
        fullAddress: 'div.scheda-azienda__companyAddress',
        businessHours: '',
        description: '',
        contactInfo: '',
        services: '',
        additionalPhone: 'span.dialogTel-dskt_icoTel__label',
        additionalEmail: '',
        socialMedia: '',
        categories: 'div.scheda-azienda__companyCategory',
        yearEstablished: '',
        numberOfEmployees: '',
        paymentMethods: '',
        specialties: '',
        website: 'a[data-tr="iolgold_scheda-cliente__cta_sito"]'
      }
    }
  },
  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      'https://www.paginegialle.it/ricerca?q={keywords}&l={location}&p={page}',
    resultUrlPattern: 'https://www.paginegialle.it{path}',
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
    ],
  },
  metadata: {
    lastUpdated: new Date('2024-01-15T10:30:00.000Z'),
    version: '1.0.0',
    category: 'business-directory',
    priority: 'medium',
    tags: ['italy', 'business-directory', 'yellow-pages'],
    statistics: {
      totalBusinesses: 0,
      lastScraped: new Date('2024-01-15T10:30:00.000Z'),
      successRate: 0,
    },
  },
  description:
    'Platform configuration for PagineGialle.it - Italian Yellow Pages directory',
};



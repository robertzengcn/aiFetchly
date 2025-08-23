import { PlatformConfig, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { YellComAdapter } from '@/modules/platforms/YellComAdapter';

export const Platform_yell_com: PlatformConfig = {
  id: 'yell-com',
  name: 'Yell.com',
  display_name: 'Yell.com',
  base_url: 'https://www.yell.com',
  country: 'UK',
  language: 'en',
  is_active: true,
  version: '1.0.0',
  type: 'class',
  adapter_class: YellComAdapter, // Direct class reference
  documentation: 'https://docs.yellowpages-scraper.com/platforms/yell-com',
  maintainer: 'UK Platform Scraper Team',
  description:
    "Platform adapter for Yell.com - UK's leading business directory and local search platform",

  rate_limit: 100,
  delay_between_requests: 2000,
  max_concurrent_requests: 1,

  selectors: {
    searchForm:{
      keywordInput: '#search_keyword',
      locationInput: '#search_location',
      searchButton: '#searchBoxForm > fieldset > div:nth-child(7) > div > button',
      formContainer: '#searchBoxForm',
    },
    businessList: '.businessCapsule',
    businessName: 'h2.businessCapsule--name',
    phone: 'span.business--telephoneNumber',
    email: '',
    website: 'a[data-test="localBusiness--website"]',
    address: 'span.business--address',
    categories: 'span.business--category',
    socialMedia: '',
    rating: 'span.starRating--average',
    reviewCount: '',
    businessHours: '',
    description: 'div.businessCapsule--classStrap',
    
    // Navigation configuration for detail page extraction
    navigation: {
      detailLink: 'h2.businessCapsule--name a, .businessCapsule--name a',
      alternatives: [
        'a.businessCapsule--name',
        '.businessCapsule a[href*="/business/"]',
        'a[href*="/business/"]'
      ],
      required: true, // Navigation is required for full data
      delayAfterNavigation: 2000,
      detailPage: {
        businessName: 'h1.business--name, .business--name',
        fullAddress: '.business--full-address, .address--complete',
        businessHours: '.business--hours, .hours--detailed',
        description: '.business--description, .description--full',
        contactInfo: '.business--contact, .contact--info',
        services: '.business--services, .services--list',
        photos: '.business--photos, .gallery--images',
        map: '.business--map, .location--map',
        additionalPhone: '.business--phone, .phone--additional',
        additionalEmail: '.business--email, .email--additional',
        socialMedia: '.business--social, .social--links',
        categories: '.business--categories, .categories--detailed',
        yearEstablished: '.business--established, .established--year',
        numberOfEmployees: '.business--employees, .employees--count',
        paymentMethods: '.business--payment, .payment--methods',
        specialties: '.business--specialties, .specialties--list',
        website: '.business--website a, .website--link, a[href*="http"]'
      }
    },
    
    pagination: {
      nextButton: 'a.pagination--next',
      currentPage: '',
      maxPages: '',
    },
  },

  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      'https://www.yell.com/ucs/UcsSearchAction.do?keywords={keywords}&location={location}&pageNum={page}',
    resultUrlPattern: 'https://www.yell.com{path}',
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
    tags: ['uk', 'business-directory', 'local-search', 'phase-2'],
    priority: 'medium',
  },
};



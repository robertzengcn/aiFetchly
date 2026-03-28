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
    searchForm: {
      keywordInput: '#select',
      locationInput: '',
      searchButton: 'input.lp-search-btn',
      formContainer: "form.form-inline",
    },
    businessList: 'div.sme_listing_wrap',
    businessItem: 'div.sme_listing_item',
    businessName: 'h4.sme_listing_title',
    phone: '',
    email: '',
    website: '',
    address: '',
    categories: '',
    socialMedia: '',
    rating: '',
    reviewCount: '',
    businessHours: '',
    description: '',
    pagination: {
      nextButton: '',
      currentPage: '',
      maxPages: '',
    },
    navigation: {
      required: true,
      detailLink: 'a',
      delayAfterNavigation: 2000,
      detailPage: {
        businessName: 'h1.entry-title',
        fullAddress: '#frontend_address',
        businessHours: '',
        description: '',
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
        website: ''
      }
    }
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

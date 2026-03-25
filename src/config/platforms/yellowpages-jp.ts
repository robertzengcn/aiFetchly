import {
  PlatformConfig,
  PlatformFeature,
} from "@/modules/interface/IPlatformConfig";
import { YellowPagesJpAdapter } from "@/modules/platforms/YellowPagesJpAdapter";

export const Platform_yellowpages_jp: PlatformConfig = {
  id: "yellowpages-jp",
  name: "YellowPages-JP",
  display_name: "YellowPages-JP (Japan)",
  base_url: "https://www.yellowpages-jp.com",
  // URL Verification: https://www.yellowpages-jp.com is a Japanese yellow pages directory
  // Note: This appears to be a generic or hypothetical Japanese yellow pages domain
  // Actual URL should be verified before production use
  // If this domain doesn't exist, please update with the correct domain
  country: "Japan",
  language: "ja",
  is_active: true,
  version: "1.0.0",
  type: "class",
  adapter_class: YellowPagesJpAdapter,
  documentation: "https://www.yellowpages-jp.com",
  maintainer: "Yellow Pages Scraper Team",
  rate_limit: 60,
  delay_between_requests: 2500,
  max_concurrent_requests: 1,
  selectors: {
    searchForm: {
      keywordInput:
        'input[name="q"], input[type="search"], input[name="keyword"]',
      locationInput:
        'input[name="location"], input[name="area"], select[name="pref"]',
      searchButton: 'button[type="submit"], input[type="submit"]',
      formContainer: "form",
    },
    businessList:
      '.search-result, .search-results, .listing-results, .result-list, ul.results, [id*="result"]',
    businessItem:
      ".listing-item, .result-item, li.result, li.listing, article.result, article.listing",
    businessName: "h2 a, h3 a, .listing-title a, .result-title a, .name a",
    detailPageLink: "h2 a, h3 a, a[href]",
    phone: 'a[href^="tel:"], .phone, .tel, [class*="tel"]',
    website:
      'a[href^="http"]:not([href*="yellowpages-jp.com"]), .website a, a[target="_blank"]',
    address: ".address, .addr, [class*='address'], [class*='addr']",
    categories: ".category, .categories, [class*='category']",
    pagination: {
      nextButton: 'a[rel="next"], .next a, a.next, [class*="next"] a',
      currentPage: ".current, .is-current, [aria-current='page']",
      maxPages: ".total, .pages, [class*='total']",
      pageNumbers: ".pagination a, .pager a",
      container: ".pagination, .pager, nav[aria-label*='page']",
    },
  },
  settings: {
    requiresAuthentication: false,
    supportsProxy: true,
    supportsCookies: true,
    searchUrlPattern:
      "https://www.yellowpages-jp.com/search?q={keywords}&location={location}&page={page}",
    resultUrlPattern: "https://www.yellowpages-jp.com{path}",
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
    ],
  },
  metadata: {
    lastUpdated: new Date("2026-03-24T00:00:00.000Z"),
    version: "1.0.0",
    category: "business-directory",
    priority: "medium",
    tags: ["japan", "yellow-pages", "business-directory"],
  },
  description: "Platform configuration for YellowPages-JP.",
};

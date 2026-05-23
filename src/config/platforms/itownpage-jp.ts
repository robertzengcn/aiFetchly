import {
  PlatformConfig,
  PlatformFeature,
} from "@/modules/interface/IPlatformConfig";
import { ITownPageAdapter } from "@/modules/platforms/ITownPageAdapter";

export const Platform_itownpage_jp: PlatformConfig = {
  id: "itownpage-jp",
  name: "iTownPage",
  display_name: "iTownPage (Japan)",
  base_url: "https://itp.ne.jp",
  // URL Verification: https://itp.ne.jp is the official iTownPage Japan domain
  // Note: iTownPage (also known as "itp") is a major Japanese business directory
  // The site uses itp.ne.jp as the main domain (no www subdomain)
  country: "Japan",
  language: "ja",
  is_active: true,
  version: "1.0.0",
  type: "class",
  adapter_class: ITownPageAdapter,
  documentation: "https://itp.ne.jp/",
  maintainer: "Yellow Pages Scraper Team",
  rate_limit: 60,
  delay_between_requests: 2500,
  max_concurrent_requests: 1,
  selectors: {
    searchForm: {
      keywordInput: '#form1 > div > div:nth-child(1) > div.c-search-area__selected.js-area-box > input',
      locationInput: '#form1 > div > div:nth-child(2) > div.c-search-area__selected.js-genre-box > input',
      searchButton: '#form1 > div > div.c-search-area__submit > button',
      formContainer: "form1",
    },
    businessList:
      '#wrapper > main > div.l-archive-container',
    businessItem:
      "article.c-archive-board",
    businessName: "h2 a",
    detailPageLink: "h2 a",
    phone: 'a[href^="tel:"], .tel, .phone, [class*="tel"]',
    website:
      'a[href^="http"]:not([href*="itp.ne.jp"]), a[target="_blank"], .website a',
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
      "https://itp.ne.jp/search/?keyword={keywords}&address={location}&page={page}",
    resultUrlPattern: "https://itp.ne.jp{path}",
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
  description: "Platform configuration for iTownPage (Japan).",
};

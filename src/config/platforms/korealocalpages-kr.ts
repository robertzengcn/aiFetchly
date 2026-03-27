import {
  PlatformConfig,
  PlatformFeature,
} from "@/modules/interface/IPlatformConfig";
import { KoreaLocalPagesAdapter } from "@/modules/platforms/KoreaLocalPagesAdapter";

export const Platform_korealocalpages_kr: PlatformConfig = {
  id: "korealocalpages-kr",
  name: "KoreaLocalPages",
  display_name: "Korea Local Pages",
  base_url: "https://korealocalpages.com",
  country: "South Korea",
  language: "ko",
  is_active: true,
  version: "1.0.0",
  type: "class",
  adapter_class: KoreaLocalPagesAdapter,
  documentation: "https://korealocalpages.com",
  maintainer: "Yellow Pages Scraper Team",
  rate_limit: 60,
  delay_between_requests: 2500,
  max_concurrent_requests: 1,
  selectors: {
    searchForm: {
      keywordInput: "#searchKeyword",
      locationInput: "#searchLocation",
      searchButton: 'button[type="submit"], .search-button, #searchButton',
      formContainer: "form, .search-form",
    },
    businessList: "div.results-content",
    businessItem: "div.summary-list",
    businessName: "h2, h3, .business-name, [class*='business-name']",
    detailPageLink: "a[href^='/'], a.detail-link, .business-link",
    phone: ".phone, .tel, [class*='phone'], [class*='tel']",
    website: "a[href^='http']:not([href*='korealocalpages.com']), .website, [class*='website']",
    address: ".address, .addr, [class*='address'], [class*='addr']",
    categories: ".category, .categories, [class*='category']",
    pagination: {
      nextButton: "a.next, .next-page, [class*='next'], button[rel='next']",
      currentPage: ".current, .active, [aria-current='page']",
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
      "https://korealocalpages.com/search?keyword={keywords}&location={location}&page={page}",
    resultUrlPattern: "https://korealocalpages.com{path}",
    supportedFeatures: [
      PlatformFeature.SEARCH,
      PlatformFeature.PAGINATION,
      PlatformFeature.DETAILED_EXTRACTION,
    ],
  },
  metadata: {
    lastUpdated: new Date("2026-03-26T00:00:00.000Z"),
    version: "1.0.0",
    category: "business-directory",
    priority: "medium",
    tags: ["south-korea", "yellow-pages", "business-directory", "local-business"],
  },
  description: "Platform configuration for KoreaLocalPages (South Korea).",
};

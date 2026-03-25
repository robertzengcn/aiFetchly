import {
  PlatformConfig,
  PlatformFeature,
} from "@/modules/interface/IPlatformConfig";
import { USonarYellowPageAdapter } from "@/modules/platforms/USonarYellowPageAdapter";

export const Platform_usonar_yellowpage_jp: PlatformConfig = {
  id: "usonar-yellowpage-jp",
  name: "uSonar Yellow Page",
  display_name: "uSonar Yellow Page (Japan)",
  base_url: "https://yellowpage.usonar.co.jp",
  country: "Japan",
  language: "ja",
  is_active: true,
  version: "1.0.0",
  type: "class",
  adapter_class: USonarYellowPageAdapter,
  documentation: "https://yellowpage.usonar.co.jp/",
  maintainer: "Yellow Pages Scraper Team",
  rate_limit: 50,
  delay_between_requests: 3000,
  max_concurrent_requests: 1,
  selectors: {
    searchForm: {
      keywordInput: 'input[name="q"], input[type="search"]',
      locationInput: 'input[name="area"], select[name="prefecture"]',
      searchButton: 'button[type="submit"], input[type="submit"], form button',
      formContainer: "form",
    },
    businessList:
      '.search-result, .search-results, .company-list, .result-list, ul.results, [id*="result"]',
    businessItem:
      ".company-item, .result-item, li.company, li.result, article.company, article.result",
    businessName: "h2 a, h3 a, .company-name a, .result-title a, .name a",
    detailPageLink: "h2 a, h3 a, a[href]",
    phone: 'a[href^="tel:"], .tel, .phone, [class*="tel"]',
    website:
      'a[href^="http"]:not([href*="usonar.co.jp"]), a[target="_blank"], .website a',
    address: ".address, .addr, [class*='address'], [class*='addr']",
    categories:
      ".industry, .category, [class*='industry'], [class*='category']",
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
      "https://yellowpage.usonar.co.jp/search?keyword={keywords}&area={location}&page={page}",
    resultUrlPattern: "https://yellowpage.usonar.co.jp{path}",
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
    tags: ["japan", "yellow-pages", "usonar", "business-directory"],
  },
  description: "Platform configuration for uSonar Yellow Page (Japan).",
};

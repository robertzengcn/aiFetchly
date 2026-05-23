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
      searchButton: 'button.is-primary[type="submit"]',
      formContainer: "form, .search-form",
    },
    businessList: "div.results-content",
    businessItem: "div.summary-item",
    businessName: "div.h-4",
    detailPageLink: "",
    phone: "a.summary-phone",
    website: "a.button.button-bg.is-primary",
    address: "",
    categories: "div.summary-categories",
    pagination: {
      nextButton: "a.is-next",
      currentPage: "a.item-pagination.is-selected",
      maxPages: "",
      pageNumbers: "",
      container: "div.results-pagination",
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

import { Page } from 'puppeteer';
import winston from "winston"
import {ProxyServer} from "@/entityTypes/proxyType"
import {ProxyEntity} from '@/entityTypes/proxyType'
import {CookiesType} from "@/entityTypes/cookiesType"

export type SMconfig = {
  logger: winston.Logger;
  keywords: Array<string>;
  proxies: Array<ProxyServer>;
  keyword_file: string;
  proxy_file: string;
  use_proxies_only: boolean;
  custom_func: string;
  chrome_flags: Array<string>;
  puppeteer_cluster_config: {
    maxConcurrency: number;
    monitor: boolean;
    timeout: number;
  }
  random_user_agent: boolean;
  user_agent: string;
  headless: boolean;
  platform: string;
  apply_evasion_techniques?: boolean;
  block_assets?: boolean;
  test_evasion?: boolean;
  log_http_headers?: boolean;
  log_ip_address?: boolean;
  scrape_from_file?: string;
  sleep_range?: {
    min: number,
    max: number
  };
  screen_output?: boolean;
  html_output?: boolean;
  clean_html_output?: boolean;
  clean_data_images?: boolean;
  num_pages: number;
  take_screenshot_on_error?: boolean;
  search_engine_name?: string;
  is_local?: boolean;
  throw_on_detection?: boolean;
  output_file?: string;
  page_length?;number
  debug_log_path?:string;
  save_html?:boolean;
}
export type pluginType = {
  results: object,
  num_keywords: number,
  num_requests: number,
  keyword: string
}

export interface pluggableType {
  start_browser?: () => void,
  close_browser?: () => void,
  handle_results?: (result: object) => void,
  handle_metadata?: (data: MetadataType) => void,
  before_keyword_scraped?: () => void
}

export interface ScrapeOptions {
  // config: {
  //     logger: logType,
  //     search_engine?: string, keywords?: Array<string>, proxy?: string, apply_evasion_techniques?: boolean, block_assets?: boolean, test_evasion?: boolean, log_http_headers?: boolean, log_ip_address?: boolean
  // },
  config: SMconfig,
  context?: object,
  pluggable?: pluggableType,
  page?: Page,
  // browser:Browser
  // platform:string
}
// export type SMconfig = {
//     logger: { info: Function, error: Function };
//     keywords: Array<string>;
//     proxies: Array<string>;
//     keyword_file: string;
//     proxy_file: string;
//     use_proxies_only: boolean;
//     custom_func: string;
//     chrome_flags: Array<string>;
//     puppeteer_cluster_config: {
//       maxConcurrency: number;
//       monitor: boolean;
//       timeout: number;
//     }
//     random_user_agent: boolean;
//     user_agent: string;
//     headless: boolean;
//     platform: string;
//     apply_evasion_techniques?: boolean;
//     block_assets?: boolean;
//     test_evasion?: boolean;
//     log_http_headers?: boolean;
//     log_ip_address?: boolean;
//   }
export type SMstruct = {
  // the user agent to scrape with
  user_agent?: string,
  // if random_user_agent is set to True, a random user agent is chosen
  random_user_agent?: boolean,
  // whether to start the browser in headless mode
  // headless: false,
  // whether debug information should be printed
  // level 0: print nothing
  // level 1: print most important info
  // ...
  // level 4: print all shit nobody wants to know
  debug_level: number,
  // specify flags passed to chrome here
  chrome_flags?: Array<string>,
  // path to js module that extends functionality
  // this module should export the functions:
  // get_browser, handle_metadata, close_browser
  // must be an absolute path to the module
  //custom_func: resolve('examples/pluggable.js'),
  custom_func?: string,
  // use a proxy for all connections
  // example: 'socks5://78.94.172.42:1080'
  // example: 'http://118.174.233.10:48400'
  proxies?: Array<string>,
  // a file with one proxy per line. Example:
  // socks5://78.94.172.42:1080
  // http://118.174.233.10:48400
  proxy_file?: string,
  use_cluster?: boolean,
  puppeteer_cluster_config: {
    timeout: number, // max timeout set to 10 minutes
    monitor: boolean,
    concurrency?: number, // one scraper per tab
    maxConcurrency: number, // scrape with 1 tab
  },
  sleep_range?: Array<number>,
  headless: boolean,
  num_pages?: number,
  page_length?: number,
  logger?: winston.Logger,
  debug_log_path?:string,
  // taskid?: number,
  // taskrunId?: number
  save_html?:boolean,
  maxPageNumber?:number
}
export type SearchDataParam = {
  keywords: Array<string>,
  engine: string,
  num_pages?: number,
  concurrency?: number,
  notShowBrowser?: boolean,
  proxys?: Array<ProxyEntity>,
  error_log?:string,
  run_log?:string,
  debug_log_path?:string,
  //useLocalbrowserdata:boolean,
  localBrowser?:string
  accounts?:Array<number>
  cookies?: Array<Array<CookiesType>>;
}
export interface clusterData {
  page: Page
}
export interface ClusterSearchData {
  keywords: string[];
  proxyServer?: ProxyServer | null;
  cookies?: Array<CookiesType>;
}
export type ClusterFunctionparam = {
  page: Page,
  data: ClusterSearchData,
  worker: {
    id: number
  }
}
export type metadataObj = {
  http_headers?: object,
  ipinfo?: { ip: string },
  scraping_detected?: boolean | void
};
export type RunResult = {
  results: object,
  metadata: metadataObj,
  num_requests: number,
}
export type MetadataType = {
  elapsed_time?: string,
  ms_per_keyword?: string,
  num_requests?: number,
}
export type ParseObg = {
  value: Array<SearchResult>,
  screenshot: string,
  html: string
}
export type ParseType = {
  [key: number]: ParseObg
}
export type ResultParseType = {
  [key: string]: ParseType
}
export type ResultParseItemType = {
  keyword: string,
  page: number,
  results?: Array<SearchResult>
}

export type SearchResult = {
  link: string | null | undefined;
  title: string | null | undefined
  snippet: string | null | undefined;
  visible_link?: string | null | undefined;
  date?: string | null | undefined;
}
export type SearchData = {
  num_results: string,
  no_results: boolean,
  effective_query: string,
  right_info: object,
  results: Array<SearchResult>,
  top_products: [],
  right_products: [],
  top_ads: [],
  bottom_ads: [],
  // places: Array<googlePlaces>,
}

export type SearchDataRun = {
  results: ResultParseType,
  metadata: MetadataType,
}

export type SearchResEntity = {
  id?: number,
  keyword_id: number, 
  link: string, 
  title: string|null|undefined, 
  snippet: string|null|undefined, 
  visible_link: string|null|undefined
  record_time?: string|null|undefined
}
export interface SearchResEntityDisplay extends SearchResEntity {
  keyword:string, 
  index?:number
}
export type SearchResEntityRecord = {
 record:Array<SearchResEntityDisplay>
 total:number
}



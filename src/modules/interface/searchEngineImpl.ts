// import {TaskFunction} from "puppeteer-cluster/dist/Cluster"
// import { Page} from 'puppeteer';
import {
  ClusterFunctionparam,
  RunResult,
  SearchData,
} from "@/entityTypes/scrapeType";
export interface searchEngineImpl {
  // Each scraper basically iterates over a list of
  // keywords and a list of pages. This is the generic
  //  method for that
  // searchData(data: ClusterSearchData)
  scraping_loop(): void;
  build_start_url(): string;
  parse(html: string): void;
  parse_async(html: string): Promise<SearchData | void>;
  search_keyword(keywords: string): void;
  next_page(): Promise<boolean | void>;
  set_input_value(selector: string, value: string): void;
  run(param: ClusterFunctionparam): Promise<RunResult>;
  // run(data: ClusterSearchData, keywords: Array<string>)
}

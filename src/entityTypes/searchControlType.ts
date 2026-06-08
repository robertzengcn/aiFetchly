//import { CookiesType } from './commonType'
import { CookiesType } from "@/entityTypes/cookiesType";
import { ProxyEntity } from "./proxyType";
//import { SocialAccountListData } from './socialaccount-type'
export type SearchResponse = {
  status: boolean;
  msg: string;
  data: any;
};
export type Usersearchdata = {
  searchEnginer: string;
  keywords: Array<string>;
  num_pages: number;
  concurrency: number;
  notShowBrowser: boolean;
  proxys?: Array<ProxyEntity>;
  error_log?: string;
  run_log?: string;
  debug_log_path?: string;
  //useLocalbrowserdata:boolean
  localBrowser?: string;
  accounts?: Array<number>;
  // maxConcurrent: number,
  cookies?: Array<Array<CookiesType>>;
  enableAIRecovery?: boolean; // Enable AI-assisted recovery when scraper encounters errors
};
export interface UsersearchdataParam extends Usersearchdata {
  proxyIds?: Array<number>;
}
export type SearchDataParam = {
  searchEnginer: number;
  keywords: Array<string>;
};
export type SearchtaskdbEntity = {
  id: number;
  enginer_id: number;
  error_log: string;
  record_time?: string;
  status: number;
};
export type SearchtaskEntityNum = {
  total: number;
  records: Array<SearchtaskItem>;
};
export type SearchtaskItem = {
  id: number;
  enginer_name: string | undefined;
  error_log?: string;
  record_time?: string;
  keywords: Array<string>;
  keywordline?: string;
  status: string;
  pid?: number;
  result_count?: number;
};
export type SearchDetailquery = {
  taskId: number;
};

export type SearchResultFetchparam = {
  page: number;
  itemsPerPage: number;
  sortBy: string;
  search: string;
  taskId: number;
};

/** Search task status enum values (matches SearchTaskStatus in model). Used by types shared with renderer. */
export const SearchTaskStatusValue = {
  Processing: 1,
  Complete: 2,
  Error: 3,
  NotStart: 4,
} as const;
export type SearchTaskStatusValue =
  (typeof SearchTaskStatusValue)[keyof typeof SearchTaskStatusValue];

/** Task details for edit UI. Kept in entityTypes so renderer can import without pulling Node modules. */
export type TaskDetailsForEdit = {
  id: number;
  engine: number;
  engineName?: string;
  keywords: Array<string>;
  num_pages: number;
  concurrency: number;
  notShowBrowser: boolean;
  localBrowser: string;
  proxys: Array<{ host: string; port: number; user: string; pass: string }>;
  accounts: Array<number>;
  status: SearchTaskStatusValue;
  record_time: string;
  enableAIRecovery?: boolean;
};

/** Search task update payload. Kept in entityTypes so renderer can import without pulling Node modules. */
export type SearchTaskUpdateData = {
  engine?: string;
  keywords?: string[];
  num_pages?: number;
  concurrency?: number;
  notShowBrowser?: boolean;
  localBrowser?: string;
  proxys?: Array<{ host: string; port: number; user?: string; pass?: string }>;
  accounts?: number[];
  enableAIRecovery?: boolean;
};

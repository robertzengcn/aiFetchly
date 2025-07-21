//import { CookiesType } from './commonType'
import {CookiesType} from "@/entityTypes/cookiesType"
import {ProxyEntity} from './proxyType'
//import { SocialAccountListData } from './socialaccount-type'
export type SearchResponse={
    status:boolean,
    msg:string,
    data:any
}
export type Usersearchdata = {
    searchEnginer: string,
    keywords: Array<string>,
    num_pages: number,
    concurrency: number,
    notShowBrowser: boolean,
    proxys?: Array<ProxyEntity>,
    error_log?:string,
    run_log?:string,
    debug_log_path?:string,
    //useLocalbrowserdata:boolean
    localBrowser?:string
    accounts?:Array<number>
    // maxConcurrent: number,
    cookies?: Array<Array<CookiesType>>
  }
  export interface UsersearchdataParam  extends Usersearchdata{
    proxyIds?:Array<number>,
  }  
export type SearchDataParam={
    searchEnginer: number,
    keywords: Array<string>,
   
}
export type SearchtaskdbEntity = {
    id: number,
    enginer_id: number,
    error_log: string,
    record_time?: string,
    status: number
}
export type SearchtaskEntityNum = {
    total: number,
    records: Array<SearchtaskItem>
}
export type SearchtaskItem = {
    id: number,
    enginer_name: string|undefined,
    error_log?: string,
    record_time?: string,
    keywords:Array<string>,
    keywordline?:string,
    status: string,
}
export type SearchDetailquery = {
taskId: number
}

export type SearchResultFetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy: string,
    search: string
    taskId:number
}

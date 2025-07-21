import { ProxyEntity } from '@/entityTypes/proxyType'
import { EmailExtractionTypes } from "@/config/emailextraction"
import {ItemSearchparam} from "@/entityTypes/commonType"
import {ProxyServer} from "@/entityTypes/proxyType"

export type EmailscFormdata = {
  extratype: string,
  urls?: Array<string>,
  searchTaskId?: number,
  concurrency: number,
  pagelength: number,
  notShowBrowser: boolean,
  proxys?: Array<ProxyEntity>,
  processTimeout:number,
  maxPageNumber?:number 
  // maxConcurrent: number,
}
export type EmailClusterdata = {
  url: string,
  proxy?: ProxyServer|null,
  domain: string,
  maxPageLevel: number,
  visited?: Set<string>,
  maxPageNumber?:number,
  //filterEmail?: Set<string>,
  callback?: (arg: EmailResult) => void
}
export type EmailDatascraper = {
  urls: Array<string>,
  callback?: (arg: EmailResult) => void
}
export type EmailSearchData = {
  urls: Array<string>,
  proxys?: Array<ProxyEntity>,
  pageLevel: number,
  notShowBrowser: boolean
  concurrency: number,
  // callback?: (arg: EmailResult) => void
}
export type EmailResult = {
  url: string,
  pageTitle: string,
  filteredLinks: Array<string>,
  emails: Array<string>
}
export type EmailResultDisplay = {
  id:number,
  url: string,
  pageTitle: string,
  emails: Array<string>,
  recordTime: string
}
export type EmailsControldata = {
  validUrls: Array<string>,
  searchResultId?:number,
  concurrency: number,
  pagelength: number,
  notShowBrowser: boolean,
  proxys?: Array<ProxyEntity>,
  type: EmailExtractionTypes,
  processTimeout:number,
  maxPageNumber?:number
  // maxConcurrent: number,
}

export type EmailSearchResult = {
  url: string,
  email: Array<string>,
  title: string,
}
export type SearchTaskItemdisplay = {
  id: number,
  type: string,
  status: string,
  urls: Array<string>,
  email: Array<string>,
}
export interface EmailsearchTaskEntityDisplay {
  id: number,
  record_time?: string,
  typeName: string,
  statusName: string,
  urls: Array<string>,
  //urlString?:string,
}
export interface EmailsearchtaskResultquery extends ItemSearchparam{
  taskId: number
}
// export interface EmailsearchtaskResultquery extends EmailsearchTaskquery {
//   page: number,
//   size: number
// }

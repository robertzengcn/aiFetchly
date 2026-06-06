import { ProxyEntity } from "@/entityTypes/proxyType";
import { EmailExtractionTypes } from "@/config/emailextraction";
import { ItemSearchparam } from "@/entityTypes/commonType";
import { ProxyServer } from "@/entityTypes/proxyType";

// AI Enrichment Status enum
export type AiEnrichmentStatus =
  | "none"
  | "pending"
  | "completed"
  | "failed"
  | "skipped";

// AI Enrichment result data
export type EmailAiEnrichment = {
  phone?: string;
  address?: string;
  socialLinks?: Array<string>;
  status: AiEnrichmentStatus;
  error?: string;
  confidence?: number;
};

// AI candidate page for scoring
export type EmailAiCandidate = {
  url: string;
  content: string;
  title: string;
  score: number;
  contentHash: string;
};

export type EmailscFormdata = {
  extratype: string;
  urls?: Array<string>;
  searchTaskId?: number;
  concurrency: number;
  pagelength: number;
  notShowBrowser: boolean;
  proxys?: Array<ProxyEntity>;
  processTimeout: number;
  maxPageNumber?: number;
  aiSupportEnabled?: boolean;
};
export type EmailClusterdata = {
  url: string;
  proxy?: ProxyServer | null;
  domain: string;
  maxPageLevel: number;
  visited?: Set<string>;
  maxPageNumber?: number;
  aiSupportEnabled?: boolean;
  bestCandidate?: EmailAiCandidate;
  aiEnrichmentRequested?: boolean;
  aiEnrichmentResult?: EmailAiEnrichment;
  callback?: (arg: EmailResult) => void;
};
export type EmailDatascraper = {
  urls: Array<string>;
  aiSupportEnabled?: boolean;
  callback?: (arg: EmailResult) => void;
};
export type EmailSearchData = {
  urls: Array<string>;
  proxys?: Array<ProxyEntity>;
  pageLevel: number;
  notShowBrowser: boolean;
  concurrency: number;
  // callback?: (arg: EmailResult) => void
};
export type EmailResult = {
  url: string;
  pageTitle: string;
  filteredLinks: Array<string>;
  emails: Array<string>;
  aiEnrichment?: EmailAiEnrichment;
};
export type EmailResultDisplay = {
  id: number;
  url: string;
  pageTitle: string;
  emails: Array<string>;
  recordTime: string;
  phone?: string;
  address?: string;
  socialLinks?: Array<string>;
  aiEnrichmentStatus?: AiEnrichmentStatus;
  aiConfidence?: number;
};
export type EmailsControldata = {
  validUrls: Array<string>;
  searchResultId?: number;
  concurrency: number;
  pagelength: number;
  notShowBrowser: boolean;
  proxys?: Array<ProxyEntity>;
  type: EmailExtractionTypes;
  processTimeout: number;
  maxPageNumber?: number;
  aiSupportEnabled?: boolean;
};

export type EmailSearchResult = {
  url: string;
  email: Array<string>;
  title: string;
};
export type SearchTaskItemdisplay = {
  id: number;
  type: string;
  status: string;
  urls: Array<string>;
  email: Array<string>;
};
export interface EmailsearchTaskEntityDisplay {
  id: number;
  record_time?: string;
  typeName: string;
  statusName: string;
  urls: Array<string>;
  //urlString?:string,
}
export interface EmailsearchtaskResultquery extends ItemSearchparam {
  taskId: number;
}
// export interface EmailsearchtaskResultquery extends EmailsearchTaskquery {
//   page: number,
//   size: number
// }

// Email Search Task Detail for editing
export interface EmailSearchTaskDetail {
  id: number;
  searchResultId?: number;
  type_id: number;
  typeName: string;
  concurrency: number;
  pagelength: number;
  notShowBrowser: boolean;
  processTimeout: number;
  maxPageNumber: number;
  status: number;
  statusName: string;
  record_time?: string;
  urls: string[];
  proxies: ProxyEntity[];
  aiSupportEnabled: boolean;
}

// Email Search Task Update Request
export interface EmailSearchTaskUpdateRequest {
  id: number;
  data: EmailscFormdata;
}

// Email Search Task Delete Request
export interface EmailSearchTaskDeleteRequest {
  id: number;
}

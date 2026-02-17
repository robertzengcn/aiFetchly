import { EmailsearchTaskEntityDisplay } from "@/entityTypes/emailextraction-type";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import { EmailTemplateVariable } from "@/config/emailTemplateVariables";

/**
 * AI Email Template tone options
 */
export type EmailTemplateTone =
  | "formal"
  | "casual"
  | "friendly"
  | "professional";

/**
 * AI Email Template type categories
 */
export type EmailTemplateType =
  | "cold_outreach"
  | "follow_up"
  | "newsletter"
  | "promotion"
  | "custom";

/**
 * Request payload for AI email template generation
 */
export interface AIEmailTemplateRequest {
  /** User's description of desired email template (required, min 10 chars, max 500 chars) */
  prompt: string;
  /** Desired tone/style (required) */
  tone: EmailTemplateTone;
  /** Type/category of email (required) */
  templateType: EmailTemplateType;
  /** Enable knowledge base search (optional, default: false) */
  useRAG?: boolean;
  /** Max RAG results to retrieve (optional, default: 5, range: 1-20) */
  ragLimit?: number;
  /** Ignore existing content (optional, default: false) */
  startFresh?: boolean;
  /** Auto-detected: true if existing content (set by system) */
  refineMode?: boolean;
  /** Current template title for refinement (optional) */
  existingTitle?: string;
  /** Current template content for refinement (optional) */
  existingContent?: string;
}

/**
 * Response from AI email template generation
 */
export interface AIEmailTemplateResponse {
  /** Generated email subject line */
  title: string;
  /** Generated email body content */
  content: string;
  /** Optional description of generated template */
  description?: string;
  /** List of variables used in template */
  variablesUsed: EmailTemplateVariable[];
  /** True if invalid variables were found and removed */
  hasInvalidVariables: boolean;
  /** List of invalid variable names that were removed */
  invalidVariables: string[];
  /** Generation status */
  status: "success" | "partial" | "error";
  /** Error or status message */
  message?: string;
}

/**
 * Streaming event types for AI email template generation
 */
export interface AIEmailTemplateChunkEvent {
  type: "chunk";
  content: string;
  fullContent: string;
}

export interface AIEmailTemplateCompleteEvent {
  type: "complete";
  status: boolean;
  data: AIEmailTemplateResponse;
}

export interface AIEmailTemplateErrorEvent {
  type: "error";
  status: false;
  msg: string;
  data: null;
}

export interface AIEmailTemplateStopEvent {
  type: "stop";
}

export type AIEmailTemplateStreamEvent =
  | AIEmailTemplateChunkEvent
  | AIEmailTemplateCompleteEvent
  | AIEmailTemplateErrorEvent
  | AIEmailTemplateStopEvent;

/**
 * Validation result for AI request/output
 */
export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  invalidVariables?: string[];
  sanitizedContent?: string;
}

export type EmailsTemplagedata = {
  TplTitle: string;
  TplContent: string;
  Status?: number;
};
export type EmailTemplateRespdata = {
  Index?: number;
  TplId?: number;
  TplTitle: string;
  TplContent: string;
  TplDescription?: string;
  TplRecord?: string;
  Status?: number;
};
export type EmailTemplatePreviewdata = {
  TplTitle: string;
  TplContent: string;
  Sender: string;
  Receiver: string;
  Url?: string;
  Description?: string;
  // NEW: Extended variable support fields
  ReceiverName?: string;
  CompanyName?: string;
  CampaignName?: string;
};
export type EmailTemplatedata = {
  TplId?: number;
  TplTitle: string;
  TplContent: string;
  TplDescription?: string;
};
export type EmailFilterdata = {
  id?: number;
  name: string;
  description: string;
  filter_details: Array<EmailFilterDetialdata>;
  created_time: string;
};
export type EmailFilterDetialdata = {
  id?: number;
  content: string;
};
export type EmailServiceEntitydata = {
  id?: number;
  from: string;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
};
export type EmailServiceListdata = {
  id: number;
  name: string;
  from: string;
  host: string;
  create_time: string;
};
export type EmailMarketingsubdata = {
  sourceType: number;
  emailtaskentityId?: number;
  EmailTemplateslist: Array<number>;
  EmailFilterlist: Array<number>;
  EmailServicelist: Array<number>;
  NotDuplicate: boolean;
};
export type EmailItem = {
  title?: string;
  address: string;
  source: string;
};
export type Buckemailstruct = {
  EmailBtype: BuckEmailType; //email source type
  EmailtaskentityId?: number;
  //EmailList:Array<EmailItem>
  EmailTemplateslist: Array<number>;
  EmailFilterlist: Array<number>;
  EmailServicelist: Array<number>;
  NotDuplicate: boolean;
};
export type Buckemailremotedata = {
  Receiverlist: Array<EmailItem>;
  Emailtemplist: Array<EmailTemplateRespdata>;
  Emailfilterlist: Array<EmailFilterdata>;
  Emailservicelist: Array<EmailServiceEntitydata>;
};
// export type BuckemailPreparedata={
//     Emailtemplist: Array<EmailTemplateRespdata>
//     Emailfilterlist: Array<EmailFilterdata>
//     Emailservicelist: Array<EmailServiceEntitydata>
// }
export type EmailSendResult = {
  receiver: string;
  status: boolean;
  title: string;
  content: string;
  info?: string;
};
export type EmailSendParam = {
  Setting: EmailServiceEntitydata;
  EmailRequestData: EmailRequestData;
};
export type EmailRequestData = {
  From: string;
  Receiver: string;
  Title: string;
  Content: string;
};

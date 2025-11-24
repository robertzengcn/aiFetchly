//import { computed} from 'vue'

export enum LanguageName {
  ENGLISH = 'English',
  SPANISH = 'Spanish',
  FRENCH = 'French',
  GERMAN = 'German',
  CHINESE = 'Chinese',
  JAPANESE = 'Japanese',
  KOREAN = 'Korean',
  RUSSIAN = 'Russian',
  PORTUGUESE = 'Portuguese',
  ITALIAN = 'Italian'
}

export enum LanguageCode {
  EN = 'en',
  ES = 'es',
  FR = 'fr',
  DE = 'de',
  ZH = 'zh',
  JA = 'ja',
  KO = 'ko',
  RU = 'ru',
  PT = 'pt',
  IT = 'it'
}

export type PageSearch={
    page:number,
    size:number
}
export interface CommonResponse <Type>{
    status: boolean
    msg: string
    data?: ListData<Type>|null
}
export interface ListData <Type>{
    records: Array<Type>
    num: number
}
//message used in layout dialog
export type CommonDialogMsg={
    status:boolean,
    code:number,
    msg?:string,
    data?:{
        action?:string,  
        title:string,
        content:string
    }
}
export interface CommonMessage <Type>{
    status: boolean
    msg: string
    data?: Type
}
export interface NumProcessdata{
    // total:number,
    // num:number,
    process:number
}
export type SortBy={
    key:string
    order:string
}
export type CookiesType={
name: string
value: string
domain: string
path: string
}
export type ItemSearchparam={
    page:number
    size:number
    where?:string
    sortby?:SortBy
    search?:string
}
export interface CommonApiresp <Type>{
    status: boolean
    code:number
    msg: string 
    data?: Type
}
export interface CommonIdrequest<Type>{
    id:Type
}
export interface CommonIdrequestType<Type> extends CommonIdrequest<Type>{
    type:string
}
export type Header = {
    title: string
    align?: "start" | "center" | "end" | undefined;
    sortable: boolean;
    key: string;
    width?: string;
    value?:any;
};
export type VslotHeader = {
    step: number;
    title:string
    rules?:	any;
     valid: boolean
}
export enum TaskStatus {
    Notstart = 0,
    Processing = 1,
    Complete = 2,
    Error = 3,
    Cancel = 4
  }
  export interface CommonIdrequestIds<Type> {
   ids:Array<Type>,
}
export type LanguageItem={
    id:number,
    name:LanguageName
    code:LanguageCode
}
export enum InputTypeEnum {
    INPUT = 'input',
    SELECT = 'select',
    RADIO = 'radio',
    CHECKBOX = 'checkbox'
  }
export type LlmCongfig={
    model:string,
    url?:string,
    apikey?:string,
}

export interface ChunkAndEmbedResponse {
    documentId: number;
    chunksCreated: number;
    embeddingsGenerated: number;
    processingTime: number;
    success: boolean;
    steps: {
        chunking: boolean;
        embedding: boolean;
    };
    chunkingResult?: {
        chunksCreated: number;
        processingTime: number;
        message: string;
    };
    embeddingResult?: {
        chunksProcessed: number;
        processingTime: number;
        message: string;
    };
}  
export type TraditionalTranslateCongfig={
    url:string,
    apikey:string,
}  
export type SettingGroup={
    name:string,
}
export type LlmDatatype={
     groupName:string,
        modelName:string,
        url:string,
        apikey:string
}
export type NativateDatatype={
    path:string
}

// RAG Configuration Types

/**
 * Configuration for embedding models
 */
export interface EmbeddingConfig {
    model: string;
    dimensions?: number;
    maxTokens?: number;
    timeout?: number;
    retries?: number;
}

// AI Chat Types

/**
 * Message type enum for AI chat messages
 */
export enum MessageType {
    MESSAGE = 'message',
    TOOL_CALL = 'tool_call',
    TOOL_RESULT = 'tool_result'
}

/**
 * Chat message interface
 */
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    conversationId?: string;
    messageType?: MessageType;
    metadata?: Record<string, unknown>;
}

/**
 * Chat history response
 */
export interface ChatHistoryResponse {
    messages: ChatMessage[];
    totalMessages: number;
    conversationId: string;
}

/**
 * Chat stream chunk
 */
export interface ChatStreamChunk {
    content: string;
    isComplete: boolean;
    messageId?: string;
    eventType?: string;
    toolName?: string;
    toolParams?: Record<string, unknown>;
    toolId?: string;
    toolResult?: Record<string, unknown>;
    errorMessage?: string;
    conversationId?: string;
}

/**
 * Chat response from remote API
 */
export interface ChatApiResponse {
    message: string;
    conversationId: string;
    messageId: string;
    model: string;
    tokensUsed?: number;
}

export interface ConfigurationResponse {
    success: boolean;
    data: any;
    metadata?: {
        version: string;
        lastUpdated: string;
        ttl: number;
        autoSelected: boolean;
        selectionReason?: string;
    };
}

export interface ConfigurationError {
    code: string;
    message: string;
    details?: any;
}

// File Upload Response Types
export interface UploadedDocument {
    id: number;
    name: string;
    title: string;
    description?: string;
    tags?: string[];
    author?: string;
    filePath: string;
    fileSize?: number;
    fileType?: string;
    uploadDate?: string;
    status: string;
    processingStatus?: string;
    log?: string; // Error log file path
}

export interface SaveTempFileResponse {
    tempFilePath: string;
    databaseSaved: boolean;
    databaseError?: string | null;
    document?: UploadedDocument;
}

export interface DocumentUploadResponse {
    documentId: number;
    chunksCreated: number;
    processingTime: number;
    document: UploadedDocument;
}

// RAG Statistics Types
export interface RagSearchStats {
    totalDocuments: number;
    totalChunks: number;
    indexSize: number;
    averageChunkSize: number;
    embeddingModel: string;
    embeddingProvider: string;
}

export interface RagStatsResponse extends RagSearchStats {
    defaultEmbeddingModel: string | null;
}

// Re-export metadata types for convenience
export * from './metadataType';

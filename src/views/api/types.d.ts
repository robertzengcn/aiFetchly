'use strict';
export {};

export type Itemlistparam={
    page:number
    size:number
   
}
// export interface SearchResult{
//     data:any
//     total:number
// }
export interface SearchResult<Type>{
    data:Array<Type>
    total:number
}
export type SocialaccountResult={
    records:any
    total:number
}
export type IUserData ={
    id: number
    name: string
    email: string
    role: Array<string>
    token: string
}
export type Iresponse ={
    status: boolean
    msg: string
    data?: any
}

// Search Task Edit Types
export interface UpdateSearchTaskData {
    engine?: string;
    keywords?: string[];
    num_pages?: number;
    concurrency?: number;
    notShowBrowser?: boolean;
    localBrowser?: string;
    proxys?: Array<{
        host: string;
        port: number;
        user?: string;
        pass?: string;
    }>;
    accounts?: number[];
}

export interface SearchTaskDetails {
    id: number;
    engine: string;
    keywords: string[];
    num_pages: number;
    concurrency: number;
    notShowBrowser: boolean;
    localBrowser: string;
    proxys: Array<{
        host: string;
        port: number;
        user?: string;
        pass?: string;
    }>;
    accounts: number[];
    status: number;
    record_time: string;
}

export interface SearchTaskUpdateResponse {
    status: boolean;
    msg: string;
    taskId?: number;
}

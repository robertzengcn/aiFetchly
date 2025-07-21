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

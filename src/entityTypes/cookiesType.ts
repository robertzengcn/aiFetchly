export interface CookiesType{
    domain:string;
    flag: boolean;
    path?:string;
    secure:boolean;
    expirationDate:number,
    hostOnly?:boolean,
    httpOnly?:boolean,
    session?:boolean,  
    name:string,
    value:string,
    sameSite?: ('unspecified' | 'no_restriction' | 'lax' | 'strict'|'None');
}
export type RequireCookiesParam={
 id:number
}
export type RequireCookiesMsgbox={
    id:number;
    platform:string;
}
export type CookiesParse={
url: string;
name: string;
value: string;
domain?: string;
path: string|undefined;
secure: boolean;
httpOnly: boolean;
expirationDate: number
sameSite?: ('unspecified' | 'no_restriction' | 'lax' | 'strict');
hostOnly: boolean|undefined;
}
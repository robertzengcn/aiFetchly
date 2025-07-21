import {Proxy} from "@/entityTypes/proxyType";
export type SocialAccountResponse = {
    status: string,
    msg: string,
    data: {
        total: number,
        records?:SocialAccountListData[]
    },
}
export type SocialAccountDetailResponse = {
    status: string,
    msg: string,
    data: SocialAccountDetailData
}
export type SocialAccountListData={
    id: number,
    social_type: string,
    social_type_id: number,
    user: string,
    pass:string,
    status: number,
    use_proxy: number,
    cookies?:boolean
}
export type SocialAccountDetailData={
    id?: number,
    social_type?: string,
    social_type_id?: number,
    social_type_url?:string,
    user: string,
    pass:string,
    status: number,
    name: string,
    phone: string,
    email: string, 
    proxy: Array<Proxy>
}
export type SavesocialaccountResp={
    status: boolean,
    msg: string,
    data: SoASuccessEntity
}
export type SoASuccessEntity={
    id: number,
}
export type SoADeleteResp={
    status: boolean,
    msg: string,
}
export type SocialLoginParam={
    id: number
}


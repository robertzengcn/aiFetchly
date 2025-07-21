import { EmailsearchTaskEntityDisplay } from '@/entityTypes/emailextraction-type'
import {BuckEmailType} from "@/model/buckEmailTaskdb"
export type EmailsTemplagedata = {
    TplTitle:string
    TplContent:string
    Status?:number
}
export type EmailTemplateRespdata={
    Index?:number
    TplId?:number
    TplTitle:string
    TplContent:string
    TplDescription?:string
    TplRecord?:string
    Status?:number
}
export type EmailTemplatePreviewdata={
    TplTitle:string
    TplContent:string
    Sender:string
    Receiver:string
    Url?:string
    Description?:string
}
export type EmailTemplatedata={
    TplId?:number
    TplTitle:string
    TplContent:string
    TplDescription?:string
}
export type EmailFilterdata={
    id?:number
    name:string
    description:string
    filter_details:Array<EmailFilterDetialdata>
    created_time:string
}
export type EmailFilterDetialdata={
    id?:number
    content:string
}
export type EmailServiceEntitydata={
    id?: number
    from: string
    password: string
    host: string
    port: string
    name: string
    ssl: number
}
export type EmailServiceListdata={
    id:number
    name: string
    from: string
    host: string
    create_time: string
}
export type  EmailMarketingsubdata={
    sourceType:number
    emailtaskentityId?:number
    EmailTemplateslist:Array<number>
    EmailFilterlist:Array<number>
    EmailServicelist:Array<number>
    NotDuplicate:boolean
}
export type EmailItem={
    title?:string
    address:string
    source:string
}
export type Buckemailstruct={
    EmailBtype:BuckEmailType //email source type
    EmailtaskentityId?:number
    //EmailList:Array<EmailItem>
    EmailTemplateslist:Array<number>
    EmailFilterlist:Array<number>
    EmailServicelist:Array<number>
    NotDuplicate:boolean
}
export type Buckemailremotedata={
    Receiverlist:Array<EmailItem>
    Emailtemplist: Array<EmailTemplateRespdata>
    Emailfilterlist: Array<EmailFilterdata>
    Emailservicelist: Array<EmailServiceEntitydata>
}
// export type BuckemailPreparedata={
//     Emailtemplist: Array<EmailTemplateRespdata>
//     Emailfilterlist: Array<EmailFilterdata>
//     Emailservicelist: Array<EmailServiceEntitydata>
// }
export type EmailSendResult={
    receiver:string
    status:boolean
    title:string
    content:string
    info?:string
}
export type EmailSendParam={
    Setting:EmailServiceEntitydata
    EmailRequestData:EmailRequestData
}
export type EmailRequestData={
    From:string
    Receiver:string
    Title:string
    Content:string
}


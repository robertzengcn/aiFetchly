import { ItemSearchparam } from "@/entityTypes/commonType"
export type BuckEmailListType={
    TaskId: number;
    Type:String;
    Status:String;
    RecordTime?: string;
}
export interface BuckEmailTasklogQueryType extends ItemSearchparam{
    TaskId: number;
}

export interface EmailMarketingSendLogListDisplay {
    id: number;
    status:string;
    receiver: string;
    title: string;
    // content: string;
    record_time?: string;
}
export interface EmailMarketingSendLogDetailDisplay {
    id: number;
    status:string;
    receiver: string;
    title: string;
    content: string;
    record_time?: string;
}



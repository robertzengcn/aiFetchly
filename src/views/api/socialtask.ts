import {windowInvoke,windowSend,windowReceive} from '@/views/utils/apirequest'
import {SocialTaskEntity,TagEntity} from '@/entityTypes/socialtask-type'
import {TaskRunEntity} from '@/entityTypes/taskrun-type'

export type TaskQuery={
    id:number
    page:number
    size:number
    sortby:string
    search:string
}
export type SocialTasktype={
    id:number,
    name:string,
}
export type SocialListresp={
    data:Array<SocialTaskEntity>,
    total:number,
}
export type TaskRunlistQuery={
    id:number
    page:number
    size:number
}

export type TaskinfoQuery={
    id:number
}
export type Socialtaskresp={
    id:number
}
export type Taskrunresp={
    data:Array<TaskRunEntity>,
    total:number,
}


export async function getSocialtasklist(data: TaskQuery):Promise<SocialListresp>{
    const resp=await windowInvoke('socialtask:list',data);
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    // if(!resp.status){
    //   throw new Error(resp.msg)
    // }

    const resdata:SocialListresp={
            data:resp.Records,
            total:resp.Total,
    }
    return resdata; 
}
//get social task info
export async function getSocialtaskinfo(data: TaskinfoQuery):Promise<SocialTaskEntity>{
    const resp=await windowInvoke('socialtask:info',data);
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    
    return resp as SocialTaskEntity; 
}

//get social type list
export async function getSocialtasktype():Promise<Array<SocialTasktype>|null>{
    const resp=await windowInvoke('socialtasktype:list');   
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    
    return resp as Array<SocialTasktype>; 
}

// get tag list
export async function getTaglist():Promise<Array<TagEntity>|null>{
    const resp=await windowInvoke('tag:list');   
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    
    return resp as Array<TagEntity>; 
}
//save social task
export async function saveSocialTask(data: SocialTaskEntity): Promise<Socialtaskresp> {
    const resp=await windowInvoke('socialtask:save',data);   
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    
    return resp as Socialtaskresp; 
}
export function startSocialTask(taskId:number,taskrunNum:string){
    windowSend('socialtask:start',{id:taskId,runNum:taskrunNum})
}
export function receiveSocialTaskLog(channel:string,cb:(data:any)=>void){
    windowReceive('socialtask:log:'+channel,cb)
}
export async function getTaskrunlist(data:TaskRunlistQuery):Promise<Taskrunresp>{
    const resp=await windowInvoke('socialtaskrun:list',data); 
    console.log(resp)
    //  return resp as Array<TaskRunEntity>;
    const resdata:Taskrunresp={
        data:resp.Records,
        total:resp.Total,
    }
    return resdata; 
}
//get result list query
export async function getTaskresultlist(data:TaskRunlistQuery):Promise<Taskrunresp>{
    const resp=await windowInvoke('socialtaskresult:list',data); 
    console.log(resp)
    //  return resp as Array<TaskRunEntity>;
    const resdata:Taskrunresp={
        data:resp.Records,
        total:resp.Total,
    }
    return resdata; 
}

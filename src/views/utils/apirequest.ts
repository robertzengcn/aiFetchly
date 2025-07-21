type Iresponse ={
    status: boolean
    msg: string
    data?: any
}

export const windowInvoke=async(channel:string,data?:object)=>{
    // console.log(data)
    // campaign:list
    const result =await window.api.invoke(channel, JSON.stringify(data)); 
    if(!result){
        throw new Error("unknow error")
    }
    // console.log(result)
    if(!result.status){
        throw new Error(result.msg)
    }
    return result.data; 
}
//send async message
export const windowSend=async(channel:string,data?:object)=>{
    window.api.send(channel, JSON.stringify(data)); 
}
//receive async message
export const windowReceive=(channel:string,cb:(value:any)=>void)=>{
    window.api.receive(channel, (evnet) => {
        console.log(evnet)
        //console.log(evnet.data)
        cb(evnet)
    })
}
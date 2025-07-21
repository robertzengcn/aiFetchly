"use strict";
export {};
import {ProcessMessage} from "@/entityTypes/processMessage-type"
import {Buckemailremotedata,EmailSendResult} from "@/entityTypes/emailmarketingType"
import {EmailSend} from "@/childprocess/emailSend"
process.parentPort.on('message', async (e) => {
    const [port] = e.ports
    const pme=JSON.parse(e.data) as ProcessMessage<Buckemailremotedata>
    switch(pme.action){
        case "sendEmail": {
            const emailsendModel=new EmailSend()
            if(!pme.data){
                console.error("data is null")
                return 
            }
            await emailsendModel.send(pme.data,(receiver,title,content)=>{
                const senddata:EmailSendResult={
                    receiver:receiver,
                    status:true,
                    title:title,
                    content:content
                }
                const message:ProcessMessage<EmailSendResult>={
                    action:"EmailSendSuccess",
                    data:senddata
                }
                port.postMessage(JSON.stringify(message))
            },(receiver,info,title,content)=>{
                const senddata:EmailSendResult={
                    receiver:receiver,
                    status:false,
                    info:info,
                    title:title,
                    content:content
                }
                const message:ProcessMessage<EmailSendResult>={
                    action:"EmailSendFailure",
                    data:senddata
                }
                port.postMessage(JSON.stringify(message))
            }).then(()=>{
                const message:ProcessMessage<null>={
                    action:"sendEmailEnd",
                   
                }
                port.postMessage(JSON.stringify(message))
            })

        }
    }
})
"use strict";
export {};
import {Usersearchdata} from "@/entityTypes/searchControlType"
import {UserSearch} from "@/childprocess/userSearch"
// import { resolveCname } from "node:dns";
import {ProcessMessage} from "@/entityTypes/processMessage-type"
import {ResultParseItemType} from "@/entityTypes/scrapeType"

//             // const data=parameter[3]
//             // if(!parameter){
//             //     throw new Error("parameter is empty")
//             // }
//             // const userSearchdata:Usersearchdata=JSON.parse(data)

//             // console.log(userSearchdata)
//             // const userSearchdata:Usersearchdata={
//             //     searchEnginer: 1,
//             //     keywords: ['test'],
//             //     num_pages: 1,
//             //     concurrency: 1,
//             //     notShowBrowser: false
//             // }
//             // const userSer=new UserSearch()
//             // await userSer.searchData(userSearchdata)
            
            
//             break;
//         }
//     }
// }
//const input=process.argv
// runCommand(argv);
const userSer=new UserSearch()

// process.parentPort is available in Worker Threads
const parentPort = (process as unknown as { parentPort?: { on: (event: string, handler: (e: { data: string; ports?: MessagePort[] }) => void) => void; postMessage: (message: string) => void } }).parentPort;
if (parentPort) {
  parentPort.on('message', async (e) => {
    const ports = e.ports || [];
    const [port] = ports;
    // console.log("get parent message")
    // console.log(e)
    const pme=JSON.parse(e.data) as ProcessMessage<Usersearchdata>
    switch(pme.action){
       
            // Surround the case block with braces
            case "searchscraper": {
                const userSearchdata=pme.data as Usersearchdata;
                if(!userSearchdata){
                    console.log("data is empty")
                    return
                }
                
                    //console.log(res)
                   
                    await userSer.searchData(userSearchdata,function(result){
                        console.log(result)
                        const message:ProcessMessage<ResultParseItemType>={
                            action:"saveres",
                            data:result
                        }
                        parentPort.postMessage(JSON.stringify(message))
                    })
                    //console.log(port)
                    //process.parentPort.postMessage(JSON.stringify(message))
                //});
                break;
            }

    }
  })
}
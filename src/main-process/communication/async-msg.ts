import { ipcMain } from 'electron';
import { SocialTask } from '@/modules/socialtask';
//import { SocialAccountController } from '@/controller/socialaccount-controller';

// import { ProxyController } from '@/controller/proxy-controller';

type dataResponse = {
    status: boolean,
    code: number,
    msg: string,
    data?: any
}
export default function AsyncMsg() {
    console.log("AsyncMsg");
    ipcMain.on('socialtask:start', async (event, data) => {
        console.log("get social task data")

        const qdata = JSON.parse(data);
        if (!("id" in qdata)) {
            throw new Error("id not found");
        }

        if (!("runNum" in qdata)) {
            throw new Error("runNum not found");
        }
        const socialtaskcon = new SocialTask()


        const result = await socialtaskcon.createsocialtask(qdata.id, qdata.runNum).catch(function (error) {
            console.log(error.message)
            return null;
        });

        if (!result) {
            const sendRes: dataResponse = {
                status: false,
                code: 20240322143237,
                msg: "start social task failed"
            }
            event.sender.send('socialtask:start', JSON.stringify(sendRes))
        } else {
            const successRes: dataResponse = {
                status: true,
                code: 0,
                msg: result.taskrun_num
            }
            event.sender.send('socialtask:start', JSON.stringify(successRes))
        }
        //run task
        if (result) {
            socialtaskcon.runsocialtask(result, function (res) {

                event.sender.send('socialtask:log:' + qdata.runNum, JSON.stringify(res))
            })
        }
    })
    
}

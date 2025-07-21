import url from "url"
//import request from "@/modules/lib/request"
import { SocialTaskRun } from "@/modules/socialtaskrun"
//import { spawn } from 'node:child_process';
// import { Worker } from 'worker_threads';
// const os = require("os");
import { SocialTaskEntity, SocialTaskResponse, SocialTaskInfoResponse, SocialTaskTypeResponse, SaveSocialTaskResponse, TagResponse, SocialTaskRunEntity } from "@/entityTypes/socialtask-type"
import { utilityProcess, MessageChannelMain} from "electron";
import * as path from 'path';
// import { spawn } from 'node:child_process';
import * as fs from 'fs';
import { HttpClient } from "@/modules/lib/httpclient"
// const fileLocation = path.join(__static, 'myText.txt')
export class SocialTask {
    private _httpClient: HttpClient
    //construct
    constructor() {
        this._httpClient=new HttpClient()
    }
    /**
    * get social task from remote servive
    */
    async getTaskbycampagin(campaignId: number, page: number, size: number): Promise<SocialTaskResponse | null> {
        const queryParams = new URLSearchParams({ "campaiginId": campaignId.toString(), "page": page.toString(), "size": size.toString() })
        const params = new url.URLSearchParams(queryParams);

        const tasklistres = await this._httpClient.get(
            '/api/listsotask?' + params
        ).catch(function (error) {
            throw new Error(error.message);
            // console.error(error);
        })
        if (!tasklistres) {
            throw new Error("remote return social task is null");
        }
        // console.log("campaign list is following")
        // console.log(campignlistres.data)
        // const resp: SocialTaskResponse = {
        //     status: campignlistres.data.status,
        //     msg: campignlistres.data.msg,
        //     data: campignlistres.data.data,
        // }
        return tasklistres as SocialTaskResponse
    }

    /**
     * get social task info by task id
     */
    async getTaskbyid(taskId: number): Promise<SocialTaskInfoResponse | null> {
        const queryParams = new URLSearchParams({ "task_id": taskId.toString() })
        const params = new url.URLSearchParams(queryParams);

        const taskinfores = await this._httpClient.get(
            '/api/getsocialtaskinfo?' + params,
        ).catch(function (error) {
            throw new Error(error.message);
            // console.error(error);
        })
        if (!taskinfores) {
            throw new Error("remote return social task is null");
        }
        // console.log("campaign list is following")
        // console.log(campignlistres.data)
        // const resp: SocialTaskResponse = {
        //     status: campignlistres.data.status,
        //     msg: campignlistres.data.msg,
        //     data: campignlistres.data.data,
        // }
        return taskinfores as SocialTaskInfoResponse
    }
    //get social task type list
    async getTasktype(): Promise<SocialTaskTypeResponse | null> {
        const tasktyperes = await this._httpClient.get(
          '/api/socialtasktype',
        ).catch(function (error) {
            throw new Error(error.message);
            // console.error(error);
        })
        if (!tasktyperes) {
            throw new Error("remote return social task type is null");
        }

        return tasktyperes as SocialTaskTypeResponse
    }

    //get tag list
    async getTaglist(): Promise<TagResponse> {
        const tagres = await this._httpClient.get(
        '/api/tag',
        ).catch(function (error) {
            throw new Error(error.message);
            // console.error(error);
        })
        if (!tagres) {
            throw new Error("remote return tag is null");
        }

        return tagres as TagResponse
    }
    //save social task
    async saveSocialTask(data: SocialTaskEntity): Promise<SaveSocialTaskResponse> {


        let formData = new FormData();
        // Object.entries(data).forEach(([key, value]) => {
        //     formData.append(key, String(value));
        // });
        if (data.id) {
            formData.append("socialtask_id", String(data.id));
        }
        formData.append("campaign_id", String(data.campaign_id));
        formData.append("task_name", String(data.task_name));
        formData.append("type_id", String(data.type_id));
        if (data.tag) {
            formData.append("tags[]", String(data.tag));
        }
        if (data.keywords) {
            formData.append("keywords[]", String(data.keywords));
        }

        const tasktyperes = await this._httpClient.post(
           '/api/savesocialtask',
           formData,
        ).catch(function (error) {
            throw new Error(error.message);
            // console.error(error);
        })
        if (!tasktyperes) {
            throw new Error("remote return social task type is null");
        }

        return tasktyperes as SaveSocialTaskResponse
    }

    async createsocialtask(socailtaskId: number,taskRunNum:string): Promise<SocialTaskRunEntity> {
        const runModel = new SocialTaskRun()
        const socialTaskrun = runModel.createsocialtaskrun(socailtaskId,taskRunNum)
        // const result = await this.runsocialtask(socialTaskrun)
        return socialTaskrun
    }

    public async runsocialtask(entity: SocialTaskRunEntity,callback:Function|undefined|null) {
        const childPath = path.join(__dirname, 'taskCode.js')
        if (!fs.existsSync(childPath)) {
            throw new Error("child js path not exist for the path " + childPath);
        }
        const { port1, port2 } = new MessageChannelMain()

        const child = utilityProcess.fork(childPath, ['-a','runtask','-t',entity.taskrun_num],{stdio:"pipe",execArgv:["puppeteer-cluster:*"],env:{
            ...process.env,
            NODE_OPTIONS: ""  
        }} )
        //console.log(path.join(__dirname, 'utilityCode.js'))
        
        // child.postMessage({ message: 'hello' }, [port1])
        child.on("spawn", () => {
            
            child.postMessage({ message: 'hello' }, [port1])
        })
        child.stdout?.on('data', (data) => {
            console.log(`Received data chunk ${data}`)
            if(callback){
                callback(data.toString())
            }
        })
        child.stderr?.on('data', (data) => {
            console.log(`Received error chunk ${data}`)
            if(callback){
                callback(data.toString())
            }
        })
        child.on("exit", () => {
            console.log(`child process exited `)
        })

        port2.on("message", (e) => {
            console.log("port receive:", e.data);
            port2.postMessage("I receive your messages:")
        })
        port2.start()
        child.on("message", (e) => {
            console.log("接收到消息了：", e);
        })

    }
}
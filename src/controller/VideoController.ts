
import { VideoDownloadTaskEntityType, processVideoDownloadParam, CookiesProxy, VideoCompotionEntity, VideoCaptionGenerateParam, VideoCaptionDisplay, VideoTranslateItem, VideoPublishMsg } from "@/entityTypes/videoType";
import { VideoDownloadModule } from "@/modules/VideoDownloadModule"
import { VideoDownloadTaskModule } from "@/modules/VideoDownloadTaskModule"
//import { Token } from "@/modules/token"
import * as path from 'path';
import * as fs from 'fs';
import { utilityProcess, MessageChannelMain } from "electron";
//import { USERLOGPATH, USEREMAIL } from '@/config/usersetting';
import { WriteLog, getApplogspath, getRandomValues, removeParamsAfterAmpersand, readLogFile } from "@/modules/lib/function"
//import { v4 as uuidv4 } from 'uuid';
// import { CustomError } from '@/modules/customError'
import { AccountCookiesModule } from "@/modules/accountCookiesModule"
//import { SocialAccountApi } from "@/api/socialAccountApi"
import { ProcessMessage } from "@/entityTypes/processMessage-type"
// import {VideodownloadMsg} from "@/entityTypes/videoType";
import { LanguageCode, ListData, TaskStatus } from "@/entityTypes/commonType"
import { VideoDescriptionEntity } from "@/entity/VideoDescription.entity"
import { VideoDownloadStatus, VideodownloadTaskMsg, VideoDownloadListDisplay, VideodownloadMsg, DownloadVideoControlparam, DownloadType, CookiesType, VideoCaptionItem, VideoCaptionMsg, VideoCaptionStatus, VideoCaptionGenerateParamWithIds, VideoInformationTransParam } from "@/entityTypes/videoType"
import { VideoDownloadTaskDetailEntity } from "@/entity/VideoDownloadTaskDetail.entity"
import { VideoDescriptionModule } from "@/modules/videoDescriptionModule"
//import { Video } from '@/modules/interface/Video';
import { VideoDownloadTaskDetailModule } from '@/modules/VideoDownloadTaskDetailModule';
import { VideoDownloadTaskAccountsModule } from "@/modules/VideoDownloadTaskAccountsModule"
//import { VideoDownloadTaskAccountEntity } from "@/entityTypes/videoType"
import { VideoDownloadTaskUrlModule } from "@/modules/VideoDownloadTaskUrlModule"
import { VideoDownloadTaskProxyModule } from "@/modules/VideoDownloadTaskProxyModule"
import { Proxy } from "@/entityTypes/proxyType"
//import { ProxyApi } from "@/api/proxyApi"
import { shell } from "electron"
//import { VideoCaptionFactory } from "@/modules/videoCaption/VideoCaptionFactory"
import { CustomError } from '@/modules/customError'
import { VideoCaptionModule } from "@/modules/VideoCaptionModule"
// import { LanguageEnum } from "@/config/generate"
// import {LanguageItem} from "@/entityTypes/commonType"
import { ExtraModuleController } from "@/controller/extramoduleController"
//import { getLanaugebyid } from "@/modules/lib/function"
import { VideoDownloadTagModule } from "@/modules/VideoDownloadTagModule"
// import { Worker } from "worker_threads";
import { TransItemsParam } from "@/entityTypes/translateType"
import { TranslateProducer } from "@/modules/TranslateProducer"
import { LlmCongfig, TraditionalTranslateCongfig, CommonMessage } from '@/entityTypes/commonType'
import { TranslateController } from "@/controller/TranslateController"
import { getLanaugebyCode } from "@/modules/lib/function"
//import { VideoDownloadTaskKeywordEntity } from "@/entity/VideoDownloadTaskKeyword.entity"
import { VideoDownloadTaskKeywordModule } from "@/modules/VideoDownloadTaskKeywordModule"
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity";
import { VideoDownloadTaskAccountsEntity } from "@/entity/VideoDownloadTaskAccounts.entity";
import { VideoDownloadTaskEntity } from "@/entity/VideoDownloadTask.entity"
import {VideoPublishService} from "@/service/VideoPublishService"
import {VideoDownloadEntityType} from "@/entityTypes/videoType"
import { VideoDownloadTaskUrlsEntity } from "@/entity/VideoDownloadTaskUrls.entity";
import { PublishOptions } from "@/strategy/VideoPublishStrategy";
import { PublishPlatform, VideoPublishParam, PublishRecordQuery } from "@/entityTypes/videoPublishType";
import {VideoPublishPlatformConfig} from "@/config/videosetting"
import { VideoCaptionEntity } from "@/entity/VideoCaption.entity"
import {VideoPublishModule} from "@/modules/VideoPublishModule"
import { VideoPublishRecordEntity } from '@/entity/VideoPublishRecord.entity';

export class VideoController {
    private videoDownloadModule: VideoDownloadModule
    private videoDownloadTaskModule: VideoDownloadTaskModule
    private accountCookiesModule: AccountCookiesModule
    //private socialAccountApi: SocialAccountApi
    private videoDescriptionModule: VideoDescriptionModule
    private videoDownloadTaskDetailModule: VideoDownloadTaskDetailModule
    private videoDownloadTaskAccountsModule: VideoDownloadTaskAccountsModule
    private videoDownloadTaskUrlModule: VideoDownloadTaskUrlModule
    //private videoDownloadTaskProxyModule: VideoDownloadTaskProxyModule
    private videoCaptionModule: VideoCaptionModule
    private videoDownloadTagModule: VideoDownloadTagModule
    private videoDownloadTaskKeywordModule: VideoDownloadTaskKeywordModule
    private videoPublishModule: VideoPublishModule
    // private videoDownloadTagModel:VideoDownloadTagModel
    constructor() {
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)

        // if (!dbpath) {
        //     throw new Error("user db path not exist")
        // }
        this.videoDownloadModule = new VideoDownloadModule()
        this.videoDownloadTaskModule = new VideoDownloadTaskModule()
        this.accountCookiesModule = new AccountCookiesModule()
        //this.socialAccountApi = new SocialAccountApi()
        this.videoDescriptionModule = new VideoDescriptionModule()
        this.videoDownloadTaskDetailModule = new VideoDownloadTaskDetailModule()
        this.videoDownloadTaskUrlModule = new VideoDownloadTaskUrlModule()
        this.videoCaptionModule = new VideoCaptionModule()
        this.videoDownloadTagModule = new VideoDownloadTagModule()
        this.videoDownloadTaskKeywordModule = new VideoDownloadTaskKeywordModule()
        this.videoDownloadTaskAccountsModule = new VideoDownloadTaskAccountsModule()  
        //this.videoDownloadTaskProxyModule = new VideoDownloadTaskProxyModule()
        this.videoPublishModule = new VideoPublishModule()
    }
    
    //save video task, get task id
    public async saveVdieoDownloadTask(vdte: VideoDownloadTaskEntityType): Promise<number> {
        const vdteEntity = new VideoDownloadTaskEntity()
        vdteEntity.task_name = vdte.taskName
        vdteEntity.platform = vdte.platform
        vdteEntity.savepath = vdte.savepath
        vdteEntity.status = vdte.status || 0
        //vdteEntity.downloadtype = vdte.downloadtype
        return await this.videoDownloadTaskModule.saveVideoDownloadTask(vdteEntity)
    }

    public async processPublishVideo(param: VideoPublishParam,succesCall?:()=>void,errorCall?:(string)=>void){
        const childPath = path.join(__dirname, 'taskCode.js')
        if (!fs.existsSync(childPath)) {
            throw new Error("child js path not exist for the path " + childPath);
        }
        const { port1, port2 } = new MessageChannelMain()
        const child = utilityProcess.fork(childPath, [], {
            stdio: "pipe", execArgv: [], env: {
                ...process.env,
                NODE_OPTIONS: ""
            }
        })

        child.on("spawn", async () => {
            child.postMessage(JSON.stringify({ action: "publishVideo", data: param }), [port1])
            console.log("child process satart, pid is " + child.pid)
        })

        child.stdout?.on('data', (data) => {
            console.log("stdout data:",data)
        })

        child.stderr?.on('data', (data) => {
            console.log("stderr data:",data)

        })

        child.on("exit", async(code) => {
            if (code !== 0) {
                console.error(`Child process exited with code ${code}`);
                
            } else {
                console.log('Child process exited successfully');
                if(errorCall){
                    errorCall("publish video failed")
                }
                // this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Complete)
            }
        })
        child.on('message', async (message) => {
            console.log('Message from child:', JSON.parse(message));
            const childdata = JSON.parse(message) as ProcessMessage<any>
            if (childdata.action == "publishVideoMsg") {
                const getData = childdata.data as VideoPublishMsg
                if(getData.status){
                    if(succesCall){
                        succesCall()
                    }
                    //save publish record
                    const publishRecord = getData.publishRecord
                    if(publishRecord){
                        await this.videoPublishModule.savePublishRecord(publishRecord)
                    }
                }else{
                    if(errorCall){
                        errorCall(getData.msg)
                    }
                }
            }
        });
    }
   

  
    public async downloadVideo(param: DownloadVideoControlparam, startCall?: () => void) {

      
        const taskId = await this.videoDownloadTaskModule.saveVideoDownloadInfo(param)
        // param.language_code=param.videoLanguage.code
        //process download video
        await this.videoDownloadTaskModule.processDownloadVideo(taskId,  startCall)
    }
    //get video download list
    public async videoDownloadtasklist(page: number, size: number): Promise<ListData<VideoDownloadTaskEntityType>> {
        const list = await this.videoDownloadTaskModule.getVideoDownloadTaskList(page, size)
        const count = await this.videoDownloadTaskModule.countVideoDownloadTaskList()
        
        let records:Array<VideoDownloadTaskEntityType>=[]
        for(const item of list){
            const taskDetail = await this.videoDownloadTaskDetailModule.read(item.id)
            const taskEntity:VideoDownloadTaskEntityType={
                id: item.id,
                record_time: item.record_time || '',
                taskName: item.task_name || '',
                platform: item.platform || '',
                savepath: item.savepath || '',
                status: item.status || 0,
                downloadtype:taskDetail.download_type?this.videoDownloadTaskModule.convertDownloadType(taskDetail.download_type):'' as "playlist" | "singleplay" | "keyword"
            }
            records.push(taskEntity)
        }
        
        return { records, num: count }
    }
    //publish video
    public async publishVideo(videoId: number, platform: PublishPlatform, category: string, accountId: number,succesCall?:()=>void,errorCall?:(string)=>void) {
        //get video platform config by platform name
        const videoPlatformConfig=VideoPublishPlatformConfig.find((value)=>value.name==platform)
        if(!videoPlatformConfig){
            throw new Error("video platform config not found")
        }

        //get video 
        //const videoPublishService = new VideoPublishService();
        //get video entity by video id
        const videoEntity = await this.videoDownloadModule.getVideoDownloaditem(videoId)
        if(!videoEntity){
            throw new Error("video entity not found")
        }
        //get video description
        const videoDescription = await this.videoDescriptionModule.getVideoDescription(videoId, videoPlatformConfig.language)
        if(!videoDescription){
            throw new Error("video description not found")
        }
        //get video tags
        const videoTags = await this.videoDownloadTagModule.getVideoTag(videoId,videoPlatformConfig.language)
        if(!videoTags){
            throw new Error("video tags not found")
        }
        const tags = videoTags.map((value) => value.tag)
        //get video category
        // const videoCategory = await this.videoDownloadCategoryModule.getVideoCategory(videoId,videoEntity.language)
        // if(!videoCategory){
        //     throw new Error("video category not found")
        // }
       // const category = videoCategory.category
        //get video caption
        const videoCaption = await this.videoCaptionModule.getCaptionByVidLid(videoId,videoEntity.language)
        // if(!videoCaption){
        //     throw new Error("video caption not found")
        // }
       //convert account id to cookies
       const cookies = await this.accountCookiesModule.getAccountCookies(accountId)
       if(!cookies){
        throw new Error("account cookies not found")
       }
       const cookiesArray = JSON.parse(cookies.cookies).map((value) => ({
        name: value.name,
        value: value.value,
        domain: value.domain,
        path: value.path
       }))
       const options: PublishOptions = {
            title: videoDescription.title,
            description: videoDescription.description,
            tags: tags,
            category: category,
            caption:videoCaption?.caption_path??'',
            cookies: cookiesArray,
            headless: false,
            //accountId: accountId
        }
        const videoPublishService = new VideoPublishService();
        const result = await videoPublishService.publishVideo(videoEntity, platform, options);
        // return result;
        // await this.processPublishVideo({
        //     videoEntity: videoEntity,
        //     platform: platform,
        //     options: options
        // },succesCall,errorCall)
    }
    //get video download list by task id
    public async videoDownloadlist(taskId: number, page: number, size: number): Promise<ListData<VideoDownloadListDisplay>> {

        const res: Array<VideoDownloadListDisplay> = []
        const list = await this.videoDownloadModule.getVideoDownloadList(taskId, page, size)
        //list.forEach(async (element) => {
        for (const element of list) {
            let vdld: VideoDownloadListDisplay = {
                id: element.id,
                url: element.url ?? "",
                savepath: element.savepath ?? "",
                record_time: element.record_time ?? "",
                task_id: element.task_id,
                status: element.status,
                title: '',
                description: '',
                error_log: element.error_log ?? "",
                caption_status: element.caption_status,
                language: element.language
            }
            if (element.id && element.status == VideoDownloadStatus.Finish) {

                const videoDescription = await this.videoDescriptionModule.getVideoDescription(element.id, element.language as LanguageCode)
                if (videoDescription) {
                    vdld.title = videoDescription.title
                    vdld.description = videoDescription.description
                }
            }
            res.push(vdld)
        }
        const count = await this.videoDownloadModule.countVideoDownloadList(taskId)
        return { records: res, num: count } as ListData<VideoDownloadListDisplay>
    }
    public async retryDownloadvideo(taskId: number, startCall: () => void) {

        // const data = await this.videoDownloadTaskModule.getVideoDownloadParambyTaskId(taskId)
        // const videoTool = await this.videoDownloadTaskModule.getVideoDownloadTool(data.platform)
        // if (!videoTool) {
        //     throw new Error("video tool not found")
        // }
        //process download video
        await this.videoDownloadTaskModule.processDownloadVideo(taskId, startCall)


    }
    
    //try to redownload video by video id
    public async redownloadItembyId(Videoid: number, startCall: () => void) {

        const videoInfo = await this.videoDownloadModule.getVideoDownloaditem(Videoid)
        if (!videoInfo) {
            throw new Error("video info not found")
        }

        //get video task info
        const data = await this.videoDownloadTaskModule.getVideoDownloadParambyTaskId(videoInfo.task_id)
        let links: Array<string> = []
        if (data.link.length > 0) {
            if(videoInfo.url){
            links.push(videoInfo.url)
            }
        } else {
            throw new Error("video item url not found")
        }
        data.link = links
        
        data.isplaylist = false
        this.videoDownloadModule.updateVideoDownloadStatus(VideoDownloadStatus.Start, Videoid)
        //process download video
        await this.videoDownloadTaskModule.processDownloadVideo(videoInfo.task_id, startCall)

    }
    //show file in explorer
    public async showFileExplorer(id: number) {
        const videoInfo = await this.videoDownloadModule.getVideoDownloaditem(id)
        if (!videoInfo) {
            throw new Error("video info not found")
        }
        if(videoInfo.savepath){
            shell.showItemInFolder(videoInfo.savepath);
        }else{
            throw new Error("video save path not found")
        }
    }

    public async deleteVideoDownloadItem(id: number) {
        //get video info
        const videoInfo = await this.videoDownloadModule.getVideoDownloaditem(id)
        if (!videoInfo) {
            throw new Error("video info not found")
        }
        //delete video file
        if (videoInfo.savepath) {
            //check file exist
            if (fs.existsSync(videoInfo.savepath)) {
                fs.unlinkSync(videoInfo.savepath)
            }
        }
        //delete video description
        await this.videoDescriptionModule.deleteVideoDescription(id)
        //delete video download item
        await this.videoDownloadModule.deleteVideoDownloadItem(id)

    }
    public async readTaskErrorlog(taskId: number): Promise<string> {
        const task = await this.videoDownloadTaskModule.getVideoDownloadTask(taskId)
        if (!task) {
            throw new Error("task info not found")
        }
        let content = ""
        if (task.error_log) {
            //check file exist
            if (fs.existsSync(task.error_log)) {
                content = await readLogFile(task.error_log)
            } else {
                throw new Error("task error file log not found")
            }
        } else {
            throw new Error("task error file log not found")
        }
        console.log(content)
        return content
    }
    //pass video id, and generate video caption
    public async generateCaptionbyids(data: VideoCaptionGenerateParamWithIds<number>, errorCall?: (message: string) => void) {
        const res = await this.convertToVideoCaptionitem(data)
        if (res.length < 1) {
            throw new Error("video.item_less than one")
        }
        await this.generateCaptionsPath(res, errorCall)
    }
    public async convertToVideoCaptionitem(data: VideoCaptionGenerateParamWithIds<number>): Promise<Array<VideoCaptionItem>> {
        const res: Array<VideoCaptionItem> = []
        if (data.ids.length > 0) {
            for (let i = 0; i < data.ids.length; i++) {
                const value = data.ids[i];
                const videoItem = await this.videoDownloadModule.getVideoDownloaditem(value)
                if (videoItem) {
                    if (videoItem.savepath) {
                        const item: VideoCaptionItem = {
                            videoId: value,
                            videoPath: videoItem.savepath,
                            isEnglish: videoItem.language==LanguageCode.EN?true:false,
                            savePath: data.savePath,
                            languageCode: videoItem.language as LanguageCode
                        }
                        res.push(item)
                    }
                }
            }
            //})
        }
        return res
    }
    //generate caption for videos
    //throw error if video caption tool requirement check failed
    public async generateCaptionsPath(params: Array<VideoCaptionItem>, errorCall?: (message: string) => void): Promise<void> {
        //check requirement
        //const VFaction = new VideoCaptionFactory()
        const emctrol = new ExtraModuleController()
        const res = await emctrol.checkRequirement()
        if (!res) {
            throw new Error("video caption tool requirement check failed")
        }
        const childPath = path.join(__dirname, 'taskCode.js')
        if (!fs.existsSync(childPath)) {
            throw new CustomError("child js path not exist for the path " + childPath);
        }
        const { port1, port2 } = new MessageChannelMain()
        console.log(params)
        const child = utilityProcess.fork(childPath, [], {
            stdio: "pipe",
            execArgv: ["puppeteer-cluster:*"],
            env: {
                ...process.env,
                NODE_OPTIONS: ""
            }
        })

        child.on("spawn", () => {

            const datas: VideoCaptionGenerateParam = {
                videos: params
            }
            //update video caption status to start
            params.forEach((value) => {
                if (value.videoId) {
                    this.videoDownloadModule.updateVideoCaptionStatus(value.videoId, VideoCaptionStatus.Start)
                }
            })
            child.postMessage(JSON.stringify({ action: "generateCaption", data: datas } as ProcessMessage<VideoCaptionGenerateParam>), [port1])

        })

        child.stdout?.on('data', (data) => {
            console.log(`Received data chunk ${data}`)

            // child.kill()
        })

        child.stderr?.on('data', (data) => {
            const ingoreStr = ["Debugger attached", "Waiting for the debugger to disconnect"]
            if (!ingoreStr.some((value) => data.includes(value))) {

                // seModel.saveTaskerrorlog(taskId,data)
                console.log(`Received error chunk ${data}`)
                //WriteLog(errorLogfile, data)

            }

        })

        child.on("exit", (code) => {
            if (code !== 0) {
                console.error(`Child process exited with code ${code}`);
                // this.videoDownloadTaskModule.updateVideoDownloadTaskStatus(taskId, TaskStatus.Error)
                // this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Error)
            } else {
                console.log('Child pr`ocess exited succe`ssfully');
                //this.videoDownloadTaskModule.updateVideoDownloadTaskStatus(taskId, TaskStatus.Complete)
                // this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Complete)
            }
        })

        child.on('message', (message) => {
            console.log("get message from child")
            console.log('Message from child:', JSON.parse(message));
            const childdata = JSON.parse(message) as ProcessMessage<any>
            if (childdata.action == "generateCaptionMsg") {
                const getData = childdata.data as VideoCaptionMsg
                if (getData.status) {

                    console.log("generate caption success")
                    if (getData.videoId && getData.savepath) {
                        // const vce: VideoCaptionEntity = {
                        //     videoId: getData.videoId,
                        //     language_id: 0,
                        //     caption_path: getData.savepath
                        // }
                        const vce=new VideoCaptionEntity()
                        vce.video_id=getData.videoId
                        vce.caption_path=getData.savepath
                        vce.language=getData.languageCode?getData.languageCode.toString():"en"
                        vce.record_time=new Date().toISOString()
                        this.videoCaptionModule.create(vce)
                        this.videoDownloadModule.updateVideoCaptionStatus(getData.videoId, VideoCaptionStatus.Finish)
                    }

                } else {
                    //generate caption error
                    if (getData.videoId) {
                        this.videoDownloadModule.updateVideoCaptionStatus(getData.videoId, VideoCaptionStatus.Error)
                        this.videoDownloadModule.saveVideoDownloadLog(getData.msg, getData.videoId)
                    }
                    //send system message
                    if (errorCall) {
                        errorCall(getData.msg)
                    }
                }
            }

        });


    }
    //get video info by id
    public async getVideoinfo(id: number): Promise<VideoCompotionEntity> {
        const videoDownEntity = await this.videoDownloadModule.getVideoDownloaditem(id)
        if (!videoDownEntity) {
            throw new Error("video download item not found")
        }
        //get video description
        const videoDescription = await this.videoDescriptionModule.getVideoDescription(id, videoDownEntity.language as LanguageCode)
        //get video caption
        const videoCaption = await this.videoCaptionModule.getCaptionByVid(id)
        const captionDisplay: Array<VideoCaptionDisplay> = []
        if (videoCaption.length > 0) {
            videoCaption.forEach((value) => {
                const captionDisplayItem: VideoCaptionDisplay = {
                    id: value.id,
                    videoId: value.video_id,
                    language_id: 0,
                    language: getLanaugebyCode(value.language as LanguageCode),
                    caption_path: value.caption_path,
                    record_time: value.record_time,
                }
                captionDisplay.push(captionDisplayItem)

            })
        }
        const transinfolist = await this.videoDescriptionModule.getVideoDescriptionOtherLanguage(id, videoDownEntity.language as LanguageCode)
        const videoDownEntityType:VideoDownloadEntityType={
            id:videoDownEntity.id,
            url:videoDownEntity.url ?? "",
            savepath:videoDownEntity.savepath ?? "",
            record_time:videoDownEntity.record_time ?? "",
            task_id:videoDownEntity.task_id,
            language:videoDownEntity.language,
            status:videoDownEntity.status,
        }
        const res: VideoCompotionEntity = {
            detail: videoDownEntityType,
            description: videoDescription,
            caption: captionDisplay,
            translateInfolist: transinfolist
        }
        console.log(res)
        return res
    }
    //get video translate info
    // public async getVideoTranslateinfo(id: number) {
    //     // const videoDownEntity = this.videoDownloadModule.getVideoDescriptionOtherLanguage(id)
    //     // if (!videoDownEntity) {
    //     //     throw new Error("video download item not found")
    //     // }

    // } 
    public async getVideoErrorlog(id: number): Promise<string> {
        const content = await this.videoDownloadModule.getVideoErrorLog(id)
        return content
    }
    //show file in explorer
    public async showCaptionFileExplorer(id: number) {
        const videoCaptionInfo = await this.videoCaptionModule.read(id)
        if (!videoCaptionInfo) {
            throw new Error("video info not found")
        }
        shell.showItemInFolder(videoCaptionInfo.caption_path);
    }

    //translate video information 
    public async convertToVideoTranslateitem(data: VideoInformationTransParam<number>): Promise<Array<VideoTranslateItem>> {
        const res: Array<VideoTranslateItem> = []
        if (data.ids.length > 0) {
            // data.ids.forEach(async (value) => {
            for (const value of data.ids) {
                const videoItem = await this.videoDownloadModule.getVideoDownloaditem(value)
                if (videoItem) {
                    const vds = await this.videoDescriptionModule.getVideoDescription(value, videoItem.language as LanguageCode)
                    console.log("vds is following")
                    console.log(vds)
                    //get item tags by video id and language
                    const tags = await this.videoDownloadTagModule.getVideoTag(value, videoItem.language)
                    console.log(videoItem.language)
                    console.log(videoItem)
                    const languageItem = getLanaugebyCode(videoItem.language)
                    if (!languageItem) {
                        throw new Error("language not found,language code may error")
                    }
                    if (videoItem.language == data.target_language.code) {
                        throw new Error("source language and target language can not be same")
                    }

                    const vti: VideoTranslateItem = {
                        videoId: value,
                        title: vds?.title ? vds.title : '',
                        description: vds?.description ? vds.description : '',
                        tags: tags,
                        source_language: languageItem
                        //   target_language:data.target_language
                    }
                    res.push(vti)
                }


            }
        }
        return res

    }
    public async tranVideoinfo(data: VideoInformationTransParam<number>) {
        const videoItem: Array<VideoTranslateItem> = await this.convertToVideoTranslateitem(data)
        if (videoItem.length < 1) {
            throw new Error("video.translate_item_less_than_one")
        }

        let toolType: string | void = undefined
        const translatePro = new TranslateProducer()
        toolType = translatePro.checkTooltype(data.translate_tool)

        const translateCon = new TranslateController()
        let llmcon: LlmCongfig | undefined
        let traditionalTranslateCongfig: TraditionalTranslateCongfig | undefined
        if (toolType == "llm") {
            const cres = await translateCon.getSystemConfigLLM(data.translate_tool)
            if (cres) {
                llmcon = cres
            }
            // console.log("llmcon",llmcon)
        } else if (toolType == "api") {
            const traditiona = await translateCon.getTranslateConfig(data.translate_tool)
            if (traditiona) {
                traditionalTranslateCongfig = traditiona
            }
        } else {
            throw new Error("translate tool type not found")
        }

        const params: TransItemsParam<VideoTranslateItem> = {
            items: videoItem,
            target_language: data.target_language,
            translate_tool: data.translate_tool,
            llmConfig: llmcon,
            traditionalTranslateConfig: traditionalTranslateCongfig
        }
        console.log(params)
        const childPath = path.join(__dirname, 'taskCode.js')
        if (!fs.existsSync(childPath)) {
            throw new CustomError("child js path not exist for the path " + childPath);
        }
        const { port1, port2 } = new MessageChannelMain()
        console.log(params)
        const child = utilityProcess.fork(childPath, [], {
            stdio: "pipe", execArgv: ["puppeteer-cluster:*"], env: {
                ...process.env,
                NODE_OPTIONS: ""
            }
        })

        child.on("spawn", () => {


            child.postMessage(JSON.stringify({ action: "translateVideoInfo", data: params } as ProcessMessage<TransItemsParam<VideoTranslateItem>>), [port1])

        })

        child.stdout?.on('data', (data) => {
            console.log(`Received data chunk ${data}`)

        })

        child.stderr?.on('data', (data) => {
            const ingoreStr = ["Debugger attached", "Waiting for the debugger to disconnect"]
            if (!ingoreStr.some((value) => data.includes(value))) {

                // seModel.saveTaskerrorlog(taskId,data)
                console.log(`Received error chunk ${data}`)
                //WriteLog(errorLogfile, data)

            }

        })
        child.on('message', async (message) => {
            const childdata = JSON.parse(message) as ProcessMessage<any>
            if (childdata.action == "translateVideoInfoMsg") {
                const getData = childdata.data as CommonMessage<VideoTranslateItem>
                if (getData.status) {
                    //save video description
                    if (getData.data) {

                        const vds = new VideoDescriptionEntity()
                        vds.video_id = getData.data.videoId
                        vds.title = getData.data.title
                        vds.description = getData.data.description
                        vds.language = data.target_language.code
                        await this.videoDescriptionModule.saveVideoDescription(vds)
                        //save video tags
                        if (getData.data.tags && getData.data.tags.length > 0) {
                            getData.data.tags.forEach(async (value) => {
                                //save video taga
                                this.videoDownloadTagModule.create(value)
                            })
                        }
                    }
                }
            }
        })

        child.on("exit", (code) => {
            if (code !== 0) {
                console.error(`Child process exited with code ${code}`);

            } else {
                console.log('Child process exited succe`ssfully');

            }
        })



    }

    // Get publish records
    public async getPublishRecords(param: PublishRecordQuery): Promise<ListData<VideoPublishRecordEntity>> {
        
        return await this.videoPublishModule.getPublishRecordsWithCount(param);
       
    }

    // Delete publish record
    public async deletePublishRecord(id: number): Promise<boolean> {
        const result = await this.videoPublishModule.deletePublishRecord(id);
        return result > 0;
    }

}
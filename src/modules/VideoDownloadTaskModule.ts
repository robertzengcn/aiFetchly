// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
import { VideoDownloadTaskModel } from "@/model/VideoDownloadTask.model"
// import { VideoDownloadTaskEntity } from "@/entityTypes/videoType"
import { TaskStatus } from "@/entityTypes/commonType"
import { BaseModule } from "@/modules/baseModule";
import { VideoDownloadTaskEntity } from "@/entity/VideoDownloadTask.entity"
import { VideoDownloadStatus, VideodownloadTaskMsg, VideoDownloadListDisplay, VideodownloadMsg, DownloadVideoControlparam, DownloadType, CookiesType, VideoCaptionItem, VideoCaptionMsg, VideoCaptionStatus, VideoCaptionGenerateParamWithIds, VideoInformationTransParam } from "@/entityTypes/videoType"
import { Video } from '@/modules/interface/Video';
import { VideoDownloadTaskEntityType, processVideoDownloadParam, CookiesProxy, VideoCompotionEntity, VideoCaptionGenerateParam, VideoCaptionDisplay, VideoTranslateItem, VideoPublishMsg } from "@/entityTypes/videoType";
import * as path from 'path';
import * as fs from 'fs';
import { utilityProcess, MessageChannelMain } from "electron";
import { USERLOGPATH, USEREMAIL } from '@/config/usersetting';
import { WriteLog, getApplogspath, getRandomValues, removeParamsAfterAmpersand } from "@/modules/lib/function"
//import { WriteLog } from "@/modules/lib/function"
import { Token } from "@/modules/token"
import { v4 as uuidv4 } from 'uuid';
import { AccountCookiesModule } from "./accountCookiesModule";
import { VideoDownloadTaskDetailModule } from "./VideoDownloadTaskDetailModule";
import { VideoDownloadTaskAccountsModule } from "./VideoDownloadTaskAccountsModule";
import { VideoDescriptionModule } from "@/modules/videoDescriptionModule";
import { VideoDownloadModule } from "@/modules/VideoDownloadModule";
import { SocialAccountApi } from "@/api/socialAccountApi"
import { Proxy } from "@/entityTypes/proxyType"
//import { ProxyApi } from "@/api/proxyApi"
import {IProxyApi} from "@/modules/interface/IProxyApi"
import {ProxyModule} from "@/modules/ProxyModule"
import { ProcessMessage } from "@/entityTypes/processMessage-type"
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity";
import { VideoDescriptionEntity } from "@/entity/VideoDescription.entity"
import { VideoDownloadTaskUrlModule } from "@/modules/VideoDownloadTaskUrlModule"
import { VideoDownloadTaskKeywordModule } from "./VideoDownloadTaskKeywordModule";
import { VideoDownloadTaskProxyModule } from "./VideoDownloadTaskProxyModule";
import { videoFactory } from "@/modules/video/videoFactory";
import {VideoDownloadTaskDetailEntity} from "@/entity/VideoDownloadTaskDetail.entity"
import {VideoDownloadTaskAccountsEntity} from "@/entity/VideoDownloadTaskAccounts.entity"
import {VideoDownloadTaskUrlsEntity} from "@/entity/VideoDownloadTaskUrls.entity"
//import { `WriteLog,` getApplogspath, getRandomValues, removeParamsAfterAmpersand, readLogFile } from "@/modules/lib/function"
//import { VideoDownloadTaskAccountsModule } from "@/modules/VideoDownloadTaskAccountsModule";
export class VideoDownloadTaskModule extends BaseModule {
  // private dbpath: string
  private videoDownloadTaskdb: VideoDownloadTaskModel
  private accountCookiesModule: AccountCookiesModule
  private socialAccountApi: SocialAccountApi
  private videoDescriptionModule: VideoDescriptionModule
  private videoDownloadModule: VideoDownloadModule
  private videoDownloadTaskModule: VideoDownloadTaskModule
  private videoDownloadTaskAccountModule: VideoDownloadTaskAccountsModule
  private videoDownloadTaskDetailModule: VideoDownloadTaskDetailModule
  private videoDownloadTaskUrlModule: VideoDownloadTaskUrlModule
  private videoDownloadTaskKeywordModule: VideoDownloadTaskKeywordModule
  private videoDownloadTaskProxyModule: VideoDownloadTaskProxyModule
  //private videoDownloadTaskDetailModule: VideoDownloadTaskDetailModule
  // private videoDownloadTaskAccountsModule: VideoDownloadTaskAccountsModule
  constructor() {
    super()
    // const tokenService = new Token()
    // const dbpath = tokenService.getValue(USERSDBPATH)
    // if (!dbpath) {
    //     throw new Error("user path not exist")
    // }
    // this.dbpath = dbpath
    this.videoDownloadTaskdb = new VideoDownloadTaskModel(this.dbpath)
    this.accountCookiesModule = new AccountCookiesModule()
    this.socialAccountApi = new SocialAccountApi()
    this.videoDescriptionModule = new VideoDescriptionModule()
    this.videoDownloadModule = new VideoDownloadModule()
    //this.videoDownloadTaskModule = new VideoDownloadTaskModule()
    this.videoDownloadTaskAccountModule = new VideoDownloadTaskAccountsModule()
    this.videoDownloadTaskDetailModule = new VideoDownloadTaskDetailModule()
    this.videoDownloadTaskUrlModule = new VideoDownloadTaskUrlModule()
    this.videoDownloadTaskKeywordModule = new VideoDownloadTaskKeywordModule()
    this.videoDownloadTaskProxyModule = new VideoDownloadTaskProxyModule()
    // this.videoDownloadTaskDetailModule = new VideoDownloadTaskDetailModule()
    // this.videoDownloadTaskAccountsModule = new VideoDownloadTaskAccountsModule()
  }

  public async saveVideoDownloadTask(videoDownloadTask: VideoDownloadTaskEntity) {
    return await this.videoDownloadTaskdb.saveVideoDownloadTask(videoDownloadTask)
  }

  public async updateTasklog(taskId: number, log: string) {
    return await this.videoDownloadTaskdb.updateTasklog(taskId, log)
  }
  //update error log
  public async updateTaskErrorlog(taskId: number, log: string) {
    return await this.videoDownloadTaskdb.updateTaskErrorlog(taskId, log);
  }

  public async getVideoDownloadTaskList(page: number, size: number): Promise<Array<VideoDownloadTaskEntity>> {
    return await this.videoDownloadTaskdb.getVideoDownloadTaskList(page, size)
  }
  //count video download task list
  public async countVideoDownloadTaskList(): Promise<number> {
    return await this.videoDownloadTaskdb.countVideoDownloadTaskList()
  }
  //update video download task status
  public async updateVideoDownloadTaskStatus(taskId: number, status: TaskStatus): Promise<boolean> {
    return await this.videoDownloadTaskdb.updateVideoDownloadTaskStatus(taskId, status);
  }
  //get video download task info by id
  public async getVideoDownloadTask(taskId: number): Promise<VideoDownloadTaskEntity | null> {
    return await this.videoDownloadTaskdb.getVideoDownloadTask(taskId)
  }
  public convertDownloadType(downloadType: number): string {
    switch (downloadType) {
      case 1:
        return "singleplay"
      case 2:
        return "playlist"
      case 3:
        return "keyword"
      default:
        return "singleplay"
    }
  }
  //convert download type to number
  public convertDownloadTypeNumber(downloadType: DownloadType): number {
    switch (downloadType) {
      case DownloadType.SINGLEVIDEO:
        return 1
      case DownloadType.MULTIVIDEO:
        return 2
      case DownloadType.KEYWORD:
        return 3
      default:
        return 1
    }
  }
  public async getVideoDownloadParambyTaskId(taskId: number): Promise<DownloadVideoControlparam> {
    const taskEntity = await this.getVideoDownloadTask(taskId)
    if (!taskEntity) {
      throw new Error("task not found")
    }

    const taskDetail = await this.videoDownloadTaskDetailModule.read(taskId)
    if (!taskDetail) {
      throw new Error("task detail not found")
    }
    const urlList = await this.videoDownloadTaskUrlModule.getItemsByTaskId(taskId)
    let urlarry: string[] = []
    if (urlList.length > 0) {
      urlarry = urlList.map((item) => {
        if (item.url) {
          return item.url
        }
        return ''
      })
    }

    //const urlList=urlList.map((item)=>item.url)
    if (taskDetail.download_type == null) {
      throw new Error("download type not found")
    }
    const downloadType = this.convertDownloadType(taskDetail.download_type)
    //get keywords
    const keywordsArray = await this.videoDownloadTaskKeywordModule.getTaskKeywords(taskId)
    let keywords: string[] = []
    if (keywordsArray && keywordsArray.length > 0) {
      keywords = keywordsArray.map((item) => item.keyword)
    }
    //const keywords = taskDetail.keywords
    const savePath = taskEntity.savepath ?? ''
    const isplaylist = taskDetail.download_type == DownloadType.MULTIVIDEO ? true : false
    const proxyList = await this.videoDownloadTaskProxyModule.getItemsByTaskId(taskId)
    let proxyarry: number[] = []
    if (proxyList && proxyList.length > 0) {
      proxyarry = proxyList.map((item) => item.proxy_id)
    }

    //const accountList = await this.videoDownloadTaskAccountModule.getAccountByTaskId(taskId)
    //const accountIds = accountList.map((item) => item.account_id)
    let accountIds: Array<number> = []
    if (taskDetail.cookies_type == CookiesType.ACCOUNTCOOKIES) {
      //get account id
      const taskAccounts = await this.videoDownloadTaskAccountModule.getAccountByTaskId(taskId)
      if (taskAccounts.length > 0) {
        accountIds = taskAccounts.map((value) => value.account_id)
        //process download video
        //await this.processDownloadVideo({taskName:taskInfo.taskName,platform:taskInfo.platform,link:[],savePath:taskInfo.savepath,isplaylist:taskDetail.download_type==DownloadType.MULTIVIDEO,accountId:accountIds,cookies_type:taskDetail.cookies_type==CookiesType.ACCOUNTCOOKIES?"account cookies":"browser cookies",browserName:taskDetail.browser_type?taskDetail.browser_type:"",videoQuality:""}, videoTool, taskId)
      }

    }

    const param: DownloadVideoControlparam = {
      taskName: taskEntity.task_name ?? '',
      accountId: accountIds,
      platform: taskEntity.platform ?? '',
      link: urlarry,
      downloadType: downloadType as "playlist" | "singleplay" | "keyword",
      keywords: keywords,
      savePath: savePath,
      isplaylist: isplaylist,
      proxy: proxyarry,
      ProxyOverride: taskDetail.proxy_override == 1 ? true : false,
      cookies_type: taskDetail.cookies_type == CookiesType.USEBROWSER ? "browser cookies" : "account cookies",
      browserName: taskDetail.browser_type ?? '',
      videoQuality: taskDetail.video_quality ?? 0,
      language_code: taskDetail.video_language ?? 'en',
      maxpagenumber: taskDetail.max_page_number ?? 0,
    }
    return param
  }
  public async checkVideoRequirement(videoTool: Video): Promise<boolean> {
    return await videoTool.checkRequirement()
  }
  //get video download tool
  public async getVideoDownloadTool(platform: string): Promise<Video | null> {
    const videoFactoryInstance = new videoFactory()
    const videoTool = await videoFactoryInstance.getVideotool(platform)
    return videoTool
  }
  //process download video
  public async processDownloadVideo(taskId: number, startCall?: () => void) {
    const param = await this.getVideoDownloadParambyTaskId(taskId)
    const videoTool = await this.getVideoDownloadTool(param.platform)
    if (!videoTool) {
      throw new Error("video tool not found")
    }
    const isRequirement = await this.checkVideoRequirement(videoTool)
    if (!isRequirement) {
      throw new Error("video tool requirement not met")
    }
    const execFilepath = videoTool.getPackagepath()

    const childPath = path.join(__dirname, 'taskCode.js')
    if (!fs.existsSync(childPath)) {
      throw new Error("child js path not exist for the path " + childPath);
    }
    const { port1, port2 } = new MessageChannelMain()

    const tokenService = new Token()
    // console.log(path.join(__dirname, 'utilityCode.js'))
    let logpath = tokenService.getValue(USERLOGPATH)
    if (!logpath) {
      const useremail = tokenService.getValue(USEREMAIL)
      //create log path
      logpath = getApplogspath(useremail)
    }
    // console.log(logpath)
    const uuid = uuidv4({ random: getRandomValues(new Uint8Array(16)) })
    const errorLogfile = path.join(logpath, 'downloadVideo', taskId.toString() + '_' + uuid + '.error.log')
    const runLogfile = path.join(logpath, 'downloadVideo', taskId.toString() + '_' + uuid + '.runtime.log')

    await this.updateTasklog(taskId, runLogfile)
    await this.updateTaskErrorlog(taskId, errorLogfile)
    const cookiesProxies: CookiesProxy[] = []

    // const cookies:Array<string>=[]
    //loop account id to get cookies
    for (const accountid of param.accountId) {
      const accountEntity = await this.accountCookiesModule.getAccountCookies(accountid)
      if (accountEntity && accountEntity.cookies) {
        // cookies.push(accountEntity.cookies)
        const cookiesproxy: CookiesProxy = {
          cookies: accountEntity.cookies,
        }
        if (!param.ProxyOverride) {//not use account proxy
          //get proxy
          const accResp = await this.socialAccountApi.getAccountdetail(accountid)
          if (accResp) {
            if (accResp.data && accResp.data.proxy) {
              cookiesproxy.proxy = accResp.data.proxy
            }
          }
        }
        cookiesProxies.push(cookiesproxy)
      }
      // const cookie=tokenService.getValue(accountid)
      // if(cookie){
      //     cookies.push(cookie)
      // }
    }
    const proxyArr: Array<Proxy> = []
    if (param.proxy.length > 0) {
      //get proxy from remote
      const proxyapi:IProxyApi = new ProxyModule()
      param.proxy.forEach(async (value) => {
        const proxy = await proxyapi.getProxyDetail(value)
        if (proxy && proxy.status) {
          if (proxy.data) {
            proxyArr.push(proxy.data)
          }
        }
      })
    }

    if (startCall) {
      startCall()
    }
    //get the video lnk that already download in the task
    const alreadsucess = await this.videoDownloadModule.getAllvideoDownloadlist(taskId, VideoDownloadStatus.Finish)
    const alreadlinks = alreadsucess.map((value) => removeParamsAfterAmpersand(value.url ?? ""))
    //console.log(alreadlinks)
    const paramData: processVideoDownloadParam = {
      exePath: execFilepath,
      platform: param.platform,
      link: param.link,
      keywords: param.keywords,
      downloadType: param.downloadType,
      isplaylist: param.isplaylist,
      cookiesProxy: cookiesProxies,
      savePath: param.savePath,
      proxy: proxyArr,
      BrowserName: param.browserName,
      videoQuality: param.videoQuality,
      successlink: alreadlinks,
      max_page_number: param.maxpagenumber
    }
    //console.log(childPath)
    const child = utilityProcess.fork(childPath, [], {
      stdio: "pipe", execArgv: ["puppeteer-cluster:*"], env: {
        ...process.env,
        NODE_OPTIONS: ""
      }
    })

    child.on("spawn", async () => {

      console.log("child process satart, pid is " + child.pid)
      await this.updateVideoDownloadTaskStatus(taskId, TaskStatus.Processing)
      child.postMessage(JSON.stringify({ action: "downloadVideo", data: paramData }), [port1])

    })

    child.stdout?.on('data', (data) => {
      console.log(`Received data chunk ${data}`)
      WriteLog(runLogfile, data)
      // child.kill()
    })

    child.stderr?.on('data', (data) => {
      const ingoreStr = ["Debugger attached", "Waiting for the debugger to disconnect"]
      if (!ingoreStr.some((value) => data.includes(value))) {

        // seModel.saveTaskerrorlog(taskId,data)
        console.log(`Received error chunk ${data}`)
        //console.log('filename'+errorLogfile)
        WriteLog(errorLogfile, data)

      }

    })

    child.on("exit", async (code) => {
      if (code !== 0) {
        console.error(`Child process exited with code ${code}`);
        await this.updateVideoDownloadTaskStatus(taskId, TaskStatus.Error)
        // this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Error)
      } else {
        console.log('Child process exited successfully');
        await this.updateVideoDownloadTaskStatus(taskId, TaskStatus.Complete)
        // this.emailSeachTaskModule.updateTaskStatus(taskId,EmailsearchTaskStatus.Complete)
      }
    })
    child.on('message', async (message) => {
      console.log("get message from child")
      console.log('Message from child:', JSON.parse(message));
      const childdata = JSON.parse(message) as ProcessMessage<any>
      if (childdata.action == "singlevideodownloadMsg") {//download single video result
        const getData = childdata.data as VideodownloadMsg
        if (getData?.status) {//download success

          //save result
          let savepath = ''
          if (getData.savepath) {
            savepath = getData.savepath
          }
          // const videoDownloadEntity: VideoDownloadEntity = {
          //     url: getData.link,
          //     savepath: savepath,
          //     task_id: Number(taskId),
          //     status: VideoDownloadStatus.Finish,
          //     language: param.language_code
          // }
          const videoDownloadEntity = new VideoDownloadEntity()
          videoDownloadEntity.url = getData.link
          videoDownloadEntity.savepath = savepath
          videoDownloadEntity.task_id = Number(taskId)
          videoDownloadEntity.status = VideoDownloadStatus.Finish
          videoDownloadEntity.language = param.language_code
          //     url: getData.link,
          //     savepath: savepath,
          //     task_id: Number(taskId),
          //     status: VideoDownloadStatus.Finish,
          //     language: param.language_code
          // }
          // this.emailSeachTaskModule.saveSearchResult(taskId,childdata.data)
          const videoNum = await this.videoDownloadModule.saveVideoDownload(videoDownloadEntity)
          const videoDescriptionEntity = new VideoDescriptionEntity()
          videoDescriptionEntity.video_id = videoNum
          videoDescriptionEntity.title = getData.title ? getData.title : ''
          videoDescriptionEntity.description = getData.description ? getData.description : ''
          videoDescriptionEntity.language = param.language_code

          // const videoDescriptionEntity: VideoDescriptionEntity = {
          //     video_id: videoNum,
          //     title: getData.title ? getData.title : '',
          //     description: getData.description ? getData.description : '',
          //     language: param.language_code

          // }
          //save video Video Description
          await this.videoDescriptionModule.saveVideoDescription(videoDescriptionEntity)
        } else if (getData && (!getData?.status)) {//failure
          if (getData.link.length > 0) {
            // const videoDownloadEntity: VideoDownloadEntity = {
            //     url: getData.link,
            //     savepath: '',
            //     task_id: Number(taskId),
            //     status: VideoDownloadStatus.Error,
            //     language: param.language_code
            // }
            const videoDownloadEntity = new VideoDownloadEntity()
            videoDownloadEntity.url = getData.link
            videoDownloadEntity.savepath = ''
            videoDownloadEntity.task_id = Number(taskId)
            videoDownloadEntity.status = VideoDownloadStatus.Error
            videoDownloadEntity.language = param.language_code
            // const videoId = this.videoDownloadModule.saveVideoDownload(videoDownloadEntity)
            const videoId = await this.videoDownloadModule.saveVideoDownload(videoDownloadEntity)
            if (getData.log) {
              this.videoDownloadModule.saveVideoDownloadLog(getData.log, videoId)
            }
          } else {
            //the log belong to task
            //this.videoDownloadTaskModule.saveTaskerrorlog(taskId,getData.log)
            //this.videoDownloadTaskModule.updateVideoDownloadTaskStatus(taskId, TaskStatus.Error)
            if (getData.log) {
              WriteLog(errorLogfile, getData.log)
            }
          }
        }
        //child.kill()
      } else if (childdata.action == "videodownloadTaskMsg") {
        const res = childdata.data as VideodownloadTaskMsg
        WriteLog(errorLogfile, res.msg)
      }
    });


  }
  //save video download info
  public async saveVideoDownloadInfo(param: DownloadVideoControlparam):Promise<number>{
    const videoTaskEntity = new VideoDownloadTaskEntity()
        videoTaskEntity.task_name = param.taskName
        videoTaskEntity.platform = param.platform
        videoTaskEntity.savepath = param.savePath
        videoTaskEntity.status = TaskStatus.Processing
        //videoTaskEntity.downloadtype = param.downloadType
        const taskId = await this.saveVideoDownloadTask(videoTaskEntity)
        if (!taskId) {
            throw new Error("video task save failed")
        }
        //save video url

       
        const vdetd=new VideoDownloadTaskDetailEntity()
        vdetd.task_id=taskId
        vdetd.download_type=param.isplaylist ? DownloadType.MULTIVIDEO : DownloadType.SINGLEVIDEO
        vdetd.cookies_type=param.cookies_type == "browser cookies" ? CookiesType.USEBROWSER : CookiesType.ACCOUNTCOOKIES
        vdetd.browser_type=param.browserName ? param.browserName : ''
        vdetd.proxy_override=param.ProxyOverride ? 1 : 0
        vdetd.video_quality=param.videoQuality ? param.videoQuality : 0
       
        vdetd.max_page_number=param.maxpagenumber ? param.maxpagenumber : 0
        //save video task detail
        await this.videoDownloadTaskDetailModule.create(vdetd)
        //save task accounts
        if (param.accountId.length > 0) {

            for (const accid of param.accountId) {
                // const taskAccount: VideoDownloadTaskAccountEntity = {
                //     task_id: taskId,
                //     account_id: accid
                // }
                const taskAccount=new VideoDownloadTaskAccountsEntity()
                taskAccount.task_id=taskId
                taskAccount.account_id=accid
                await this.videoDownloadTaskAccountModule.create(taskAccount)
            }
        }
        if (param.link.length > 0) {
            //save task url
            for (const link of param.link) {
                const videodownloadtaskurl=new VideoDownloadTaskUrlsEntity()
                videodownloadtaskurl.task_id=taskId
                videodownloadtaskurl.url=link
                await this.videoDownloadTaskUrlModule.create(videodownloadtaskurl)
                // this.videoDownloadTaskUrlModule.create({ task_id: taskId, url: link })
            }
        }
        if (param.keywords.length > 0) {
            this.videoDownloadTaskKeywordModule.saveKeywords(taskId, param.keywords)
        }
        //save proxy id
        if (param.proxy.length > 0) {
            param.proxy.forEach((value) => {
                this.videoDownloadTaskProxyModule.create({ task_id: taskId, proxy_id: value })
            })
        }
        return taskId
  }
}
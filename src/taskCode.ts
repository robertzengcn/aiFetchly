"use strict";
export { };
import { ProcessMessage } from "@/entityTypes/processMessage-type"
import { EmailSearch } from "@/childprocess/emailSearch"
import { EmailsControldata, EmailResult } from '@/entityTypes/emailextraction-type'
import { EmailSendResult } from "@/entityTypes/emailmarketingType"
import { EmailSend } from "@/childprocess/emailSend"
import { Proxy } from "@/entityTypes/proxyType"
import { VideoDownloadFactory } from "@/modules/videodownload/VideoDownloadFactory"
import { VideodoanloadSuccessCall, VideoCaptionGenerateParam, CookiesProxy, processVideoDownloadParam, VideodownloadMsg, VideodownloadTaskMsg } from "@/entityTypes/videoType"
import { VideoCaptionFactory } from "@/modules/videoCaption/VideoCaptionFactory"
import { VideoCaptionImpl } from '@/modules/interface/VideoCaptionImpl';
import { extraFileEntity, VideoCaptionMsg,VideoPublishMsg } from "@/entityTypes/videoType";
import { TransItemsParam } from "@/entityTypes/translateType"
import { VideoTranslateItem } from "@/entityTypes/videoType";
import { TranslateProducer } from "@/modules/TranslateProducer"
import { VideoDownloadTagEntity } from "@/entity/VideoDownloadTag.entity"
import { CommonMessage } from "@/entityTypes/commonType"
import { Usersearchdata } from "@/entityTypes/searchControlType"
import { UserSearch } from "@/childprocess/userSearch"
import { ResultParseItemType } from "@/entityTypes/scrapeType"
import { VideoPublishParam } from "./entityTypes/videoPublishType";
import { VideoPublishService } from "./service/VideoPublishService";


process.parentPort.on('message', async (e) => {
    //console.log(e.data)
    const pme = JSON.parse(e.data) as ProcessMessage<any>
    switch (pme.action) {
        //check action
        case "searchscraper": {
            const userSearchdata = pme.data as Usersearchdata;
            if (!userSearchdata) {
                console.log("data is empty")
                return
            }
            const userSer = new UserSearch()
            //const res = await userSer.searchData(userSearchdata)
            //console.log(res)
            // const message: ProcessMessage<SearchDataRun> = {
            //     action: "saveres",
            //     data: res
            // }
            await userSer.searchData(userSearchdata,function(result){
                console.log(result)
                const message:ProcessMessage<ResultParseItemType>={
                    action:"savesearchresult",
                    data:result
                }
                process.parentPort.postMessage(JSON.stringify(message))
            })
            //console.log(port)
            //process.parentPort.postMessage(JSON.stringify(message))
            //});
            break;
        }
        case "sendEmail": {
            const emailsendModel = new EmailSend()
            if (!pme.data) {
                console.error("data is null")
                return
            }
            await emailsendModel.send(pme.data, (receiver, title, content) => {
                const senddata: EmailSendResult = {
                    receiver: receiver,
                    status: true,
                    title: title,
                    content: content
                }
                const message: ProcessMessage<EmailSendResult> = {
                    action: "EmailSendSuccess",
                    data: senddata
                }
                process.parentPort.postMessage(JSON.stringify(message))
            }, (receiver, info, title, content) => {
                const senddata: EmailSendResult = {
                    receiver: receiver,
                    status: false,
                    info: info,
                    title: title,
                    content: content
                }
                const message: ProcessMessage<EmailSendResult> = {
                    action: "EmailSendFailure",
                    data: senddata
                }
                process.parentPort.postMessage(JSON.stringify(message))
            }).then(() => {
                const message: ProcessMessage<null> = {
                    action: "sendEmailEnd",

                }
                process.parentPort.postMessage(JSON.stringify(message))
            })

        }
        case "searchEmail": {

            const userEmaildata = pme.data as EmailsControldata;

            if (!userEmaildata) {
                console.error("data is empty")
                return
            }
            const emailSearchModel = new EmailSearch()
            await emailSearchModel.searchEmail(userEmaildata, (res) => {
                const message: ProcessMessage<EmailResult> = {
                    action: "saveres",
                    data: res
                }

                process.parentPort.postMessage(JSON.stringify(message))
            })
            break;
        }
        case 'downloadVideo': {
            // const pme=JSON.parse(e.data) as ProcessMessage<processVideoDownloadParam> 
            const param = pme.data as processVideoDownloadParam
            if (!param.platform) {
                console.error("platform is empty")
                return
            }
            await downloadVideo(param).catch((error) => {
                if (error instanceof Error) {


                    const message: ProcessMessage<VideodownloadTaskMsg> = {
                        action: "videodownloadTaskMsg",
                        data: {
                            msg: error.message
                        }
                    }
                    process.parentPort.postMessage(JSON.stringify(message))

                }
            })
            process.exit(0);
            break;

        }
        case 'generateCaption': {

            //generate capation
            await generateCaption(pme.data as VideoCaptionGenerateParam).catch((error) => {
                if (error instanceof Error) {
                    const message: ProcessMessage<VideoCaptionMsg> = {
                        action: "generateCaptionMsg",
                        data: {
                            status: false,
                            msg: error.message,
                            file: "",
                            videoId: 0
                        }
                    }

                    process.parentPort.postMessage(JSON.stringify(message))
                }
            })
            process.exit(0);
            break;
        }
        case 'translateVideoInfo': {
            await translateVideoinfo(pme.data as TransItemsParam<VideoTranslateItem>)
            break;
        }
        case 'publishVideo': {
            await publishVideo(pme.data as VideoPublishParam)
            break;
        }


    }


})
async function downloadVideo(param: processVideoDownloadParam) {
    if (!param.platform) {
        console.error("platform is empty")
        return
    }
    // const videoDownloadFactory=new VideoDownloadFactory()
    const downloadTool = VideoDownloadFactory.getDownloader(param.platform)
    let randCookiesproxy: CookiesProxy | null = null;
    if (param.cookiesProxy) {
        randCookiesproxy = param.cookiesProxy[Math.floor(Math.random() * param.cookiesProxy.length)]
    }
    let itemProxy: Proxy | null = null;
    if (param.proxy) {
        itemProxy = param.proxy[Math.floor(Math.random() * param.proxy.length)]
    }
    if (param.downloadType == "keyword") {
        if(!param.max_page_number){
            param.max_page_number=10
        }
        //console.log(param.keywords)
        await downloadTool.downloadVideoByKeyword(param.keywords, param.savePath, param.max_page_number,param.BrowserName, randCookiesproxy, itemProxy, param.exePath, param.videoQuality, (link,errorstring) => {
            const message: ProcessMessage<VideodownloadMsg> = {
                action: "singlevideodownloadMsg",
                data: {
                    link: link,
                    status: false,
                    log: errorstring
                }
            }

            process.parentPort.postMessage(JSON.stringify(message))
         }, (msg) => {
            console.log(msg)
          }, (param: VideodoanloadSuccessCall) => { 
            console.log("success call")
                    const message: ProcessMessage<VideodownloadMsg> = {
                        action: "singlevideodownloadMsg",
                        data: {
                            link: param.link,
                            status: true,
                            savepath: param.savepath,
                            title: param.title,
                            description: param.description,
                            tags: param.tags,
                            categories: param.categories
                        }
                    }
                    process.parentPort.postMessage(JSON.stringify(message))
         }).catch((error) => { })
    } else {
        //download by single video or playlist


        // const youtubeDownload=new YoutubeDownload()
        // if(!param.isplaylist){//sigle video
        //param.link.forEach(async (element, index)=>{


        for (const element of param.link) {

            // if(param.downloadType=="keyword"){
            //    await downloadTool.downloadVideoByKeyword(element, param.savePath, param.BrowserName, randCookiesproxy, itemProxy, param.exePath, param.videoQuality, (errorstring) => {}, (msg) => {}, (param: VideodoadloadSuccessCall) => {}).catch((error) => {}) 
            // }else{

            if (!param.isplaylist) {//sigle video
                await downloadTool.downloadVideo(element, param.savePath, param.BrowserName, randCookiesproxy, itemProxy, param.exePath, param.videoQuality, (errorstring) => {
                    //error call
                    const message: ProcessMessage<VideodownloadMsg> = {
                        action: "singlevideodownloadMsg",
                        data: {
                            link: element,
                            status: false,
                            log: errorstring
                        }
                    }

                    process.parentPort.postMessage(JSON.stringify(message))
                    // process.exit(1);
                }, (msg) => {
                    //stdout call
                }, (param: VideodoanloadSuccessCall) => {
                    //success call
                    console.log("success call")
                    const message: ProcessMessage<VideodownloadMsg> = {
                        action: "singlevideodownloadMsg",
                        data: {
                            link: element,
                            status: true,
                            savepath: param.savepath,
                            title: param.title,
                            description: param.description,
                            tags: param.tags,
                            categories: param.categories
                        }
                    }
                    process.parentPort.postMessage(JSON.stringify(message))
                    // process.exit(0);
                }).catch((error) => {
                    if (error instanceof Error) {
                        const message: ProcessMessage<VideodownloadMsg> = {
                            action: "singlevideodownloadMsg",
                            data: {
                                link: element,
                                status: false,
                                log: error.message
                            }
                        }
                        process.parentPort.postMessage(JSON.stringify(message))
                        // process.exit(1);
                    }
                })
                //signal download end

            } else {//download playlist
                // await downloadTool.downloadPlaylist(element)
                await downloadTool.downloadPlaylist(element, param.savePath, param.BrowserName, randCookiesproxy, itemProxy, param.exePath, param.videoQuality, param.successlink, (link, errorstring) => {
                    const message: ProcessMessage<VideodownloadMsg> = {
                        action: "singlevideodownloadMsg",
                        data: {
                            link: link,
                            status: false,
                            log: errorstring
                        }
                    }

                    process.parentPort.postMessage(JSON.stringify(message))
                }, (msg) => {
                    //stdout call
                }, (param: VideodoanloadSuccessCall) => {
                    //success call
                    console.log("success call")
                    const message: ProcessMessage<VideodownloadMsg> = {
                        action: "singlevideodownloadMsg",
                        data: {
                            link: param.link,
                            status: true,
                            savepath: param.savepath,
                            title: param.title,
                            description: param.description,
                            tags: param.tags,
                            categories: param.categories
                        }
                    }
                    process.parentPort.postMessage(JSON.stringify(message))

                }, (error) => {
                    //end call
                    if (error.length > 0) {

                        const message: ProcessMessage<VideodownloadTaskMsg> = {
                            action: "videodownloadTaskMsg",
                            data: {
                                msg: error
                            }
                        }
                        process.parentPort.postMessage(JSON.stringify(message))

                        //process.exit(1);
                    } else {
                        // process.exit(0);
                    }

                }).catch((error) => {
                    if (error instanceof Error) {


                        const message: ProcessMessage<VideodownloadTaskMsg> = {
                            action: "videodownloadTaskMsg",
                            data: {
                                msg: error.message
                            }
                        }
                        process.parentPort.postMessage(JSON.stringify(message))

                    }
                })

            }
        }//download by link end
    }
}
async function generateCaption(param: VideoCaptionGenerateParam) {
    //get video caption tool
    const videoCaptionFactory = new VideoCaptionFactory()
    let captionTool: VideoCaptionImpl;
    if (!param.toolName) {
        captionTool = videoCaptionFactory.getVideoCaptionTool(param.toolName)
    } else {
        captionTool = videoCaptionFactory.getVideoCaptionTool()
    }
    console.log(param)

    if (!param.videos || param.videos.length == 0) {
        const message: ProcessMessage<VideoCaptionMsg> = {
            action: "generateCaptionMsg",
            data: {
                status: false,
                msg: "video list is empty",
                file: "",
                videoId: 0,

            }
        }

        process.parentPort.postMessage(JSON.stringify(message))
        // process.exit(1);
        return
    }
    // param.videos.forEach(async (element, index)=>{
    for (const element of param.videos) {
        let modelName = "medium"
        if (element.isEnglish) {
            modelName = "medium.en"
        }

        const data: extraFileEntity = {
            file: element.videoPath,
            savePath: element.savePath,
            // execPath:element.execPath,
            model: modelName,
            errorCall: (errorMsg: string) => {
                const message: ProcessMessage<VideoCaptionMsg> = {
                    action: "generateCaptionMsg",
                    data: {
                        status: false,
                        msg: errorMsg,
                        file: element.videoPath,
                        videoId: element.videoId
                    }
                }

                process.parentPort.postMessage(JSON.stringify(message))
            },
            stroutCall: (message: string) => {


                console.log(message)
            },
            successCall: (outputfile: string) => {
                const message: ProcessMessage<VideoCaptionMsg> = {
                    action: "generateCaptionMsg",
                    data: {
                        status: true,
                        msg: "",
                        file: element.videoPath,
                        savepath: outputfile,
                        videoId: element.videoId,
                        languageCode: element.languageCode
                    }
                }

                process.parentPort.postMessage(JSON.stringify(message))
            }
        }
        await captionTool.extractCaption(data).catch((error) => {
            if (error instanceof Error) {
                const message: ProcessMessage<VideoCaptionMsg> = {
                    action: "generateCaptionMsg",
                    data: {
                        status: false,
                        msg: error.message,
                        file: element.videoPath,
                        videoId: element.videoId
                    }
                }

                process.parentPort.postMessage(JSON.stringify(message))
            }
        })

    }

}

async function translateVideoinfo(data: TransItemsParam<VideoTranslateItem>) {
    if (!data.translate_tool) {
        console.error("translate tool is not provided")
        return
    }
    const translatePro = new TranslateProducer()

    const transTool = translatePro.getTransTool(data.translate_tool, data.llmConfig)
    if (!transTool) {
        console.error("translate tool not found")

        throw new Error("translate tool not found")
    }

    for (const item in data.items) {
        //translate title
        let title = ""
        let description = ""
        const tags: Array<VideoDownloadTagEntity> = []
        if (data.items[item].title.length > 0) {

            const titletrans = await translatePro.translateWithTool(data.items[item].source_language.name, data.target_language.name, data.items[item].title, transTool)
            if (titletrans) {
                title = titletrans
            }

        }
        if (data.items[item].description.length > 0) {

            const desctrans = await translatePro.translateWithTool(data.items[item].source_language.name, data.target_language.name, data.items[item].description, transTool)
            if (desctrans) {
                description = desctrans
            }
        }
        if (data.items[item].tags) {
            for (const tag in data.items[item].tags) {
                if (tag.length > 0) {
                    const tagtrans = await translatePro.translateWithTool(data.items[item].source_language.name, data.target_language.name, tag, transTool)
                    if (tagtrans) {
                        const videotag = new VideoDownloadTagEntity()
                        videotag.video_id = data.items[item].videoId
                        videotag.tag = tagtrans
                        videotag.language = data.target_language.name

                        tags.push(videotag)
                    }
                }
            }
        }
        const message: ProcessMessage<CommonMessage<VideoTranslateItem>> = {
            action: "translateVideoInfoMsg",
            data: {
                status: true,
                msg: "",
                data: {
                    videoId: data.items[item].videoId,
                    title: title,
                    description: description,
                    tags: tags,
                    source_language: data.target_language,
                }
            }
        }
        process.parentPort.postMessage(JSON.stringify(message))

    }
}
async function publishVideo(param: VideoPublishParam){
    const videoPublishService = new VideoPublishService();
    try{
        const result = await videoPublishService.publishVideo(param.videoEntity, param.platform, param.options);
        if(result){
            const message: ProcessMessage<VideoPublishMsg> = {
                action: "publishVideoMsg",
                data: {
                    status: true,
                    msg: "",
                    publishRecord: result
                }
            
            }
            process.parentPort.postMessage(JSON.stringify(message))
           
        }else{
            const message: ProcessMessage<VideoPublishMsg> = {
                action: "publishVideoMsg",
                data: {
                    status: false,
                    msg: "publish video failed"
                }
            }
            process.parentPort.postMessage(JSON.stringify(message))
        }
    }catch(error){
        console.error(error)
        const message: ProcessMessage<VideoPublishMsg> = {
            action: "publishVideoMsg",
            data: {
                status: false,
                msg: error instanceof Error ? error.message : "unknown error"
            }
        }
        process.parentPort.postMessage(JSON.stringify(message))
    }
}
import { ipcMain } from 'electron';
import { VIDEODOWNLOAD, VIDEODOWNLOAD_MESSAGE, VIDEODOWNLOAD_TASK_LIST, VIDEODOWNLOAD_LIST, VIDEODOWNLOADTASK_RETRY, VIDEODOWNLOADITEM_RETRY, VIDEODOWNLOAD_ITEM_MESSAGE, VIDEODOWNLOADITEM_EXPLORER, VIDEODOWNLOADITEM_DELETE, VIDEODOWN_TASK_ERROR_LOG_QUERY, VIDEO_CAPTION_GENERATE, VIDEOTASKDOWNLOAD_RETRY_MESSAGE, VIDEODOWNLOAD_LOG_QUERY, VIDEODOWNLOAD_DETAIL_QUERY, VIDEODOWNLOAD_OPEN_CAPTIONFILE, VIDEO_VOICE_TRANSLATE, VIDEO_INFORMATION_TRANSLATE, VIDEO_PUBLISH, SYSTEM_MESSAGE, VIDEO_PUBLISH_RECORD_LIST, VIDEO_PUBLISH_RECORD_DELETE, VIDEO_PUBLISH_RECORD_MESSAGE } from '@/config/channellist'
import { VideoController } from '@/controller/VideoController';
import { CommonDialogMsg, CommonResponse, CommonIdrequest, CommonMessage, CommonIdrequestType } from "@/entityTypes/commonType";
import { CustomError } from '@/modules/customError';
import { VideoDownloadTaskEntityType, VideoDownloadQuery, VideoDownloadListDisplay, DownloadVideoControlparam, VideoCaptionGenerateParamWithIds, VideoCompotionEntity, VideoInformationTransParam } from "@/entityTypes/videoType";
import { VideoPublishRequest, PublishRecordQuery } from '@/entityTypes/videoPublishType'
import { VideoPublishRecordEntity } from '@/entity/VideoPublishRecord.entity'

export function registerVideoIpcHandlers() {
    console.log("video download register")
    
    ipcMain.on(VIDEODOWNLOAD, async (event, arg) => {
        const videoCtrl = new VideoController()
        // console.log("get video download message")
        const qdata = JSON.parse(arg) as DownloadVideoControlparam;
        if (!("accountId" in qdata)) {
            // throw new Error("accountId not found");
            const comMsgs: CommonDialogMsg = {
                status: false,
                code: 202240521105617,
                data: {
                    title: "video.download_failed",
                    content: "video.account_id_not_found"
                }
            }
            event.sender.send(VIDEODOWNLOAD_MESSAGE, comMsgs)
            return
        }
        if (!("platform" in qdata)) {
            // throw new Error("platform not found");
            const comMsgs: CommonDialogMsg = {
                status: false,
                code: 2024052110230,
                data: {
                    title: "video.download_failed",
                    content: "video.platform_not_found"
                }
            }
            event.sender.send(VIDEODOWNLOAD_MESSAGE, comMsgs)
            return
        }
        // if (!("link" in qdata)) {
        //     // throw new Error("link not found");
        //     const comMsgs: CommonDialogMsg = {
        //         status: false,
        //         code: 20240521105843,
        //         data: {
        //             title: "video.download_failed",
        //             content: "video.link_not_found"
        //         }
        //     }
        //     event.sender.send(VIDEODOWNLOAD_MESSAGE, comMsgs)
        //     return
        // }
        if (!("savePath" in qdata)) {
            // throw new Error("savePath not found");
            const comMsgs: CommonDialogMsg = {
                status: false,
                code: 20240521105856,
                data: {
                    title: "video.download_failed",
                    content: "video.savePath_not_found"
                }
            }
            event.sender.send(VIDEODOWNLOAD_MESSAGE, comMsgs)
            return
        }
        // if (!("isplaylist" in qdata)) {

        // }


        // const dvp: downloadVideoparam = {
        //     accountId: qdata.accountId,
        //     platform: qdata.platform,
        //     link: qdata.link,
        //     savePath: qdata.savePath,
        //     isplaylist:qdata.isplaylist
        // }

        await videoCtrl.downloadVideo(qdata, () => {
            // if(taskId){
            const videoMsgs: CommonDialogMsg = {
                status: true,
                code: 200,
                data: {
                    title: "video.download_start",
                    content: "video.revice_download_command"
                }
            }
            event.sender.send(VIDEODOWNLOAD_MESSAGE, videoMsgs)
            // }

        }).catch(function (error) {
            console.log("error:" + error)
            if (error instanceof CustomError) {
                const comMsgs: CommonDialogMsg = {
                    status: false,
                    code: error.code,
                    data: {
                        title: "video.download_failed",
                        content: error.message
                    }
                }
                event.sender.send(VIDEODOWNLOAD_MESSAGE, comMsgs)
                return

            } else if (error instanceof Error) {
                const comMsgs: CommonDialogMsg = {
                    status: false,
                    code: 20240513142039,
                    data: {
                        title: "video.download_failed",
                        content: error.message
                    }
                }
                event.sender.send(VIDEODOWNLOAD_MESSAGE, comMsgs)
                return
            }
        })

        return
    })
    //get video download list
    ipcMain.handle(VIDEODOWNLOAD_TASK_LIST, async (event, data) => {
        const qdata = JSON.parse(data);
        if (!("page" in qdata)) {
            qdata.page = 0
        }
        if (!("size" in qdata)) {
            qdata.size = 10
        }
        //return video download list
        const videoCtrl = new VideoController()
        const res = await videoCtrl.videoDownloadtasklist(qdata.page, qdata.size)
        const resp: CommonResponse<VideoDownloadTaskEntityType> = {
            status: true,
            msg: "video.download_list",
            data: res
        }
        return resp
    })
    //get video download list by task id
    ipcMain.handle(VIDEODOWNLOAD_LIST, async (event, data) => {
        const videoCtrl = new VideoController()
        const qdata = JSON.parse(data) as VideoDownloadQuery;
        if (!("taskId" in qdata)) {
            throw new Error("taskId not found");
        }

        const res = await videoCtrl.videoDownloadlist(qdata.taskId, qdata.page, qdata.size)
        const resp: CommonResponse<VideoDownloadListDisplay> = {
            status: true,
            msg: "video.download_list",
            data: res
        }
        return resp
    })
    ipcMain.on(VIDEODOWNLOADTASK_RETRY, async (event, data) => {
        const videoCtrl = new VideoController()
        const qdata = JSON.parse(data) as VideoDownloadQuery;
        if (!("taskId" in qdata)) {
            throw new Error("taskId not found");
        }
        await videoCtrl.retryDownloadvideo(qdata.taskId, () => {
            const videoMsgs: CommonDialogMsg = {
                status: true,
                code: 200,
                data: {
                    title: "video.download_start",
                    content: "video.revice_download_command"
                }
            }
            event.sender.send(VIDEOTASKDOWNLOAD_RETRY_MESSAGE, videoMsgs)
        })
    })
    //retry download video item by id
    ipcMain.on(VIDEODOWNLOADITEM_RETRY, async (event, data) => {
        const videoCtrl = new VideoController()
        const qdata = JSON.parse(data) as CommonIdrequest<number>
        if (!("id" in qdata)) {
            throw new Error("id not found");
        }
        await videoCtrl.redownloadItembyId(qdata.id, () => {
            const videoMsgs: CommonDialogMsg = {
                status: true,
                code: 200,
                data: {
                    title: "video.download_start",
                    content: "video.revice_download_command"
                }
            }
            event.sender.send(VIDEODOWNLOAD_ITEM_MESSAGE, videoMsgs)
        })


    })
    //open file in explorer
    ipcMain.on(VIDEODOWNLOADITEM_EXPLORER, async (event, data) => {
        const videoCtrl = new VideoController()
        const qdata = JSON.parse(data) as CommonIdrequest<number>
        if (!("id" in qdata)) {
            throw new Error("id not found");
        }
        await videoCtrl.showFileExplorer(qdata.id)

    })

    ipcMain.on(VIDEODOWNLOADITEM_DELETE, async (event, data) => {
        const videoCtrl = new VideoController()
        const qdata = JSON.parse(data) as CommonIdrequest<number>
        if (!("id" in qdata)) {
            throw new Error("id not found");
        }
        await videoCtrl.deleteVideoDownloadItem(qdata.id)

    })
    ipcMain.handle(VIDEODOWN_TASK_ERROR_LOG_QUERY, async (event, data) => {
        const videoCtrl = new VideoController()
        // readTaskErrorlog
        const qdata = JSON.parse(data) as CommonIdrequestType<number>
        if (!("id" in qdata)) {
            throw new Error("id not found");
        }
        const res = await videoCtrl.readTaskErrorlog(qdata.id).then((data) => {
            const videoMsgs: CommonMessage<string> = {
                status: true,
                msg: "",
                data: data
            }
            return videoMsgs
            // event.sender.send(VIDEODOWN_TASK_ERROR_LOG, videoMsgs)
        }).catch((error) => {
            if (error instanceof Error) {
                const videoMsgs: CommonMessage<string> = {
                    status: false,
                    msg: error.message
                }
                return videoMsgs
                // event.sender.send(VIDEODOWN_TASK_ERROR_LOG, videoMsgs)
            }

        })
        return res
    })

    ipcMain.on(VIDEO_CAPTION_GENERATE, async (event, data) => {
        const qdata = JSON.parse(data) as VideoCaptionGenerateParamWithIds<number>
        if (!("ids" in qdata)) {
            throw new Error("id not found");
        }
        const startMsg: CommonDialogMsg = {
            status: true,
            code: 0,
            data: {
                title: "video.caption_generate_start",
                content: "video.caption_generate_start"
            }
        }
        event.sender.send(SYSTEM_MESSAGE, startMsg)
        const videoCtrl = new VideoController()
        await videoCtrl.generateCaptionbyids(qdata, (errorMsg) => {
            //const videoCtrl = new VideoController()
            const videoMsgs: CommonDialogMsg = {
                status: false,
                code: 20240513142039,
                data: {
                    title: "video.caption_generate_failed",
                    content: errorMsg
                }
            }
            event.sender.send(SYSTEM_MESSAGE, videoMsgs)
        }).catch((error) => {
            if (error instanceof Error) {
                const videoMsgs: CommonDialogMsg = {
                    status: false,
                    code: 20240513142039,
                    data: {
                        title: "video.caption_generate_failed",
                        content: error.message
                    }
                }
                event.sender.send(SYSTEM_MESSAGE, videoMsgs)
                return
            }
        })




    })
    ipcMain.handle(VIDEODOWNLOAD_LOG_QUERY, async (event, data) => {
        const qdata = JSON.parse(data) as CommonIdrequestType<number>
        if (!("id" in qdata)) {
            throw new Error("id not found");
        }
        try {
            const videoCtrl = new VideoController()
            const content = await videoCtrl.getVideoErrorlog(qdata.id)
            const videoMsgs: CommonMessage<string> = {
                status: true,
                msg: "",
                data: content
            }
            // console.log(videoMsgs)
            return videoMsgs

            // if(videoCompositeEntity){
            //     const videoMsgs: CommonMessage<string> = {
            //         status: true,
            //         msg: "",

            //     }

            // }
        } catch (error) {
            if (error instanceof Error) {
                const videoMsgs: CommonMessage<string> = {
                    status: false,
                    msg: error.message
                }
                return videoMsgs
            }
        }
    })
    ipcMain.handle(VIDEODOWNLOAD_DETAIL_QUERY, async (event, data) => {
        try {
            const videoCtrl = new VideoController()
            const qdata = JSON.parse(data) as CommonIdrequest<number>
            if (!("id" in qdata)) {
                throw new Error("id not found");
            }
            const content: VideoCompotionEntity = await videoCtrl.getVideoinfo(qdata.id)
            console.log(content)
            const videoMsgs: CommonMessage<VideoCompotionEntity> = {
                status: true,
                msg: "",
                data: content
            }
            return videoMsgs

        } catch (error) {
            console.error(error)
            if (error instanceof Error) {
                const videoMsgs: CommonMessage<VideoCompotionEntity> = {
                    status: false,
                    msg: error.message
                }
                return videoMsgs
            }
        }
    })
    ipcMain.on(VIDEODOWNLOAD_OPEN_CAPTIONFILE, async (event, data) => {
        try {
            const qdata = JSON.parse(data) as CommonIdrequest<number>
            if (!("id" in qdata)) {
                throw new Error("id not found");
            }
            const videoCtrl = new VideoController()
            videoCtrl.showCaptionFileExplorer(qdata.id)
        } catch (error) {
            if (error instanceof Error) {
                const videoMsgs: CommonDialogMsg = {
                    status: false,
                    code: 202502111129,
                    data: {
                        title: "video.open_caption_file_error",
                        content: error.message
                    }
                }
                event.sender.send(SYSTEM_MESSAGE, videoMsgs)
                return
            }
        }
    })
    //translate video information
    ipcMain.on(VIDEO_INFORMATION_TRANSLATE, async (event, data) => {
        const qdata = JSON.parse(data) as VideoInformationTransParam<number>
        if (!("ids" in qdata)) {
            throw new Error("ids not found");
        }
        if (!("target_language" in qdata)) {
            throw new Error("target_language not found");
        }
        if(!("translate_tool" in qdata)){
            throw new Error("translate_tool not found");
        }
        const videoCtrl = new VideoController()
        await videoCtrl.tranVideoinfo(qdata).catch((error) => {
            if (error instanceof CustomError) {
                const comMsgs: CommonDialogMsg = {
                    status: false,
                    code: error.code,
                    data: {
                        title: "video.translate_failed",
                        content: error.message
                    }
                }
                event.sender.send(SYSTEM_MESSAGE, comMsgs)
                return

            } else if (error instanceof Error) {
                const comMsgs: CommonDialogMsg = {
                    status: false,
                    code: 202503131440391,
                    data: {
                        title: "video.translate_failed",
                        content: error.message
                    }
                }
                event.sender.send(SYSTEM_MESSAGE, comMsgs)
                return
            }
        })
    })
    //translate video voice
    ipcMain.on(VIDEO_VOICE_TRANSLATE, async (event, data) => {
        const qdata = JSON.parse(data) as CommonIdrequest<number>
        if (!("id" in qdata)) {
            throw new Error("id not found");
        }

       

    })
    //publish video
    ipcMain.on(VIDEO_PUBLISH, async (event, data) => {
        try {
            const qdata = JSON.parse(data) as VideoPublishRequest;
            if (!("videoId" in qdata)) {
                throw new Error("videoId not found");
            }
            if (!("platform" in qdata)) {
                throw new Error("platform not found");
            }
            if (!("category" in qdata)) {
                throw new Error("category not found");
            }
            if (!("accountId" in qdata)) {
                throw new Error("accountId not found");
            }

            const videoCtrl = new VideoController();
            await videoCtrl.publishVideo(qdata.videoId, qdata.platform, qdata.category, qdata.accountId,()=>{
                const successMsg: CommonDialogMsg = {
                    status: true,
                    code: 200,
                    data: {
                        title: "video.publish_success",
                        content: "video.publish_success_message"
                    }
                };
                event.sender.send(SYSTEM_MESSAGE, successMsg);  
            },(error)=>{
                const errorMsg: CommonDialogMsg = {
                    status: false,
                    code: 202506161003457,
                    data: {
                        title: "video.publish_failed",
                        content: error
                    }
                };
                event.sender.send(SYSTEM_MESSAGE, errorMsg);
            });
            
            const successMsg: CommonDialogMsg = {
                status: true,
                code: 200,
                data: {
                    title: "video.publish_success",
                    content: "video.publish_success_message"
                }
            };
            event.sender.send(SYSTEM_MESSAGE, successMsg);
        } catch (error) {
            console.error("Video publish error:", error);
            const errorMsg: CommonDialogMsg = {
                status: false,
                code: error instanceof CustomError ? error.code : 20240521105843,
                data: {
                    title: "video.publish_failed",
                    content: error instanceof Error ? error.message : "Unknown error occurred"
                }
            };
            event.sender.send(SYSTEM_MESSAGE, errorMsg);
        }
    });

    // Get publish records
    ipcMain.handle(VIDEO_PUBLISH_RECORD_LIST, async (_, param: string) => {
        const videoCtrl = new VideoController();
        const qdata = JSON.parse(param) as PublishRecordQuery;
        const res = await videoCtrl.getPublishRecords(qdata);
        const resp: CommonResponse<VideoPublishRecordEntity> = {
            status: true,
            msg: "video.publish_records",
            data: res
        };
        return resp;
    });

    // Delete publish record
    ipcMain.handle(VIDEO_PUBLISH_RECORD_DELETE, async (_, id: number) => {
        const videoCtrl = new VideoController();
        const res = await videoCtrl.deletePublishRecord(id);
        const resp: CommonMessage<boolean> = {
            status: true,
            msg: "video.publish_record_deleted",
            data: res
        };
        return resp;
    });
}

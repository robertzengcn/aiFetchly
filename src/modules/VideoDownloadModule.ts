// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
import { VideoDownloadModel } from "@/model/VideoDownload.model";
import {VideoDownloadStatus,VideoCaptionStatus} from "@/entityTypes/videoType"
import { BaseModule } from "@/modules/baseModule";
import { WriteLog,getLogPath } from "@/modules/lib/function";
import * as fs from 'fs';
import { readLogFile } from "@/modules/lib/function"
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity";

export class VideoDownloadModule extends BaseModule{
    // private dbpath: string
    private videoDownloaddb:VideoDownloadModel
    constructor() {
      super()
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        // this.dbpath = dbpath
        this.videoDownloaddb=new VideoDownloadModel(this.dbpath)
    }

      public async saveVideoDownload(videoDownload:VideoDownloadEntity):Promise<number>{
        return await this.videoDownloaddb.saveVideoDownload(videoDownload)
      } 
      public async updateVideoDownload(videoId:number,videoDownload:Omit<VideoDownloadEntity,"error_log">):Promise<number>{
        return await this.videoDownloaddb.updateVideoDownloadItem(videoId,videoDownload)
      } 
      //save log for video download
      public async saveVideoDownloadLog(log:string,downloadId:number){
        //get error log file path
        const res=await this.videoDownloaddb.getVideoDownloaditem(downloadId)
        if(!res){
          throw new Error("video download item not exist")
        }
        if(res.error_log){
        //save log file
        WriteLog(res.error_log,log)
        }else{
          //generate log file path
          const logpath=getLogPath('videodownload',downloadId.toString())
          WriteLog(logpath,log)
          this.videoDownloaddb.updateVideoErrorLogPath(downloadId,logpath)

        }
       //return this.videoDownloaddb.saveVideoDownloadLog(log,downloadId)
      } 

      //update download status
      public async updateVideoDownloadStatus(status:VideoDownloadStatus,downloadId:number):Promise<number>{
       return await this.videoDownloaddb.updateVideoDownloadStatus(status,downloadId)
      }
      //get video download list
      public async getVideoDownloadList(taskId:number,page:number,size:number,status?:VideoDownloadStatus):Promise<Array<VideoDownloadEntity>>{
        return await this.videoDownloaddb.getVideoDownloadList(taskId,page,size,status)
      }
      //count video download list
      public async countVideoDownloadList(taskId:number,status?:VideoDownloadStatus):Promise<number>{
        return await this.videoDownloaddb.countVideoDownloadList(taskId,status)
      }
      //get all video download info list by task id
      public async getAllvideoDownloadlist(taskId:number,status?:VideoDownloadStatus):Promise<Array<VideoDownloadEntity>>{
        //count video number by task id
        const count=await this.countVideoDownloadList(taskId)
        const res:Array<VideoDownloadEntity>=[]
        for(let i=0;i<count;i=i+100){
          const list=await this.getVideoDownloadList(taskId,i,100,status)
          res.push(...list)
        }
        return res
      }
      //get video download item info by id
      public async getVideoDownloaditem(id:number):Promise<VideoDownloadEntity|null>{
        return await this.videoDownloaddb.getVideoDownloaditem(id)
      }
      public async deleteVideoDownloadItem(id:number):Promise<number>{
        return await this.videoDownloaddb.deleteVideoDownloadItem(id)
      }
      public async updateVideoCaptionStatus(id: number,status: VideoCaptionStatus ): Promise<number> {
        return await this.videoDownloaddb.updateVideoCaptionStatus( id,status);
    }
    //get video item log
    public async getVideoErrorLog(id:number): Promise<string> {
        const videodownEntity=await this.getVideoDownloaditem(id)
        if(!videodownEntity){
          throw new Error("video download item not exist")
        }
        let content=""
        if(!videodownEntity.error_log){
          return content
        }
        if (fs.existsSync(videodownEntity.error_log)) {
                       content = await readLogFile(videodownEntity.error_log)
        } else {
            throw new Error("video error file log not found")
        }
        return content
    }
    


    
}
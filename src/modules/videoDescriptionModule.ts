// import {VideoDescriptiondb} from "@/model/videoDescriptiondb";
import {VideoDescriptionModel} from "@/model/VideoDescription.model";
import { VideoDescriptionEntity } from "@/entity/VideoDescription.entity"
//import { Token } from "@/modules/token"
//import { USERSDBPATH } from '@/config/usersetting';
// import { VideoDescriptionEntity } from "@/entityTypes/videoType";
import { BaseModule } from "@/modules/baseModule";
import { getRecorddatetime } from "@/modules/lib/function";
import {LanguageCode} from "@/entityTypes/commonType"
//import { inherits } from "util";
export class VideoDescriptionModule extends BaseModule{
    //private dbpath: string
    // private videoDownloaddb:VideoDescriptiondb
    private videoDescriptionModel:VideoDescriptionModel
    constructor() {
        super()
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        //this.dbpath = dbpath
        // this.videoDownloaddb=new VideoDescriptiondb(this.dbpath)
        this.videoDescriptionModel=new VideoDescriptionModel(this.dbpath)
    }
    async saveVideoDescription(videoinfo: VideoDescriptionEntity):Promise<number> {
        if(!videoinfo.record_time){
            videoinfo.record_time=getRecorddatetime()
        }
        return this.videoDescriptionModel.saveVideoDescription(videoinfo)
    }
    async getVideoDescription(videoId: number,language:LanguageCode): Promise<VideoDescriptionEntity|null> {
        return await this.videoDescriptionModel.getVideoDescription(videoId,language)
    }
    async deleteVideoDescription(videoId: number): Promise<number> {
        return await this.videoDescriptionModel.deleteVideoDescription(videoId)
    }
    //get video translate info that language not equal to the input language
    async getVideoDescriptionOtherLanguage(videoId: number,language:LanguageCode): Promise<Array<VideoDescriptionEntity> | null> {
        return await this.videoDescriptionModel.getVideoDescriptionOtherLanguage(videoId,language)
    }

}
// import {VideoDescriptiondb} from "@/model/videoDescriptiondb";
import {VideoDownloadTagModel} from "@/model/VideoDownloadTag.model";
import { VideoDownloadTagEntity } from "@/entity/VideoDownloadTag.entity"
//import { Token } from "@/modules/token"
//import { USERSDBPATH } from '@/config/usersetting';
// import { VideoDescriptionEntity } from "@/entityTypes/videoType";
import { BaseModule } from "@/modules/baseModule";
//import { inherits } from "util";
export class VideoDownloadTagModule extends BaseModule{
    //private dbpath: string
    // private videoDownloaddb:VideoDescriptiondb
    private videoDownloadTagModel:VideoDownloadTagModel
    constructor() {
        super()
        this.videoDownloadTagModel=new VideoDownloadTagModel(this.dbpath)
    }
   //add data to video_download_tag
   public async create(vdte: VideoDownloadTagEntity): Promise<number> {
    
    return this.videoDownloadTagModel.create(vdte)
}
//get video tag by video_id
public async getVideoTag(videoId: number,language:string): Promise<VideoDownloadTagEntity[]> {
    return this.videoDownloadTagModel.getVideoTag(videoId,language)
}

}
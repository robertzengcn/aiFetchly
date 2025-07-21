import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import {VideoDownloadTagEntity} from "@/entity/VideoDownloadTag.entity"

export class VideoDownloadTagModel extends BaseDb {
    private repository: Repository<VideoDownloadTagEntity>
    constructor(filepath: string) {
        super(filepath)
      
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadTagEntity)
    }
    //add data to video_download_tag
    public async create(vdte: VideoDownloadTagEntity): Promise<number> {
        const res=await this.repository.save(vdte)
        return res.id
    }
    //get video tag by video_id
    public async getVideoTag(videoId: number,language:string): Promise<VideoDownloadTagEntity[]> {
        return this.repository.find({ where: { video_id: videoId,language:language } });
    }

}
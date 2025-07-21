import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import {VideoDownloadTaskDetailEntity} from "@/entity/VideoDownloadTaskDetail.entity"
export class VideoDownloadTaskDetailModel extends BaseDb {
    private repository: Repository<VideoDownloadTaskDetailEntity>
    constructor(filepath: string) {
        super(filepath)
      
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadTaskDetailEntity)
    }
    //add data to video_download_task_detail
    public async create(vdte: VideoDownloadTaskDetailEntity): Promise<number> {
        let proxy_override=0
        if(vdte.proxy_override){
            proxy_override=1
        }
        const res=await this.repository.save(vdte)
        return res.id
    }
    //get data from video_download_task_detail by id
    public async read(id: number): Promise<VideoDownloadTaskDetailEntity> {
        const res = await this.repository.findOne({
            where: {
                id: id
            }
        });
        if (!res) {
            throw new Error("VideoDownloadTaskDetail not found");
        }
        return res;
    }

    //update data in video_download_task_detail
    public async update(id: number, vdte: VideoDownloadTaskDetailEntity): Promise<void> {
        const existingEntity = await this.repository.findOne({
            where: {
                id: id
            }
        });
        
        if (!existingEntity) {
            throw new Error("VideoDownloadTaskDetail not found");
        }
        
        await this.repository.update(id, vdte);
    }

    //delete data from video_download_task_detail
    public async delete(id: number): Promise<void> {
        const result = await this.repository.delete(id);
        
        if (result.affected === 0) {
            throw new Error("VideoDownloadTaskDetail not found");
        }
    }

    //get data from video_download_task_detail by task_id
    public async getByTaskId(taskId: number): Promise<VideoDownloadTaskDetailEntity> {
        const res = await this.repository.findOne({
            where: {
                task_id: taskId
            }
        });
        
        if (!res) {
            throw new Error("VideoDownloadTaskDetail not found for task id: " + taskId);
        }
        
        return res;
    }

}
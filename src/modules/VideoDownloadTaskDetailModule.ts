// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
// import { VideoDownloadTaskDetaildb} from "@/model/VideoDownloadTaskDetaildb"
import { VideoDownloadTaskDetailEntity} from "@/entity/VideoDownloadTaskDetail.entity"
import {VideoDownloadTaskDetailModel} from "@/model/VideoDownloadTaskDetail.model"
// import { VideoDownloadTaskEntity } from "@/entityTypes/videoType"
// import {TaskStatus} from "@/entityTypes/commonType"
import { BaseModule } from "@/modules/baseModule";
export class VideoDownloadTaskDetailModule extends BaseModule {
    // private dbpath: string
    private videoDownloadTaskdb: VideoDownloadTaskDetailModel
    constructor() {
        super()
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        // this.dbpath = dbpath
        this.videoDownloadTaskdb = new VideoDownloadTaskDetailModel(this.dbpath)
    }

    async create(vdte: VideoDownloadTaskDetailEntity): Promise<number> {
        return await this.videoDownloadTaskdb.create(vdte);
    }

    async read(id: number): Promise<VideoDownloadTaskDetailEntity> {
        return await this.videoDownloadTaskdb.read(id);
    }

    async update(id: number, vdte: VideoDownloadTaskDetailEntity): Promise<void> {
        return await this.videoDownloadTaskdb.update(id, vdte);
    }

    async delete(id: number): Promise<void> {
        return await this.videoDownloadTaskdb.delete(id);
    }

    //query item id by task id
    public async getByTaskId(taskId: number): Promise<VideoDownloadTaskDetailEntity> {
        return await this.videoDownloadTaskdb.getByTaskId(taskId);
    }

}
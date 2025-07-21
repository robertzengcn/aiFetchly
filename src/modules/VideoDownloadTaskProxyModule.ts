import { VideoDownloadTaskProxyModel } from "@/model/VideoDownloadTaskProxy.model";
import { BaseModule } from "@/modules/baseModule";
// import { VideoDownloadTaskUrlEntity } from "@/entityTypes/videoType"
import {VideoDownloadTaskProxyEntityType} from "@/entityTypes/videoType"
import { VideoDownloadTaskProxyEntity } from "@/entity/VideoDownloadTaskProxy.entity";
export class VideoDownloadTaskProxyModule extends BaseModule {
    private videoDownloadTaskProxydb: VideoDownloadTaskProxyModel
    constructor() {
        super()
        this.videoDownloadTaskProxydb = new VideoDownloadTaskProxyModel(this.dbpath)
    }
    async create(vdte: VideoDownloadTaskProxyEntityType): Promise<number> {
        const vdteEntity = new VideoDownloadTaskProxyEntity();
        vdteEntity.task_id = vdte.task_id;
        vdteEntity.proxy_id = vdte.proxy_id;
        
        return await this.videoDownloadTaskProxydb.create(vdteEntity);
    }

    async read(id: number): Promise<VideoDownloadTaskProxyEntity | null> {
        return await this.videoDownloadTaskProxydb.read(id);
    }

    async update(id: number, vdte: VideoDownloadTaskProxyEntity): Promise<void> {
        await this.videoDownloadTaskProxydb.update(id, vdte);
    }

    async delete(id: number): Promise<void> {
        await this.videoDownloadTaskProxydb.delete(id);
    }

    //query items id by task id
    public async getItemsByTaskId(taskId: number): Promise<Array<VideoDownloadTaskProxyEntity>> {
        return await this.videoDownloadTaskProxydb.getItemsByTaskId(taskId);
    }
}
import { VideoDownloadTaskUrlModel } from "@/model/VideoDownloadTaskUrl.model";
import { BaseModule } from "@/modules/baseModule";
import { VideoDownloadTaskUrlsEntity } from "@/entity/VideoDownloadTaskUrls.entity";

export class VideoDownloadTaskUrlModule extends BaseModule {
    private videoDownloadTaskUrldb: VideoDownloadTaskUrlModel;
    constructor() {
        super();
        this.videoDownloadTaskUrldb = new VideoDownloadTaskUrlModel(this.dbpath);
    }

    async create(vdte: VideoDownloadTaskUrlsEntity): Promise<number> {
        return await this.videoDownloadTaskUrldb.create(vdte);
    }

    async read(id: number): Promise<VideoDownloadTaskUrlsEntity | null> {
        return await this.videoDownloadTaskUrldb.read(id);
    }

    async update(id: number, vdte: VideoDownloadTaskUrlsEntity): Promise<void> {
        await this.videoDownloadTaskUrldb.update(id, vdte);
    }

    async delete(id: number): Promise<void> {
        await this.videoDownloadTaskUrldb.delete(id);
    }

    //query items id by task id
    async getItemsByTaskId(taskId: number): Promise<VideoDownloadTaskUrlsEntity[]> {
        return await this.videoDownloadTaskUrldb.getItemsByTaskId(taskId);
    }
}
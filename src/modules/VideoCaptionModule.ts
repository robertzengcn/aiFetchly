import { BaseModule } from "@/modules/baseModule";
import { VideoCaptionModel } from "@/model/VideoCaption.model";
//import { VideoCaptionEntity } from "@/entityTypes/videoType";
import { VideoCaptionEntity } from "@/entity/VideoCaption.entity";

export class VideoCaptionModule extends BaseModule {
    private videoCaptionModel: VideoCaptionModel;

    constructor() {
        super();
        this.videoCaptionModel = new VideoCaptionModel(this.dbpath);
    }

    async create(videoCaption: VideoCaptionEntity): Promise<number> {
        return await this.videoCaptionModel.create(videoCaption);
    }

    async read(id: number): Promise<VideoCaptionEntity | null> {
        return await this.videoCaptionModel.read(id);
    }

    async update(id: number, videoCaption: VideoCaptionEntity): Promise<void> {
        await this.videoCaptionModel.update(id, videoCaption);
    }

    async delete(id: number): Promise<void> {
        await this.videoCaptionModel.delete(id);
    }

    async getCaptionByVid(vid: number): Promise<Array<VideoCaptionEntity>> {
        return await this.videoCaptionModel.getCaptionByVid(vid);
    }

    async getCaptionByVidLid(videoId: number, languageCode: string): Promise<VideoCaptionEntity | null> {
        return await this.videoCaptionModel.getCaptionByVidLid(videoId, languageCode);
    }
}
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { VideoCaptionEntity } from "@/entity/VideoCaption.entity";
import { VideoCaptionEntity as VideoCaptionType } from "@/entityTypes/videoType";

export class VideoCaptionModel extends BaseDb {
    private repository: Repository<VideoCaptionEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VideoCaptionEntity);
    }

    /**
     * Create or update video caption
     */
    async create(videoCaption: VideoCaptionEntity): Promise<number> {
        const existingCaption = await this.getCaptionByVidLid(videoCaption.video_id, videoCaption.language);
        
        if (existingCaption && existingCaption.id) {
            await this.update(existingCaption.id, videoCaption);
            return existingCaption.id;
        } else {
            const newCaption = new VideoCaptionEntity();
            newCaption.video_id = videoCaption.video_id;
            newCaption.language = videoCaption.language;
            newCaption.caption_path = videoCaption.caption_path;
            newCaption.record_time = new Date().toISOString();
            
            const savedCaption = await this.repository.save(newCaption);
            return savedCaption.id;
        }
    }

    /**
     * Read video caption by id
     */
    async read(id: number): Promise<VideoCaptionEntity | null> {
        return this.repository.findOne({ where: { id } }) as unknown as Promise<VideoCaptionEntity | null>;
    }

    /**
     * Update video caption
     */
    async update(id: number, videoCaption: VideoCaptionEntity): Promise<void> {
        await this.repository.update(id, {
            video_id: videoCaption.video_id,
            language: videoCaption.language,
            caption_path: videoCaption.caption_path,
            record_time: new Date().toISOString()
        });
    }

    /**
     * Delete video caption by video id
     */
    async delete(videoId: number): Promise<void> {
        await this.repository.delete({ video_id: videoId });
    }

    /**
     * Get caption by video id and language id
     */
    async getCaptionByVidLid(videoId: number, languageCode: string): Promise<VideoCaptionEntity | null> {
        return this.repository.findOne({
            where: { video_id: videoId, language: languageCode }
        }) as unknown as Promise<VideoCaptionEntity | null>;
    }

    /**
     * Get all captions by video id
     */
    async getCaptionByVid(videoId: number): Promise<VideoCaptionEntity[]> {
        return this.repository.find({
            where: { video_id: videoId }
        }) as unknown as Promise<VideoCaptionEntity[]>;
    }

    /**
     * Truncate the database table
     */
    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 
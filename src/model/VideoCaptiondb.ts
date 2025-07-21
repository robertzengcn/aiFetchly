import { getRecorddatetime } from "@/modules/lib/function";
import { BaseDb } from "@/model/Basedb";
import { VideoCaptionEntity } from "@/entityTypes/videoType";
// import { LanguageEnum } from "@/config/generate"
export class VideoCaptiondb extends BaseDb {
    private _table = "video_caption";
    create(videoCaption: VideoCaptionEntity): number {
        const res = this.getCaptionByVidLid(videoCaption.videoId, videoCaption.language_id)
        if (res && res.id) {//item exist
            this.update(res.id, videoCaption)
            return res.id
        } else {

            const stmt = this.db.prepare('INSERT INTO '+this._table+' (video_id, language_id, caption_path,record_time) VALUES (?, ?, ?, ?)');
            // const params = [videoCaption.id, videoCaption.videoId, videoCaption.caption, getRecorddatetime()];
            // await this.execute(query, params);
            const info = stmt.run(
                videoCaption.videoId,
                videoCaption.language_id,
                videoCaption.caption_path,
                getRecorddatetime()
            );
            return Number(info.lastInsertRowid);
        }
    }

    read(id: number): VideoCaptionEntity | null {
        const stmt = this.db.prepare('SELECT * FROM ' + this._table + ' WHERE id = ?');
        //const result = await this.execute(query, [id]);
        const res = stmt.get(id) as VideoCaptionEntity;
        // if (result.length > 0) {
        //     return result[0] as VideoCaptionEntity;
        // }
        return res;
    }

    update(id: number, videoCaption: VideoCaptionEntity) {
        const stmt = this.db.prepare(`
        UPDATE ${this._table}
        SET video_id=@video_id,language_id=@language_id,caption_path=@caption_path,record_time=@record_time
        WHERE id = @id
    `);
        const info = stmt.run({
            id: id,
            video_id: videoCaption.videoId,
            language_id: videoCaption.language_id,
            caption_path: videoCaption.caption_path,
            record_time: getRecorddatetime()
        })
        return info.changes;
    }

    delete(id: number): void {
        const stmt = this.db.prepare(
            `DELETE FROM ` + this._table + ` WHERE video_id = ?`);
        const res = stmt.run(id);
    }
    getCaptionByVidLid(vid: number, lid: number): VideoCaptionEntity | null {
        const stmt = this.db.prepare('SELECT * FROM ' + this._table + ' WHERE video_id = ? AND language_id = ?');
        const res = stmt.get(vid, lid) as VideoCaptionEntity;
        return res;
    }
    //get all catpion by video id
    getCaptionByVid(vid: number): Array<VideoCaptionEntity> {
        const stmt = this.db.prepare('SELECT * FROM ' + this._table + ' WHERE video_id = ?');
        const res = stmt.all(vid) as Array<VideoCaptionEntity>;
        return res;
    }

}
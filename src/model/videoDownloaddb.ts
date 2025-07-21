//import { Database } from 'better-sqlite3';
//import { Scraperdb } from "@/model/scraperdb";
import { VideoDownloadEntityType, VideoDownloadStatus,VideoCaptionStatus } from "@/entityTypes/videoType"
import { getRecorddatetime,getLogPath } from "@/modules/lib/function";
import { BaseDb } from "@/model/Basedb";



export class VideoDownloaddb extends BaseDb {
  // db: Database;
  videoDownloadTable = "video_download";
  constructor(filepath: string) {
    super(filepath)
    // const scraperModel = Scraperdb.getInstance(filepath);
    // this.db = scraperModel.getdb();
  }
  public saveVideoDownload(videoDownload: VideoDownloadEntityType): number {
    //find video item by url first
    const itemres = this.getVideobyUrl(videoDownload.url)
    if (itemres&&itemres.id) {
      this.updateVideoDownloadItem(itemres.id, videoDownload)
      return itemres.id
    } else {
      if(!videoDownload.error_log){
        videoDownload.error_log=getLogPath('videodownloaditem')
      }
      const recordtime = getRecorddatetime();
      const stmt = this.db.prepare(`INSERT INTO ${this.videoDownloadTable} (url,savepath,record_time,task_id,error_log,status,caption_status) VALUES (?,?,?,?,?,?,?)`);
      const info = stmt.run(
        videoDownload.url,
        videoDownload.savepath,
        recordtime,
        videoDownload.task_id,
        videoDownload.error_log,
        videoDownload.status,
       videoDownload.caption_status?videoDownload.caption_status:VideoCaptionStatus.No
      );
      return Number(info.lastInsertRowid);
    }
  }
  //save log for video download
  public saveVideoDownloadLog(logfile: string, downloadId: number) {
    //update log by downloadId
    const stmt = this.db.prepare(`UPDATE ${this.videoDownloadTable} SET error_log = ? WHERE id = ?`);
    const info = stmt.run(logfile, downloadId);
    return info.changes;
  }

  //update download status
  public updateVideoDownloadStatus(status: number, downloadId: number): number {
    //update status by downloadId
    const stmt = this.db.prepare(`UPDATE ${this.videoDownloadTable} SET status = ? WHERE id = ?`);
    const info = stmt.run(status, downloadId);
    return info.changes;
  }
  //get video download list
  public getVideoDownloadList(taskId: number, page: number, size: number, status?: VideoDownloadStatus): Array<VideoDownloadEntityType> {
    let query = `SELECT * FROM ${this.videoDownloadTable} WHERE task_id=@taskId`
    if (status) {
      query += ` AND status=@status`
    }
    query += ` ORDER BY id desc LIMIT @page,@size`
    const stmt = this.db.prepare(query);
    //const rows = stmt.all(taskId,page,size) as Array<VideoDownloadEntity>;
    const rows = stmt.all({ taskId: taskId, page: page, size: size, status: status }) as Array<VideoDownloadEntityType>;
    return rows;
  }
  //count video download list
  public countVideoDownloadList(taskId: number, status?: VideoDownloadStatus): number {
    let query = `SELECT count(*) as total FROM ${this.videoDownloadTable} WHERE task_id=@taskId`
    if (status) {
      query += ` AND status=@status`
    }
    const stmt = this.db.prepare(query);
    const row = stmt.get({ taskId: taskId, status: status }) as { total: number };
    //const row = stmt.get(taskId) as { total: number };
    return row.total;
  }
  //get video download item detail
  public getVideoDownloaditem(id: number): VideoDownloadEntityType {
    const stmt = this.db.prepare(
      `SELECT * FROM ` + this.videoDownloadTable + ` WHERE id = ?`);
    const res = stmt.get(id) as VideoDownloadEntityType;
    return res
  }
  //get video download item info by url
  public getVideobyUrl(url: string): VideoDownloadEntityType {
    const stmt = this.db.prepare(
      `SELECT * FROM ` + this.videoDownloadTable + ` WHERE url = ?`);
    const res = stmt.get(url) as VideoDownloadEntityType;
    return res
  }

  //update video download item
  public updateVideoDownloadItem(id: number, videoDownload: Omit<VideoDownloadEntityType,"error_log">): number {
    if(!videoDownload.record_time){
      videoDownload.record_time=getRecorddatetime()
    }
    const stmt = this.db.prepare(`
            UPDATE ${this.videoDownloadTable}
            SET url=@url,savepath=@savepath,record_time=@record_time,task_id=@task_id,status=@status,caption_status=@caption_status
            WHERE id = @id
        `);
    const info = stmt.run({
      id: id,
      url: videoDownload.url,
      savepath: videoDownload.savepath,
      record_time: videoDownload.record_time,
      task_id: videoDownload.task_id,
     
      status: videoDownload.status,
      caption_status: videoDownload.caption_status
    })
    return info.changes;
  }
  //delete video download item
  public deleteVideoDownloadItem(id: number): number {
    const stmt = this.db.prepare(`
            DELETE FROM ${this.videoDownloadTable} WHERE id = ?
        `);
    const info = stmt.run(id);
    return info.changes;
  }
  //update video caption status
  public updateVideoCaptionStatus(downloadId: number,status:VideoCaptionStatus): number {
    //update status by downloadId
    const stmt = this.db.prepare(`UPDATE ${this.videoDownloadTable} SET caption_status = ? WHERE id = ?`);
    const info = stmt.run(status,downloadId);
    return info.changes;
  }
  //update video log path
  public updateVideoErrorLogPath(downloadId: number,logpath:string): number {
    //update status by downloadId
    const stmt = this.db.prepare(`UPDATE ${this.videoDownloadTable} SET error_log = ? WHERE id = ?`);
    const info = stmt.run(logpath,downloadId);
    return info.changes;
  }



}
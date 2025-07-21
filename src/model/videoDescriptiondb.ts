// import { VideoDescriptionEntity } from "@/entityTypes/videoType";
// import { getRecorddatetime } from "@/modules/lib/function";
// import { BaseDb } from "@/model/Basedb";

// export class VideoDescriptiondb extends BaseDb{
  
//   // db: Database;
//   //videoTable = "video";
//   videoDescriptionTable = "video_description";

//   language: Array<{ id: number; name: string }> = [
//     { id: 1, name: "en-us" },
//     { id: 2, name: "zh-cn" },
//   ];
//   constructor(filepath:string) {
//     super(filepath)
//     // const scraperModel = Scraperdb.getInstance(filepath);
//     // this.db = scraperModel.getdb();
//   }

//   /**
//    * save video
//    * @param url string
//    */
//   saveVideoDescription(videoinfo: VideoDescriptionEntity):number {
//     // saveVideo(url: string, localpath:string,title: string, description: string, language: string) {
//     let languageid = 0;
//     for (let i = 0; i < this.language.length; i++) {
//       if (this.language[i].name == videoinfo.language) {
//         languageid = this.language[i].id;
//       }
//     }
//     // const date = new Date();
//     const recordtime = getRecorddatetime();
//     // const recordtime =
//     //   date.getFullYear().toString() +
//     //   "-" +
//     //   this.pad2(date.getMonth() + 1) +
//     //   "-" +
//     //   this.pad2(date.getDate()) +
//     //   " " +
//     //   this.pad2(date.getHours()) +
//     //   ":" +
//     //   this.pad2(date.getMinutes()) +
//     //   ":" +
//     //   this.pad2(date.getSeconds());
//     const stmt =
//       this.db.prepare(`INSERT INTO ` +
//         this.videoDescriptionTable +
//         ` (video_id,language_id,title,description,record_time) VALUES (?,?,?,?,?)`);

//     // const component = this;
//     const res = stmt.run(videoinfo.videoId, videoinfo.language,videoinfo.title,videoinfo.description, recordtime)


//     return Number(res.lastInsertRowid);
//   }
//   // );

//   // this.db.close();
//   // }
//   /**
//    * update the video path which watermark has been remove
//    */
//   // updateVideofilter(videoId: number, filterpath: string) {
//   //   const stmt = this.db.prepare(
//   //     `UPDATE ` + this.videoTable + ` SET filterwatermark = ? WHERE id = ?`);
//   //   stmt.run(filterpath, videoId)
//   //   // if (err) {
//   //   //   throw new Error(err.message);
//   //   // }
//   //   // });
//   // }
//   truncatedb() {
//     const sql = `DELETE FROM ` + this.videoDescriptionTable;
//     this.db.exec(sql)

//     // const videoscsql = `DELETE FROM ` + this.videoDescriptionTable;
//     // this.db.exec(videoscsql)
//   }
//   getVideoDescription(videoId: number): VideoDescriptionEntity {
//     const stmt = this.db.prepare(
//       `SELECT * FROM ` + this.videoDescriptionTable + ` WHERE video_id = ?`);
//     const res = stmt.get(videoId) as VideoDescriptionEntity;
//     return res;
//   }
//   // delete video description
//   deleteVideoDescription(videoId: number):number {
//     const stmt = this.db.prepare(
//       `DELETE FROM ` + this.videoDescriptionTable + ` WHERE video_id = ?`);
//     const res=stmt.run(videoId);
//     return res.changes;
//   }
// }

// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
import { VideoDownloadTaskAccountModel } from "@/model/VideoDownloadTaskAccount.model"
// import {VideoDownloadTaskAccountEntity as VideoDownloadTaskAccountEntityType} from "@/entityTypes/videoType"
// import { VideoDownloadTaskEntity } from "@/entityTypes/videoType"
// import {TaskStatus} from "@/entityTypes/commonType"
import { BaseModule } from "@/modules/baseModule";
import { VideoDownloadTaskAccountsEntity } from "@/entity/VideoDownloadTaskAccounts.entity"
export class VideoDownloadTaskAccountsModule extends BaseModule {
    // private dbpath: string
    private videoDownloadTaskAccountdb: VideoDownloadTaskAccountModel
    constructor() {
        super()
        // const tokenService = new Token()
        // const dbpath = tokenService.getValue(USERSDBPATH)
        // if (!dbpath) {
        //     throw new Error("user path not exist")
        // }
        // this.dbpath = dbpath
        this.videoDownloadTaskAccountdb = new VideoDownloadTaskAccountModel(this.dbpath)
    }

    async create(vdte: VideoDownloadTaskAccountsEntity): Promise<number> {

        return await this.videoDownloadTaskAccountdb.create(vdte);
    }

    async read(id: number): Promise<VideoDownloadTaskAccountsEntity | null> {

        return await this.videoDownloadTaskAccountdb.read(id);
    }

    async update(id: number, taskAccount: VideoDownloadTaskAccountsEntity): Promise<void> {
        await this.videoDownloadTaskAccountdb.update(id, taskAccount);
    }

    async delete(id: number): Promise<void> {
        //    const stmt = this.db.prepare(`
        //        DELETE FROM ${this.table} WHERE id = ?
        //    `);
        //    stmt.run(id);
        await this.videoDownloadTaskAccountdb.delete(id);
    }

    //query account id by task id
    public async getAccountByTaskId(taskId: number): Promise<Array<VideoDownloadTaskAccountsEntity>> {
        return await this.videoDownloadTaskAccountdb.getAccountByTaskId(taskId);
    }


}
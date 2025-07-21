// import { Token } from "@/modules/token"
// import { USERSDBPATH } from '@/config/usersetting';
// import { EmailMarketingSendLogEntity, SendStatus } from "@/model/emailMarketingSendLogdb"
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity"
import { EmailMarketingSendLogModel } from "@/model/emailMarketingSendLog.model"
import { SortBy } from "@/entityTypes/commonType"
import { BaseModule } from "@/modules/baseModule";
export class EmailMarketingSendLogModule extends BaseModule{
    //private dbpath: string
    private emailMarketingSendLogdb: EmailMarketingSendLogModel
    constructor() {
    // const tokenService = new Token()
    // const dbpath = tokenService.getValue(USERSDBPATH)
    // if (!dbpath) {
    //     throw new Error("user path not exist")
    // }
    //this.dbpath = dbpath
    super();
    this.emailMarketingSendLogdb = new EmailMarketingSendLogModel(this.dbpath);
    }
    //create buck send email log item
    async createItem(task: EmailMarketingSendLogEntity): Promise<number> {
        return await this.emailMarketingSendLogdb.create(task)
    }
    //get email send log by id
    async readItem(id: number): Promise<EmailMarketingSendLogEntity | null> {
        return await this.emailMarketingSendLogdb.read(id)
    }
    //update email send log
    async updateTask(id: number, updates: EmailMarketingSendLogEntity): Promise<void> {
        await this.emailMarketingSendLogdb.update(id,updates);
    }
    //delete email send log by id
    async deleteTask(id: string): Promise<void> {
        await this.emailMarketingSendLogdb.delete(Number(id));
    }
    async getSendlogList(taskId: number, page: number, limit: number, where?: string, sortby?: SortBy): Promise<{records: EmailMarketingSendLogEntity[], total: number}> {
        const records = await this.emailMarketingSendLogdb.listEmailMarketingSendLog(taskId, page, limit, where, sortby)
        const total = await this.emailMarketingSendLogdb.countEmailMarketingSendLog(taskId, where)
        return {records, total}
    }
    getStatusName(status: number): string {
        return this.emailMarketingSendLogdb.getSendStatusName(status)
    }
}
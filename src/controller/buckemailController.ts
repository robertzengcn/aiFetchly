import { BuckemailTaskStartInput } from "@/entityTypes/emailmarketingType";
import { EmailMarketingTemplateApi } from "@/api/emailMarketingTemplateApi";

import { EmailMarketingFilterApi } from "@/api/emailMarketingFilterApi";
import { EmailServiceApi } from "@/api/emailServiceApi";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import { EmailMarketingSendLogModule } from "@/modules/emailMarketingSendLogModule";
import { SortBy } from "@/entityTypes/commonType";
import {
  BuckEmailListType,
  EmailMarketingSendLogListDisplay,
} from "@/entityTypes/buckemailType";
import { getStatusName } from "@/modules/lib/function";

export class BuckemailController {
  private emailtemAPI: EmailMarketingTemplateApi;
  private emailfilterAPI: EmailMarketingFilterApi;
  private emailserviceAPI: EmailServiceApi;
  private buckEmailTaskMoudule: BuckEmailTaskModule;
  private emailMarketingSendlogModule: EmailMarketingSendLogModule;
  constructor() {
    this.emailtemAPI = new EmailMarketingTemplateApi();
    this.emailfilterAPI = new EmailMarketingFilterApi();
    this.buckEmailTaskMoudule = new BuckEmailTaskModule();
    this.emailserviceAPI = new EmailServiceApi();
    this.emailMarketingSendlogModule = new EmailMarketingSendLogModule();
  }

  //get buck email task list
  public async getBuckEmailTaskList(
    page: number,
    size: number,
    sort?: SortBy
  ): Promise<{ records: Array<BuckEmailListType>; total: number }> {
    const Taskentity = await this.buckEmailTaskMoudule.listBuckEmailTasks(
      page,
      size,
      sort
    );
    const data: Array<BuckEmailListType> = [];
    Taskentity.forEach(async (element) => {
      let status = "unkonw";
      if (element.status) {
        status = getStatusName(element.status);
      }
      const btype = await this.buckEmailTaskMoudule.getBuckEmailTypeName(
        element.type
      );
      let id = 0;
      if (element.id) {
        id = element.id;
      }
      const item: BuckEmailListType = {
        TaskId: id,
        Status: status,
        RecordTime: element.record_time,
        Type: btype,
      };

      data.push(item);
    });
    const result = {
      records: data,
      total: Taskentity.length,
    };
    return result;
  }
  public async startBuckEmailTask(
    param: BuckemailTaskStartInput
  ): Promise<number> {
    return await this.buckEmailTaskMoudule.startBuckEmailCampaign(param);
  }
  //get buck email send log by task id
  public async getBuckEmailSendLog(
    taskid: number,
    page: number,
    size: number,
    where?: string,
    sort?: SortBy
  ): Promise<{
    records: Array<EmailMarketingSendLogListDisplay>;
    total: number;
  }> {
    const res = await this.emailMarketingSendlogModule.getSendlogList(
      taskid,
      page,
      size,
      where,
      sort
    );
    const data: Array<EmailMarketingSendLogListDisplay> = [];
    res.records.forEach(async (element) => {
      let status = "unkonw";
      if (element.status) {
        status = await this.emailMarketingSendlogModule.getStatusName(
          element.status
        );
      }
      let elementID = 0;
      if (element.id) {
        elementID = element.id;
      }
      const item: EmailMarketingSendLogListDisplay = {
        id: elementID,
        status: status,
        receiver: element.receiver,
        title: element.title,
        record_time: element.record_time,
      };
      data.push(item);
    });
    const result = {
      records: data,
      total: res.total,
    };
    return result;
  }
}

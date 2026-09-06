import { BuckemailTaskStartInput } from "@/entityTypes/emailmarketingType";
import { EmailMarketingTemplateApi } from "@/api/emailMarketingTemplateApi";

import { EmailMarketingFilterApi } from "@/api/emailMarketingFilterApi";
import { EmailServiceApi } from "@/api/emailServiceApi";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import { EmailMarketingSendLogModule } from "@/modules/emailMarketingSendLogModule";
import { OutboundEmailSendLogModule } from "@/modules/OutboundEmailSendLogModule";
import { SortBy } from "@/entityTypes/commonType";
import {
  BuckEmailListType,
  EmailMarketingSendLogListDisplay,
  UnifiedSendLogEntry,
} from "@/entityTypes/buckemailType";
import { getStatusName } from "@/modules/lib/function";

export class BuckemailController {
  private emailtemAPI: EmailMarketingTemplateApi;
  private emailfilterAPI: EmailMarketingFilterApi;
  private emailserviceAPI: EmailServiceApi;
  private buckEmailTaskMoudule: BuckEmailTaskModule;
  private emailMarketingSendlogModule: EmailMarketingSendLogModule;
  private unifiedSendLogModule: OutboundEmailSendLogModule;
  constructor() {
    this.emailtemAPI = new EmailMarketingTemplateApi();
    this.emailfilterAPI = new EmailMarketingFilterApi();
    this.buckEmailTaskMoudule = new BuckEmailTaskModule();
    this.emailserviceAPI = new EmailServiceApi();
    this.emailMarketingSendlogModule = new EmailMarketingSendLogModule();
    this.unifiedSendLogModule = new OutboundEmailSendLogModule();
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
    const total = await this.buckEmailTaskMoudule.countBuckEmailTasks();
    const data: Array<BuckEmailListType> = [];
    for (const element of Taskentity) {
      let status = "unkonw";
      if (element.status) {
        status = getStatusName(element.status);
      }
      const btype = await this.buckEmailTaskMoudule.getBuckEmailTypeName(
        element.type
      );
      const id = element.id ?? 0;
      const item: BuckEmailListType = {
        TaskId: id,
        Status: status,
        RecordTime: element.record_time,
        Type: btype,
      };
      data.push(item);
    }
    const result = {
      records: data,
      total,
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
    for (const element of res.records) {
      let status = "unkonw";
      // Failure rows have status 0 (SendStatus.Failure) — a truthiness check
      // would misclassify them as unknown, so compare against null explicitly.
      if (element.status !== undefined && element.status !== null) {
        status = await this.emailMarketingSendlogModule.getStatusName(
          element.status
        );
      }
      const elementID = element.id ?? 0;
      const item: EmailMarketingSendLogListDisplay = {
        id: elementID,
        status,
        receiver: element.receiver,
        title: element.title,
        record_time: element.record_time,
      };
      data.push(item);
    }
    const result = {
      records: data,
      total: res.total,
    };
    return result;
  }
  //get unified send log (legacy + authorized outbound)
  public async getUnifiedSendLog(
    page: number,
    size: number,
    where?: string,
    sort?: SortBy
  ): Promise<{
    records: Array<UnifiedSendLogEntry>;
    total: number;
  }> {
    const res = await this.unifiedSendLogModule.getUnifiedSendLog(
      page,
      size,
      where,
      sort
    );
    return {
      records: res.records,
      total: res.total,
    };
  }
}

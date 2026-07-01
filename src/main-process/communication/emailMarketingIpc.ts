import { EmailMarketingController } from "@/controller/emailMarketingController";
import { ipcMain } from "electron";
import {
  EMAILMARKETINGTEMPLIST,
  EMAILMARKETINGTEMPREMOVE,
  EMAILMARKETINGTEMPDETAIL,
  EMAILMARKETINGTEMPUPDATE,
  EMAILMARKETINGFILTERLIST,
  EMAILMARKETFILTERDETAIL,
  EMAILMARKETFILTERUPDATE,
  EMAILSERVICELIST,
  EMAILSERVICEDETAIL,
  EMAILSERVICEUPDATE,
  EMAILSERVICEDELETE,
  EMAILFILTERDELETE,
  SENDTESTEMAIL,
  RECEIVESENDTESTEMAILMESSAGE,
} from "@/config/channellist";
import {
  CommonResponse,
  CommonMessage,
  CommonIdrequest,
  CommonDialogMsg,
} from "@/entityTypes/commonType";
import {
  EmailFilterdata,
  EmailServiceListdata,
  EmailServiceEntitydata,
  EmailSendParam,
  EmailFilterDetialdata,
  EmailTemplateRespdata,
} from "@/entityTypes/emailmarketingType";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  emailMarketingListInputSchema,
  emailMarketingByIdInputSchema,
  emailMarketingUpdateInputSchema,
} from "@/schemas/ipc/emailMarketing";

/**
 * Email Marketing IPC handlers.
 *
 * 12 handle handlers migrated to registerValidatedHandler, organized into
 * 3 CRUD groups: Template (4) / Filter (4) / Service (4).
 *
 * SENDTESTEMAIL (ipcMain.on) stays as-is — uses event.sender.send push model.
 *
 * Envelope: handlers return data only; wrapper wraps in {status, msg, data}.
 */
export function registerEmailMarketingIpcHandlers() {
  const toTemplateResp = (item: EmailTemplateEntity): EmailTemplateRespdata => ({
    TplId: item.id,
    TplTitle: item.title,
    TplContent: item.content,
    TplRecord: item.updatedAt?.toDateString(),
    Status: item.status,
  });

  // ── Template CRUD ────────────────────────────────────────────────────

  registerValidatedHandler(
    EMAILMARKETINGTEMPLIST,
    emailMarketingListInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const res = await emailmarketCon.listEmailTemplate(
        input.page ?? 0,
        input.size ?? 100,
        input.search,
      );
      if (!res) {
        throw new Error("emailmarketing.list_email_template_error");
      }
      const records = (res.records || []).map(toTemplateResp);
      return { records, num: res.num };
    },
  );

  registerValidatedHandler(
    EMAILMARKETINGTEMPREMOVE,
    emailMarketingByIdInputSchema,
    async (input) => {
      const id = Number(input.id);
      const emailmarketCon = new EmailMarketingController();
      await emailmarketCon.removeEmailTemplate(id);
      return id;
    },
  );

  registerValidatedHandler(
    EMAILMARKETINGTEMPDETAIL,
    emailMarketingByIdInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const res = await emailmarketCon.getEmailTemplateDetail(Number(input.id));
      if (!res) {
        throw new Error("emailmarketing.template_item_notexist");
      }
      return {
        TplId: res.id,
        TplTitle: res.title,
        TplContent: res.content,
        TplRecord: res.updatedAt?.toDateString(),
        Status: res.status,
        TplDescription: res.description ? res.description : "",
      } satisfies EmailTemplateRespdata;
    },
  );

  registerValidatedHandler(
    EMAILMARKETINGTEMPUPDATE,
    emailMarketingUpdateInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const res = await emailmarketCon.updateEmailtemplate(
        input as unknown as EmailTemplateRespdata,
      );
      if (!res) {
        throw new Error("emailmarketing.update_email_template_error");
      }
      return { id: res } satisfies CommonIdrequest<number>;
    },
  );

  // ── Filter CRUD ──────────────────────────────────────────────────────

  registerValidatedHandler(
    EMAILMARKETINGFILTERLIST,
    emailMarketingListInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const res = await emailmarketCon.listEmailFilter(
        input.page ?? 0,
        input.size ?? 100,
        input.search,
      );
      if (!res) {
        return { records: [], num: 0 };
      }
      const respdata: EmailFilterdata[] = [];
      for (const item of res.records as EmailFilterEntity[]) {
        const filterdetails: EmailFilterDetialdata[] = [];
        if (item.filterDetails) {
          for (const detail of item.filterDetails as EmailFilterDetailEntity[]) {
            filterdetails.push({ id: detail.id, content: detail.content });
          }
        }
        respdata.push({
          id: item.id,
          name: item.name,
          description: item.description ? item.description : "",
          filter_details: filterdetails,
          created_time: item.createdAt
            ? item.createdAt.toISOString().split("T")[0]
            : "",
        });
      }
      return { records: respdata, num: res.num };
    },
  );

  registerValidatedHandler(
    EMAILMARKETFILTERDETAIL,
    emailMarketingByIdInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const id = Number(input.id);
      const resp = await emailmarketCon.getEmailFilterDetail(id);
      if (!resp) {
        throw new Error("emailmarketing.filter_item_notexist");
      }
      const filterdetails =
        await emailmarketCon.getEmailFilterDetailByFilterId(id);
      const respdata: EmailFilterdata = {
        id: resp.id,
        name: resp.name,
        description: resp.description ? resp.description : "",
        filter_details: [],
        created_time: resp.createdAt ? resp.createdAt.toDateString() : "",
      };
      if (filterdetails) {
        for (const detail of filterdetails as EmailFilterDetailEntity[]) {
          respdata.filter_details.push({ id: detail.id, content: detail.content });
        }
      }
      return respdata;
    },
  );

  registerValidatedHandler(
    EMAILMARKETFILTERUPDATE,
    emailMarketingUpdateInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const res = await emailmarketCon.updateEmailFilter(
        input as unknown as EmailFilterdata,
      );
      if (!res) {
        throw new Error("emailmarketing.update_email_filter_error");
      }
      return { id: res } satisfies CommonIdrequest<number>;
    },
  );

  registerValidatedHandler(
    EMAILFILTERDELETE,
    emailMarketingByIdInputSchema,
    async (input) => {
      const id = Number(input.id);
      const emailmarketCon = new EmailMarketingController();
      try {
        await emailmarketCon.deleteEmailFilter(id);
        return id;
      } catch {
        throw new Error("emailmarketing.delete_email_filter_error");
      }
    },
  );

  // ── Service CRUD ─────────────────────────────────────────────────────

  registerValidatedHandler(
    EMAILSERVICELIST,
    emailMarketingListInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const res = await emailmarketCon.getEmailServiceList(
        input.page ?? 0,
        input.size ?? 100,
        input.search,
      );
      if (!res) {
        throw new Error("emailmarketing.service_list_error");
      }
      return {
        records: res.records || [],
        num: res.num,
      } satisfies CommonResponse<EmailServiceListdata>["data"];
    },
  );

  registerValidatedHandler(
    EMAILSERVICEDETAIL,
    emailMarketingByIdInputSchema,
    async (input) => {
      const emailmarketCon = new EmailMarketingController();
      const res = await emailmarketCon.getEmailServiceDetail(Number(input.id));
      if (!res) {
        throw new Error("emailmarketing.service_item_notexist");
      }
      return res satisfies EmailServiceEntitydata;
    },
  );

  registerValidatedHandler(
    EMAILSERVICEUPDATE,
    emailMarketingUpdateInputSchema,
    async (input) => {
      const qdata = input as unknown as EmailServiceEntitydata;
      const emailmarketCon = new EmailMarketingController();
      const rawId = qdata?.id;
      const id =
        rawId !== undefined && rawId !== null && Number(rawId) > 0
          ? Number(rawId)
          : undefined;
      let serviceId = id;
      if (serviceId === undefined && qdata.name) {
        const existing = await emailmarketCon.findEmailServiceByName(qdata.name);
        serviceId = existing?.id;
      }

      if (serviceId !== undefined) {
        const existing = await emailmarketCon.getEmailServiceDetail(serviceId);
        if (!existing) {
          throw new Error("Email service not found");
        }
        const entity = new EmailServiceEntity();
        entity.name = qdata.name ?? existing.name;
        entity.host = qdata.host ?? existing.host;
        entity.port = qdata.port ?? existing.port;
        entity.from = qdata.from ?? existing.from;
        entity.password = qdata.password ?? existing.password;
        entity.ssl = qdata.ssl ?? existing.ssl;
        await emailmarketCon.updateEmailService(serviceId, entity);
        return { id: serviceId } satisfies CommonIdrequest<number>;
      }

      const createdId = await emailmarketCon.createEmailService(qdata);
      if (!createdId) {
        throw new Error("emailmarketing.create_email_service_error");
      }
      return { id: createdId } satisfies CommonIdrequest<number>;
    },
  );

  registerValidatedHandler(
    EMAILSERVICEDELETE,
    emailMarketingByIdInputSchema,
    async (input) => {
      const id = Number(input.id);
      const emailmarketCon = new EmailMarketingController();
      await emailmarketCon.deleteEmailService(id);
      return id;
    },
  );

  // ── Out-of-scope: streaming on handler ───────────────────────────────
  ipcMain.on(SENDTESTEMAIL, async (event, arg): Promise<void> => {
    const qdata = JSON.parse(arg as string) as EmailSendParam;
    const emailmarketCon = new EmailMarketingController();
    await emailmarketCon
      .sendEmail(
        qdata,
        (errorMessage: string) => {
          const resp: CommonDialogMsg = {
            status: false,
            code: 202411141455379,
            data: {
              action: "error",
              title: "emailservice.send_test_email_error",
              content: errorMessage,
            },
          };
          (
            event as { sender: { send: (c: string, m: string) => void } }
          ).sender.send(RECEIVESENDTESTEMAILMESSAGE, JSON.stringify(resp));
        },
        () => {
          const resp: CommonDialogMsg = {
            status: true,
            code: 0,
            data: {
              action: "success",
              title: "emailservice.send_test_email_success",
              content: "",
            },
          };
          (
            event as { sender: { send: (c: string, m: string) => void } }
          ).sender.send(RECEIVESENDTESTEMAILMESSAGE, JSON.stringify(resp));
        },
      )
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const resp: CommonDialogMsg = {
          status: false,
          code: 202411141458415,
          data: {
            action: "error",
            title: "send_test_email_error",
            content: errorMessage,
          },
        };
        (
          event as { sender: { send: (c: string, m: string) => void } }
        ).sender.send(RECEIVESENDTESTEMAILMESSAGE, JSON.stringify(resp));
      });
  });
}

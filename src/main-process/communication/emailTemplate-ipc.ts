import { EmailTemplateModule } from "@/modules/EmailTemplateModule";
import { EmailTemplateTaskRelationModule } from "@/modules/EmailTemplateTaskRelationModule";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  emailTemplateListInputSchema,
  emailTemplateByIdInputSchema,
  emailTemplateByTaskInputSchema,
  emailTemplateCreateInputSchema,
  emailTemplateUpdateInputSchema,
} from "@/schemas/ipc/emailTemplate";
import {
  EMAILTEMPLATE_LIST,
  EMAILTEMPLATE_DETAIL,
  EMAILTEMPLATE_CREATE,
  EMAILTEMPLATE_UPDATE,
  EMAILTEMPLATE_DELETE,
  EMAILTEMPLATE_BY_TASK,
} from "@/config/channellist";

/**
 * Email Template IPC handlers — all 6 migrated to registerValidatedHandler.
 *
 * Envelope: handlers return data only; wrapper wraps in {status, msg, data}.
 * The original handlers returned records/num wrapped in data — to preserve
 * the wire shape for frontend, LIST/DETAIL/CREATE/BY_TASK return that same
 * {records, num} structure as the data payload.
 */
export function registerEmailTemplateIpcHandlers() {
  registerValidatedHandler(
    EMAILTEMPLATE_LIST,
    emailTemplateListInputSchema,
    async (input) => {
      const mod = new EmailTemplateModule();
      const templates = await mod.listEmailTemplates(
        input.page ?? 0,
        input.size ?? 100,
        input.search,
        input.sortby
      );
      const total = await mod.countEmailTemplates();
      return { records: templates, num: total };
    }
  );

  registerValidatedHandler(
    EMAILTEMPLATE_DETAIL,
    emailTemplateByIdInputSchema,
    async (input) => {
      const mod = new EmailTemplateModule();
      const template = await mod.read(input.id);
      if (!template) {
        throw new Error("Template not found");
      }
      return { records: [template], num: 1 };
    }
  );

  registerValidatedHandler(
    EMAILTEMPLATE_CREATE,
    emailTemplateCreateInputSchema,
    async (input) => {
      const mod = new EmailTemplateModule();
      // schema 用 passthrough，input 包含 EmailTemplateEntity 全部字段
      const id = await mod.create(input as unknown as EmailTemplateEntity);
      return { records: [{ id }], num: 1 };
    }
  );

  registerValidatedHandler(
    EMAILTEMPLATE_UPDATE,
    emailTemplateUpdateInputSchema,
    async (input) => {
      const mod = new EmailTemplateModule();
      const { id, ...templateData } = input;
      await mod.update(id, templateData as unknown as EmailTemplateEntity);
      return null;
    }
  );

  registerValidatedHandler(
    EMAILTEMPLATE_DELETE,
    emailTemplateByIdInputSchema,
    async (input) => {
      const mod = new EmailTemplateModule();
      await mod.delete(input.id);
      return null;
    }
  );

  registerValidatedHandler(
    EMAILTEMPLATE_BY_TASK,
    emailTemplateByTaskInputSchema,
    async (input) => {
      const relationModule = new EmailTemplateTaskRelationModule();
      const templateModule = new EmailTemplateModule();
      const relations = await relationModule.getEmailTemplatesByBuckemailTaskId(
        input.buckemailTaskId
      );

      const emailTemplateList: EmailTemplateEntity[] = [];
      for (const rel of relations) {
        const template = await templateModule.read(rel.emailTemplateId);
        if (template) {
          emailTemplateList.push(template);
        }
      }
      return { records: emailTemplateList, num: emailTemplateList.length };
    }
  );
}

/**
 * prepareData must bind local SQLite SMTP services (the same ids
 * list_email_services / start_email_send_task return) into Emailservicelist.
 * The previous remote /api/emailservice/:id lookup used the local id, so
 * skip_review sends arrived at the worker with an empty service list:
 * "No email service is available for this task".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { EmailTemplateModel } from "@/model/EmailTemplate.model";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";
import { EmailFilterModel } from "@/model/EmailFilter.model";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";
import { EmailFilterDetailModel } from "@/model/EmailFilterDetail.model";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import type { Buckemailstruct } from "@/entityTypes/emailmarketingType";

const tmpDir = path.join(os.tmpdir(), "aifetchly-buckemail-prepare-data");

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));

import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";

function resetDb(): void {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedSmtpService(): Promise<number> {
  const model = new EmailServiceModel(tmpDir);
  const entity = new EmailServiceEntity();
  entity.name = "Local SMTP";
  entity.from = "sender@example.com";
  entity.password = "smtp-secret";
  entity.host = "smtp.example.com";
  entity.port = "465";
  entity.ssl = 1;
  entity.status = 1;
  return await model.create(entity);
}

async function seedTemplate(): Promise<number> {
  const model = new EmailTemplateModel(tmpDir);
  const entity = new EmailTemplateEntity();
  entity.title = "Local welcome";
  entity.content = "<p>Hello from the local template</p>";
  entity.description = "SQLite template";
  entity.status = 1;
  return await model.create(entity);
}

async function seedFilterWithDetail(): Promise<number> {
  const filterModel = new EmailFilterModel(tmpDir);
  const filter = new EmailFilterEntity();
  filter.name = "Skip competitors";
  filter.description = "Skip competitor domains";
  filter.status = 1;
  const filterId = await filterModel.create(filter);

  const detailModel = new EmailFilterDetailModel(tmpDir);
  const detail = new EmailFilterDetailEntity();
  detail.filter_id = filterId;
  detail.content = "competitor\\.com";
  await detailModel.create(detail);
  return filterId;
}

function skipReviewCampaign(serviceId: number): Buckemailstruct {
  return {
    EmailBtype: BuckEmailType.EXTRACTEMAIL,
    EmailList: [
      {
        address: "1093968009@qq.com",
        source: "ai_chat_direct_input",
      },
    ],
    EmailTemplateslist: [],
    EmailFilterlist: [],
    EmailServicelist: [serviceId],
    NotDuplicate: true,
    email_subject: "Test Email",
    email_html_content: "<p>This is a test email sent from aiFetchly.</p>",
  };
}

describe("BuckEmailTaskModule.prepareData local SMTP services", () => {
  beforeEach(() => {
    resetDb();
  });

  it("loads the local SQLite SMTP service for skip_review start_email_send_task", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const serviceId = await seedSmtpService();

    const module = new BuckEmailTaskModule();
    await module.ensureConnection();
    const taskId = await module.createBuckEmailTask(
      skipReviewCampaign(serviceId)
    );

    const prepared = await module.prepareData(taskId);

    expect(prepared.Emailservicelist).toHaveLength(1);
    expect(prepared.Emailservicelist[0]).toMatchObject({
      id: serviceId,
      from: "sender@example.com",
      password: "smtp-secret",
      host: "smtp.example.com",
      port: "465",
      name: "Local SMTP",
      ssl: 1,
    });
    expect(prepared.Receiverlist).toEqual([
      {
        address: "1093968009@qq.com",
        source: "ai_chat_direct_input",
      },
    ]);
    expect(prepared.email_subject).toBe("Test Email");
    expect(prepared.Emailtemplist).toEqual([]);
    expect(prepared.Emailfilterlist).toEqual([]);
  });

  it("throws when the task has no bound SMTP service", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const module = new BuckEmailTaskModule();
    await module.ensureConnection();
    const taskId = await module.createBuckEmailTask({
      ...skipReviewCampaign(1),
      EmailServicelist: [],
    });

    await expect(module.prepareData(taskId)).rejects.toThrow(
      "No email service is available for this task"
    );
  });

  it("loads local SQLite templates and filters bound to the task", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const serviceId = await seedSmtpService();
    const templateId = await seedTemplate();
    const filterId = await seedFilterWithDetail();

    const module = new BuckEmailTaskModule();
    await module.ensureConnection();
    const taskId = await module.createBuckEmailTask({
      ...skipReviewCampaign(serviceId),
      EmailTemplateslist: [templateId],
      EmailFilterlist: [filterId],
    });

    const prepared = await module.prepareData(taskId);

    expect(prepared.Emailtemplist).toEqual([
      expect.objectContaining({
        TplId: templateId,
        TplTitle: "Local welcome",
        TplContent: "<p>Hello from the local template</p>",
        TplDescription: "SQLite template",
        Status: 1,
      }),
    ]);
    expect(prepared.Emailfilterlist).toHaveLength(1);
    expect(prepared.Emailfilterlist[0]).toMatchObject({
      id: filterId,
      name: "Skip competitors",
      description: "Skip competitor domains",
    });
    expect(prepared.Emailfilterlist[0].filter_details).toEqual([
      expect.objectContaining({
        content: "competitor\\.com",
      }),
    ]);
  });
});

"use strict";

import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import {
  DIRECT_EMAIL_SOURCE,
  getEmailServiceConfig,
  getEmailSearchTaskEmails,
  listEmailSearchTasks,
  previewBulkEmailSendTask,
  startBulkEmailSendTask,
} from "@/service/EmailMarketingAiTools";

describe("EmailMarketingAiTools", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("getEmailServiceConfig", () => {
    it("returns service config without exposing the password", async () => {
      sinon.stub(EmailServiceModule.prototype, "ensureConnection").resolves();
      sinon.stub(EmailServiceModule.prototype, "getEmailService").resolves({
        id: 7,
        name: "Primary SMTP",
        from: "sender@example.com",
        password: "secret-password",
        host: "smtp.example.com",
        port: "465",
        ssl: 1,
        status: 1,
      } as never);

      const result = await getEmailServiceConfig({ service_id: 7 });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.service).to.deep.equal({
        id: 7,
        name: "Primary SMTP",
        from: "sender@example.com",
        host: "smtp.example.com",
        port: "465",
        ssl: 1,
        status: 1,
      });
      expect(JSON.stringify(result)).to.not.include("secret-password");
    });
  });

  describe("listEmailSearchTasks", () => {
    it("lists email search tasks with readable status and type names", async () => {
      sinon
        .stub(EmailSearchTaskModule.prototype, "ensureConnection")
        .resolves();
      sinon.stub(EmailSearchTaskModule.prototype, "listSearchtask").resolves({
        records: [
          {
            id: 11,
            status: 2,
            type_id: 3,
            record_time: "2026-05-21 10:00:00",
            search_result_id: 99,
            concurrency: 2,
            page_length: 20,
          },
        ],
        total: 1,
      } as never);
      sinon
        .stub(EmailSearchTaskModule.prototype, "taskstatusConvert")
        .returns("Complete");
      sinon
        .stub(EmailSearchTaskModule.prototype, "taskTypeconvert")
        .returns("ManualInputUrl");

      const result = await listEmailSearchTasks({ page: 0, size: 20 });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.records).to.deep.equal([
        {
          id: 11,
          status: 2,
          status_name: "Complete",
          type_id: 3,
          type_name: "ManualInputUrl",
          record_time: "2026-05-21 10:00:00",
          search_result_id: 99,
          concurrency: 2,
          page_length: 20,
        },
      ]);
      expect(result.total).to.equal(1);
    });
  });

  describe("getEmailSearchTaskEmails", () => {
    it("fails when a search task has no recipients", async () => {
      sinon
        .stub(EmailSearchTaskModule.prototype, "ensureConnection")
        .resolves();
      sinon.stub(EmailSearchTaskModule.prototype, "getAllEmails").resolves([]);

      const result = await getEmailSearchTaskEmails({
        email_search_task_id: 42,
      });

      expect(result.success).to.equal(false);
      if (result.success) {
        throw new Error("Expected empty recipient failure");
      }
      expect(result.error).to.equal("Email search task has no recipients");
    });
  });

  describe("previewBulkEmailSendTask", () => {
    it("previews direct recipient lists without database access", async () => {
      const result = await previewBulkEmailSendTask({
        emails: [
          "first@example.com",
          {
            address: "second@example.com",
            title: "Second",
            source: "manual",
          },
        ],
        template_ids: [1],
        filter_ids: [2],
        service_ids: [3],
        not_duplicate: true,
      });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.recipient_source).to.equal("direct");
      expect(result.recipient_count).to.equal(2);
      expect(result.template_ids).to.deep.equal([1]);
      expect(result.filter_ids).to.deep.equal([2]);
      expect(result.service_ids).to.deep.equal([3]);
      expect(result.not_duplicate).to.equal(true);
    });

    it("deduplicates direct recipients case-insensitively when requested", async () => {
      const result = await previewBulkEmailSendTask({
        emails: [
          "first@example.com",
          {
            address: "FIRST@example.com",
            title: "Duplicate",
            source: "manual",
          },
          "second@example.com",
        ],
        template_ids: [1],
        service_ids: [3],
        not_duplicate: true,
      });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.recipient_count).to.equal(2);
    });

    it("rejects mixed direct and search-task recipients", async () => {
      const result = await previewBulkEmailSendTask({
        email_search_task_id: 10,
        emails: ["first@example.com"],
        template_ids: [1],
        service_ids: [3],
      });

      expect(result.success).to.equal(false);
      if (result.success) {
        throw new Error("Expected validation failure");
      }
      expect(result.validation_errors).to.include(
        "Provide exactly one of email_search_task_id or emails"
      );
    });
  });

  describe("startBulkEmailSendTask", () => {
    it("starts direct sends with normalized deduplicated EmailList", async () => {
      sinon.stub(BuckEmailTaskModule.prototype, "ensureConnection").resolves();
      const startStub = sinon
        .stub(BuckEmailTaskModule.prototype, "startBuckEmailTask")
        .resolves(123);

      const result = await startBulkEmailSendTask({
        emails: [
          "first@example.com",
          {
            address: "FIRST@example.com",
            title: "Duplicate",
            source: "manual",
          },
          {
            address: "second@example.com",
            title: "Second",
          },
        ],
        template_ids: [1],
        filter_ids: [2],
        service_ids: [3],
        not_duplicate: true,
      });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.task_id).to.equal(123);
      expect(result.recipient_count).to.equal(2);
      expect(startStub.calledOnce).to.equal(true);
      expect(startStub.firstCall.args[0]).to.deep.equal({
        EmailBtype: BuckEmailType.EXTRACTEMAIL,
        EmailtaskentityId: undefined,
        EmailList: [
          {
            address: "first@example.com",
            source: DIRECT_EMAIL_SOURCE,
          },
          {
            title: "Second",
            address: "second@example.com",
            source: DIRECT_EMAIL_SOURCE,
          },
        ],
        EmailTemplateslist: [1],
        EmailFilterlist: [2],
        EmailServicelist: [3],
        NotDuplicate: true,
      });
    });

    it("validates recipients before creating a task", async () => {
      const result = await startBulkEmailSendTask({
        template_ids: [1],
        service_ids: [3],
      });

      expect(result.success).to.equal(false);
      if (result.success) {
        throw new Error("Expected validation failure");
      }
      expect(result.validation_errors).to.include(
        "Provide exactly one of email_search_task_id or emails"
      );
    });
  });
});

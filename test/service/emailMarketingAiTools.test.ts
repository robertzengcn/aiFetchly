"use strict";

import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { vi } from "vitest";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import { Buckemailstruct } from "@/entityTypes/emailmarketingType";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";

vi.mock("@/modules/buckEmailTaskModule", () => ({
  BuckEmailTaskModule: class BuckEmailTaskModule {
    async ensureConnection(): Promise<void> {
      return;
    }

    async countBuckEmailTasks(): Promise<number> {
      return 0;
    }

    async listBuckEmailTasks(): Promise<unknown[]> {
      return [];
    }

    async previewBulkEmailTaskInput(_input: unknown): Promise<{
      emailservicelist: unknown[];
      filterlist: unknown[];
      email_subject: string;
      email_html_content: string;
    }> {
      return {
        emailservicelist: [],
        filterlist: [],
        email_subject: "",
        email_html_content: "",
      };
    }
  },
}));

import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import {
  DIRECT_EMAIL_SOURCE,
  getEmailServiceConfig,
  getEmailSearchTaskEmails,
  listEmailSearchTasks,
  previewBulkEmailSendTask,
  startBulkEmailSendTask,
} from "@/service/EmailMarketingAiTools";
import { DIRECT_EMAIL_SOURCE as DIRECT_EMAIL_SOURCE_AI } from "@/entityTypes/emailMarketingAiTypes";

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

    it("returns mapped recipients when emails exist", async () => {
      sinon
        .stub(EmailSearchTaskModule.prototype, "ensureConnection")
        .resolves();
      sinon.stub(EmailSearchTaskModule.prototype, "getAllEmails").resolves([
        { address: "a@example.com", title: "A", source: "search" },
        { address: "b@example.com", title: "B", source: "search" },
      ]);

      const result = await getEmailSearchTaskEmails({
        email_search_task_id: 7,
      });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.emails).to.deep.equal([
        { title: "A", address: "a@example.com", source: DIRECT_EMAIL_SOURCE },
        { title: "B", address: "b@example.com", source: DIRECT_EMAIL_SOURCE },
      ]);
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

    it("previews content-only sends without template_ids", async () => {
      const result = await previewBulkEmailSendTask({
        emails: ["buyer@example.com"],
        service_ids: [3],
        email_subject: "Hello from content mode",
        email_html_content: "<p>Inline HTML body</p>",
      });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.recipient_count).to.equal(1);
      expect(result.email_content).to.deep.equal({
        subject: "Hello from content mode",
        content: "<p>Inline HTML body</p>",
      });
      expect(result.template_ids).to.equal(undefined);
    });

    it("fails when neither template_ids nor subject/content is provided", async () => {
      const result = await previewBulkEmailSendTask({
        emails: ["buyer@example.com"],
        service_ids: [3],
      });

      expect(result.success).to.equal(false);
      if (result.success) {
        throw new Error("Expected validation failure");
      }
      expect(result.validation_errors).to.include(
        "Provide either template_ids or email_subject and email_html_content"
      );
    });
  });

  describe("startBulkEmailSendTask", () => {
    it("starts content-only sends and persists inline email fields", async () => {
      sinon.stub(BuckEmailTaskModule.prototype, "ensureConnection").resolves();
      sinon
        .stub(BuckEmailTaskModule.prototype, "startBuckEmailTask")
        .resolves(77);

      const result = await startBulkEmailSendTask({
        emails: ["buyer@example.com"],
        service_ids: [3],
        email_subject: "Campaign subject",
        email_html_content: "<p>Body</p>",
      });

      expect(result.success).to.equal(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      expect(result.task_id).to.equal(77);
      expect(result.recipient_count).to.equal(1);
      expect(result.template_ids).to.equal(undefined);

      const startArgs = (
        BuckEmailTaskModule.prototype.startBuckEmailTask as sinon.SinonStub
      ).firstCall.args[0];
      expect(startArgs.email_subject).to.equal("Campaign subject");
      expect(startArgs.email_html_content).to.equal("<p>Body</p>");
    });

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
        type: BuckEmailType.EXTRACTEMAIL,
        emailtaskentityId: 0,
        email_list_json: JSON.stringify([
          {
            address: "first@example.com",
            title: "Duplicate",
            source: DIRECT_EMAIL_SOURCE,
          },
          {
            address: "second@example.com",
            title: "Second",
            source: DIRECT_EMAIL_SOURCE,
          },
        ]),
        email_subject: null,
        email_html_content: null,
        notduplicate: 1,
        record_time: "",
        log_file: "",
        error_file: "",
        status: 0,
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

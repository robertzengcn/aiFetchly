"use strict";
import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { EmailMarketingController } from "@/controller/emailMarketingController";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailServiceModuleInterface } from "@/modules/interface/EmailServiceModuleInterface";
import type { EmailServiceImportResult } from "@/entityTypes/emailmarketingType";

describe("EmailMarketingController", () => {
  let emailMarketingController: EmailMarketingController;

  beforeEach(() => {
    emailMarketingController = new EmailMarketingController();
  });

  describe("basic functionality", () => {
    it("should be instantiated", () => {
      expect(emailMarketingController).to.be.instanceOf(
        EmailMarketingController
      );
    });
  });

  describe("createEmailService", () => {
    it("updates an existing service with the same name instead of creating a duplicate", async () => {
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Primary SMTP";
      existing.from = "sender@example.com";
      existing.host = "smtp.example.com";
      existing.port = "465";
      existing.password = "old-password";
      existing.ssl = 1;

      const updateEmailService = sinon.stub().resolves();
      const createEmailService = sinon.stub().resolves(8);
      emailMarketingController.emailServiceModule = {
        findEmailServiceByName: sinon.stub().resolves(existing),
        findEmailServicesByHost: sinon.stub().resolves([]),
        // Resolves the raw entity so the controller can preserve empty passwords
        // on update (empty incoming password = keep existing).
        getEmailService: sinon.stub().resolves(existing),
        updateEmailService,
        createEmailService,
      } as unknown as EmailServiceModuleInterface;

      const result = await emailMarketingController.createEmailService({
        name: "Primary SMTP",
        from: "sender@example.com",
        host: "smtp.example.com",
        port: "465",
        password: "new-password",
        ssl: 1,
      });

      expect(result).to.equal(7);
      expect(updateEmailService.calledOnce).to.equal(true);
      expect(updateEmailService.firstCall.args[0]).to.equal(7);
      expect(updateEmailService.firstCall.args[1].password).to.equal(
        "new-password"
      );
      expect(createEmailService.called).to.equal(false);
    });

    it("preserves the existing password when an empty password is sent (credential sentinel)", async () => {
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Primary SMTP";
      existing.from = "sender@example.com";
      existing.host = "smtp.example.com";
      existing.port = "465";
      existing.password = "old-password";
      existing.receivePassword = "old-receive";
      existing.ssl = 1;

      const updateEmailService = sinon.stub().resolves();
      emailMarketingController.emailServiceModule = {
        findEmailServiceByName: sinon.stub().resolves(existing),
        findEmailServicesByHost: sinon.stub().resolves([]),
        getEmailService: sinon.stub().resolves(existing),
        updateEmailService,
        createEmailService: sinon.stub().resolves(8),
      } as unknown as EmailServiceModuleInterface;

      // Empty password + empty receivePassword sentinels (the renderer never
      // receives real credentials, so it cannot send them back).
      await emailMarketingController.createEmailService({
        id: 7,
        name: "Primary SMTP",
        from: "sender@example.com",
        host: "smtp.example.com",
        port: "465",
        password: "",
        ssl: 1,
        receivePassword: "",
      });

      // The existing secrets are preserved, not overwritten with empty strings.
      expect(updateEmailService.firstCall.args[1].password).to.equal(
        "old-password"
      );
      expect(updateEmailService.firstCall.args[1].receivePassword).to.equal(
        "old-receive"
      );
    });
  });

  describe("exportEmailServices", () => {
    const makeService = (id: number, name: string): EmailServiceEntity => {
      const entity = new EmailServiceEntity();
      entity.id = id;
      entity.name = name;
      entity.from = `user${id}@example.com`;
      entity.password = "SECRET-smtp-password";
      entity.host = "smtp.example.com";
      entity.port = "465";
      entity.ssl = 1;
      entity.status = 1;
      entity.receiveProtocol = "imap";
      entity.createdAt = new Date("2026-01-15T10:30:00.000Z");
      return entity;
    };

    it("exports CSV with header and safe fields only (no password)", async () => {
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon
          .stub()
          .resolves([
            makeService(1, "Primary SMTP"),
            makeService(2, 'Secondary, SMTP "quoted"'),
          ]),
      } as unknown as EmailServiceModuleInterface;

      const csv = (await emailMarketingController.exportEmailServices(
        "csv"
      )) as string;

      expect(csv).to.contain(
        "id,name,from,host,port,ssl,receiveProtocol,create_time"
      );
      expect(csv).to.contain("Primary SMTP");
      expect(csv).to.contain("user1@example.com");
      expect(csv).to.contain('"Secondary, SMTP ""quoted"""');
      expect(csv).to.not.contain("SECRET-smtp-password");
    });

    it("exports JSON with safe fields only (no password)", async () => {
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon
          .stub()
          .resolves([makeService(1, "Primary SMTP")]),
      } as unknown as EmailServiceModuleInterface;

      const payload = (await emailMarketingController.exportEmailServices(
        "json"
      )) as { total: number; services: unknown[]; exportDate: string };

      expect(payload.total).to.equal(1);
      expect(JSON.stringify(payload)).to.not.contain("SECRET-smtp-password");
      // Safe fields present: the sender email is a visible list column.
      expect(JSON.stringify(payload)).to.contain("user1@example.com");
    });

    it("returns a header-only CSV when there are no services", async () => {
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon.stub().resolves([]),
      } as unknown as EmailServiceModuleInterface;

      const csv = (await emailMarketingController.exportEmailServices(
        "csv"
      )) as string;

      expect(csv).to.equal(
        "id,name,from,host,port,ssl,receiveProtocol,create_time\n"
      );
    });
  });

  describe("importEmailServices", () => {
    // Build a stubbed module with sensible defaults; individual tests override
    // the methods they care about.
    const makeStubModule = (
      overrides: Partial<
        Record<
          | "findEmailServiceByName"
          | "createEmailService"
          | "updateEmailService"
          | "validateEmailService",
          unknown
        >
      > = {}
    ) => {
      const existing: EmailServiceEntity | undefined = undefined;
      return {
        findEmailServiceByName:
          overrides.findEmailServiceByName ?? sinon.stub().resolves(existing),
        createEmailService:
          overrides.createEmailService ?? sinon.stub().resolves(1),
        updateEmailService:
          overrides.updateEmailService ?? sinon.stub().resolves(),
        validateEmailService:
          overrides.validateEmailService ??
          sinon.stub().resolves({ valid: true, errors: [] }),
      } as unknown as EmailServiceModuleInterface;
    };

    it("parses a valid CSV and upserts each row (create when no name match)", async () => {
      const create = sinon.stub().resolves(5);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password,receiveProtocol\n" +
        "Primary,user1@example.com,smtp.example.com,465,1,secret1,imap\n" +
        "Secondary,user2@example.com,smtp2.example.com,587,0,secret2,imap\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(2);
      expect(result.skipped).to.equal(0);
      expect(create.calledTwice).to.equal(true);
      expect(create.firstCall.args[0].name).to.equal("Primary");
      expect(create.firstCall.args[0].password).to.equal("secret1");
      expect(create.secondCall.args[0].name).to.equal("Secondary");
    });

    it("updates an existing service when the name matches (no create)", async () => {
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Primary SMTP";
      const update = sinon.stub().resolves();
      const create = sinon.stub().resolves(99);
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "Primary SMTP,sender@example.com,smtp.example.com,465,1,newpass\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[0]).to.equal(7); // existing id
      expect(update.firstCall.args[1].password).to.equal("newpass"); // overwritten
      expect(create.called).to.equal(false);
    });

    it("preserves the existing receivePassword when updating by name match", async () => {
      // Import files never carry receive credentials — the existing service's
      // receive password must survive the update (encryptCredentialsForStorage
      // nulls absent receivePassword values, which would wipe it).
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Primary SMTP";
      existing.receivePassword = "existing-receive-pass";
      const update = sinon.stub().resolves();
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "Primary SMTP,sender@example.com,smtp.example.com,465,1,newpass\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[1].receivePassword).to.equal(
        "existing-receive-pass"
      );
      // The SMTP password is still overwritten by the imported value.
      expect(update.firstCall.args[1].password).to.equal("newpass");
    });

    it("skips rows with a missing password and reports the file row number", async () => {
      // validateEmailService returns errors for the passwordless row.
      const validate = sinon.stub();
      validate
        .onCall(0)
        .resolves({ valid: false, errors: ["Password is required"] });
      validate.onCall(1).resolves({ valid: true, errors: [] });
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        validateEmailService: validate,
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "NoPass,user@example.com,smtp.example.com,465,1,\n" + // row 2
        "WithPass,user2@example.com,smtp2.example.com,465,1,secret\n"; // row 3

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(result.skipped).to.equal(1);
      expect(result.errors.some((e) => /row 2/.test(e))).to.equal(true);
      expect(result.errors.some((e) => /password/i.test(e))).to.equal(true);
      expect(create.calledOnce).to.equal(true);
      expect(create.firstCall.args[0].name).to.equal("WithPass");
    });

    it("parses JSON in export-shape ({total,services,exportDate}) and imports", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const json = JSON.stringify({
        total: 1,
        services: [
          {
            name: "Primary SMTP",
            from: "sender@example.com",
            host: "smtp.example.com",
            port: "465",
            ssl: 1,
            password: "secret",
            receiveProtocol: "imap",
          },
        ],
        exportDate: "2026-09-04T00:00:00.000Z",
      });

      const result = (await emailMarketingController.importEmailServices(
        json,
        "json"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(create.firstCall.args[0].from).to.equal("sender@example.com");
    });

    it("parses JSON in bare-array shape and imports", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const json = JSON.stringify([
        {
          name: "A",
          from: "a@example.com",
          host: "h",
          port: "25",
          ssl: 1,
          password: "p",
        },
      ]);

      const result = (await emailMarketingController.importEmailServices(
        json,
        "json"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
    });

    it("returns 0 imported and a skipped count for a CSV with no data rows", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      const csv = "name,from,host,port,ssl,password\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(0);
      expect(result.skipped).to.equal(0);
    });

    it("throws on malformed JSON (invalid-file signal to the IPC layer)", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      let threw = false;
      try {
        await emailMarketingController.importEmailServices(
          "{ not json ",
          "json"
        );
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });

    it("applies defaults: ssl=1, receiveProtocol=imap when columns absent", async () => {
      // A minimal CSV with only required columns — ssl/receiveProtocol columns omitted.
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });
      const csv =
        "name,from,host,port,password\n" +
        "Minimal,m@example.com,smtp.example.com,465,pw\n";

      await emailMarketingController.importEmailServices(csv, "csv");

      expect(create.firstCall.args[0].ssl).to.equal(1);
      expect(create.firstCall.args[0].receiveProtocol).to.equal("imap");
    });
  });
});

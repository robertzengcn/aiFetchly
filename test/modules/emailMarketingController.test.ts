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
      entity.receivePassword = "SECRET-recv-password";
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
        "id,name,smtpUsername,from,replyTo,host,port,ssl,receiveProtocol,create_time"
      );
      // Full first data row locks the column ORDER (legacy row: effective
      // smtpUsername === from, replyTo → empty cell).
      expect(csv).to.contain(
        "1,Primary SMTP,user1@example.com,user1@example.com,,smtp.example.com,465,1,imap,2026-01-15T10:30:00.000Z"
      );
      expect(csv).to.contain("Primary SMTP");
      expect(csv).to.contain("user1@example.com");
      expect(csv).to.contain('"Secondary, SMTP ""quoted"""');
      expect(csv).to.not.contain("SECRET-smtp-password");
      expect(csv).to.not.contain("SECRET-recv-password");
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
      expect(JSON.stringify(payload)).to.not.contain("SECRET-recv-password");
      expect(JSON.stringify(payload)).to.not.contain('"password"');
      expect(JSON.stringify(payload)).to.not.contain('"receivePassword"');
      // Safe fields present: the sender email is a visible list column.
      expect(JSON.stringify(payload)).to.contain("user1@example.com");
      // New identity fields are exported. makeService leaves smtpUsername /
      // replyTo unset (legacy row), so the resolver's fallbacks apply:
      // effective smtpUsername === from, replyTo === null.
      const service0 = payload.services[0] as Record<string, unknown>;
      expect(service0.smtpUsername).to.equal("user1@example.com");
      expect(service0.replyTo).to.equal(null);
    });

    it("returns a header-only CSV when there are no services", async () => {
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon.stub().resolves([]),
      } as unknown as EmailServiceModuleInterface;

      const csv = (await emailMarketingController.exportEmailServices(
        "csv"
      )) as string;

      expect(csv).to.equal(
        "id,name,smtpUsername,from,replyTo,host,port,ssl,receiveProtocol,create_time\n"
      );
    });

    it("exports explicit smtpUsername and replyTo values (no fallback)", async () => {
      // A service with explicit identity columns exports those values, not
      // the resolver's legacy fallbacks (smtpUsername -> from, replyTo -> null).
      const service = makeService(3, "Identity Service");
      service.smtpUsername = "login@example.com";
      service.replyTo = "replies@example.com";
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon.stub().resolves([service]),
      } as unknown as EmailServiceModuleInterface;

      const csv = (await emailMarketingController.exportEmailServices(
        "csv"
      )) as string;

      expect(csv).to.contain("login@example.com");
      expect(csv).to.contain("replies@example.com");

      const payload = (await emailMarketingController.exportEmailServices(
        "json"
      )) as {
        total: number;
        services: Record<string, unknown>[];
        exportDate: string;
      };
      const service0 = payload.services[0];
      expect(service0.smtpUsername).to.equal("login@example.com");
      expect(service0.replyTo).to.equal("replies@example.com");
    });

    it("exports no password key or value in either format for a password-bearing service", async () => {
      // makeService sets a real password; neither the CSV nor the JSON export
      // may carry it, and the JSON row must not even contain a `password` key.
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon
          .stub()
          .resolves([makeService(4, "Secret Service")]),
      } as unknown as EmailServiceModuleInterface;

      const csv = (await emailMarketingController.exportEmailServices(
        "csv"
      )) as string;
      expect(csv).to.not.contain("SECRET-smtp-password");
      expect(csv).to.not.contain("SECRET-recv-password");

      const payload = await emailMarketingController.exportEmailServices(
        "json"
      );
      const serialized = JSON.stringify(payload);
      expect(serialized).to.not.contain("SECRET-smtp-password");
      expect(serialized).to.not.contain("SECRET-recv-password");
      expect(serialized).to.not.contain('"password"');
      expect(serialized).to.not.contain('"receivePassword"');
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
      // Other receive fields are materialized from the existing service (not
      // undefined) — the update always writes the merged receive config,
      // which equals the existing service's values since import files never
      // carry receive columns. Here `existing` has no receive fields set, so
      // the defaults apply: receiveEnabled 0, imapHost null.
      expect(update.firstCall.args[1].receiveEnabled).to.equal(0);
      expect(update.firstCall.args[1].imapHost).to.equal(null);
    });

    it("preserves the existing receiveProtocol when the import row omits it", async () => {
      // A hand-edited CSV without a receiveProtocol column must not rewrite
      // an existing pop3 service to imap — the mapper default must only
      // apply on create, never on update-by-name.
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Pop Service";
      existing.receiveProtocol = "pop3";
      const update = sinon.stub().resolves();
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
      });

      // No receiveProtocol column in the header row.
      const csv =
        "name,from,host,port,ssl,password\n" +
        "Pop Service,pop@example.com,pop.example.com,995,1,newpass\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[1].receiveProtocol).to.equal("pop3");
    });

    it("defaults receiveProtocol to imap on create when the import row omits it", async () => {
      // A new service (no name match) always needs a valid protocol.
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "Newbie,n@example.com,smtp.example.com,465,1,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(create.calledOnce).to.equal(true);
      expect(create.firstCall.args[0].receiveProtocol).to.equal("imap");
    });

    it("lets an explicit receiveProtocol in the import row win over the existing one", async () => {
      // Import carries pop3 explicitly while the existing service is imap:
      // the imported value is the user's explicit intent and must win.
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Switch Service";
      existing.receiveProtocol = "imap";
      const update = sinon.stub().resolves();
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
      });

      const csv =
        "name,from,host,port,ssl,password,receiveProtocol\n" +
        "Switch Service,s@example.com,smtp.example.com,465,1,newpass,pop3\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[1].receiveProtocol).to.equal("pop3");
    });

    it("skips a row with a field-count mismatch and imports the valid rows (partial import)", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      // Second data row has 7 fields vs 6 headers → TooManyFields.
      const csv =
        "name,from,host,port,ssl,password\n" +
        "Good,g@x.com,smtp.example.com,465,1,pw\n" +
        "Bad,b@x.com,smtp.example.com,465,1,pw,extra\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(result.skipped).to.equal(1);
      expect(result.errors.some((e) => /row 3/.test(e))).to.equal(true);
      expect(result.errors.some((e) => /too many fields/i.test(e))).to.equal(
        true
      );
      expect(create.calledOnce).to.equal(true);
      expect(create.firstCall.args[0].name).to.equal("Good");
    });

    it("skips a TooFewFields row and imports the valid rows (fewer fields than headers)", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      // First data row has 4 fields vs 6 headers → TooFewFields (row 2).
      const csv =
        "name,from,host,port,ssl,password\n" +
        "Bad,b@x.com,smtp.example.com,465\n" +
        "ValidRow,g@x.com,smtp.example.com,465,1,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(result.skipped).to.equal(1);
      expect(result.errors.some((e) => /row 2/.test(e))).to.equal(true);
      expect(result.errors.some((e) => /too few fields/i.test(e))).to.equal(
        true
      );
      expect(create.calledOnce).to.equal(true);
      expect(create.firstCall.args[0].name).to.equal("ValidRow");
    });

    it("ignores whitespace-only lines between rows", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "   \n" +
        "Good,g@x.com,smtp.example.com,465,1,pw\n" +
        "   \n" +
        "Good2,g2@x.com,smtp.example.com,465,1,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(2);
      expect(result.skipped).to.equal(0);
      expect(result.errors.length).to.equal(0);
    });

    it("reports a row error for an unparseable ssl value instead of storing it", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "Badssl,b@x.com,smtp.example.com,465,banana,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(0);
      expect(result.skipped).to.equal(1);
      expect(result.errors.some((e) => /ssl/i.test(e))).to.equal(true);
      expect(create.called).to.equal(false);
    });

    it("coerces friendly ssl values: true/false/yes/no", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "A,a@x.com,smtp.example.com,465,true,pw\n" +
        "B,b@x.com,smtp.example.com,465,false,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(2);
      expect(create.firstCall.args[0].ssl).to.equal(1);
      expect(create.secondCall.args[0].ssl).to.equal(0);
    });

    it("caps reported errors at 10 while counting all skipped rows", async () => {
      // All 12 rows fail validation → skipped 12, but errors capped at 10.
      const validate = sinon.stub().resolves({
        valid: false,
        errors: [
          { code: "password_required", message: "Password is required" },
        ],
      });
      emailMarketingController.emailServiceModule = makeStubModule({
        validateEmailService: validate,
      });

      const rows = Array.from(
        { length: 12 },
        (_, i) => `S${i},u${i}@x.com,smtp.example.com,465,1,\n`
      ).join("");
      const csv = "name,from,host,port,ssl,password\n" + rows;

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.skipped).to.equal(12);
      expect(result.imported).to.equal(0);
      expect(result.errors.length).to.equal(10);
    });

    it("throws on a structurally malformed CSV (unterminated quote)", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      let threw = false;
      try {
        await emailMarketingController.importEmailServices(
          'name,from,host,port,ssl,password\n"Unclosed,x.com,465,1,pw\n',
          "csv"
        );
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });

    it("throws on a JSON object without a services array", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      let threw = false;
      try {
        await emailMarketingController.importEmailServices('{"foo":1}', "json");
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });

    it("skips non-object elements in a JSON array with a row error", async () => {
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
        null,
      ]);

      const result = (await emailMarketingController.importEmailServices(
        json,
        "json"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(result.skipped).to.equal(1);
      expect(result.errors.some((e) => /row 2/.test(e))).to.equal(true);
    });

    it("skips rows with a missing password and reports the file row number", async () => {
      // validateEmailService returns errors for the passwordless row.
      const validate = sinon.stub();
      validate.onCall(0).resolves({
        valid: false,
        errors: [
          { code: "password_required", message: "Password is required" },
        ],
      });
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

    it("treats a 0-byte CSV as zero rows, not a malformed file", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      const result = (await emailMarketingController.importEmailServices(
        "",
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(0);
      expect(result.skipped).to.equal(0);
      expect(result.errors.length).to.equal(0);
    });

    it("treats a whitespace-only CSV as zero rows, not a malformed file", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      const result = (await emailMarketingController.importEmailServices(
        "   \n  \n",
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(0);
      expect(result.skipped).to.equal(0);
      expect(result.errors.length).to.equal(0);
    });

    it("imports a BOM-prefixed CSV (Excel/Windows export) normally", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      // U+FEFF BOM before the first header, as Excel-on-Windows writes.
      // Papa does not strip it (trim() treats Cf as non-whitespace), so it
      // otherwise lands in the first column name and every row loses `name`.
      const bom = String.fromCharCode(0xfeff);
      const csv =
        bom +
        "name,from,host,port,ssl,password\n" +
        "Bom,b@x.com,smtp.example.com,465,1,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(result.skipped).to.equal(0);
      expect(create.firstCall.args[0].name).to.equal("Bom");
    });

    it("imports a BOM-prefixed JSON file normally", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      // A leading BOM makes JSON.parse reject the whole file otherwise.
      const bom = String.fromCharCode(0xfeff);
      const json =
        bom +
        JSON.stringify([
          {
            name: "Bom",
            from: "b@example.com",
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
      expect(create.firstCall.args[0].name).to.equal("Bom");
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

    it("maps all documented header aliases (smtpUsername/smtpusername/smtp_username; replyTo/replyto/reply_to)", async () => {
      // §10.2 — every documented alias form must land on the same normalized
      // identity field: CSV headers are lowercased by transformHeader, JSON
      // rows keep their original key case (camelCase export shape + snake_case
      // legacy shape).
      const runImport = async (
        content: string,
        format: "csv" | "json"
      ): Promise<sinon.SinonStub> => {
        const create = sinon.stub().resolves(1);
        emailMarketingController.emailServiceModule = makeStubModule({
          createEmailService: create,
        });
        const result = (await emailMarketingController.importEmailServices(
          content,
          format
        )) as EmailServiceImportResult;
        expect(result.imported).to.equal(1);
        expect(result.skipped).to.equal(0);
        return create;
      };

      // CSV: lowercase headers `smtpusername` / `replyto` (transformHeader
      // lowercases them; `smtpusername` is itself an alias).
      let create = await runImport(
        "name,smtpusername,replyto,from,host,port,ssl,password\n" +
          "CsvLower,login1@x.com,replies1@x.com,user1@x.com,smtp.example.com,465,1,pw\n",
        "csv"
      );
      expect(create.firstCall.args[0].smtpUsername).to.equal("login1@x.com");
      expect(create.firstCall.args[0].replyTo).to.equal("replies1@x.com");

      // JSON: snake_case keys smtp_username / reply_to (legacy documented form).
      create = await runImport(
        JSON.stringify([
          {
            name: "JsonSnake",
            smtp_username: "login2@x.com",
            reply_to: "replies2@x.com",
            from: "user2@x.com",
            host: "smtp.example.com",
            port: "465",
            ssl: 1,
            password: "pw",
          },
        ]),
        "json"
      );
      expect(create.firstCall.args[0].smtpUsername).to.equal("login2@x.com");
      expect(create.firstCall.args[0].replyTo).to.equal("replies2@x.com");

      // JSON: camelCase keys smtpUsername / replyTo (export shape).
      create = await runImport(
        JSON.stringify([
          {
            name: "JsonCamel",
            smtpUsername: "login3@x.com",
            replyTo: "replies3@x.com",
            from: "user3@x.com",
            host: "smtp.example.com",
            port: "465",
            ssl: 1,
            password: "pw",
          },
        ]),
        "json"
      );
      expect(create.firstCall.args[0].smtpUsername).to.equal("login3@x.com");
      expect(create.firstCall.args[0].replyTo).to.equal("replies3@x.com");
    });

    it("rejects a row whose aliases conflict with duplicate_field_conflict", async () => {
      // A JSON row can carry BOTH aliases (CSV cannot — Papa dedupes headers).
      // Different non-empty values → duplicate_field_conflict; same value in
      // two aliases → no conflict (≤ 1 distinct non-empty value).
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const conflicting = JSON.stringify([
        {
          name: "Conflict",
          smtpUsername: "login@x.com",
          smtp_username: "other@x.com",
          from: "user@x.com",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
          password: "pw",
        },
      ]);

      const result = (await emailMarketingController.importEmailServices(
        conflicting,
        "json"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(0);
      expect(result.skipped).to.equal(1);
      expect(
        result.errors.some((e) => e.includes("duplicate_field_conflict"))
      ).to.equal(true);
      expect(create.called).to.equal(false);

      // Same value in two aliases: NOT a conflict — imports fine.
      const agree = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: agree,
      });
      const agreeResult = (await emailMarketingController.importEmailServices(
        JSON.stringify([
          {
            name: "Agree",
            smtpUsername: "login@x.com",
            smtp_username: "login@x.com",
            from: "user@x.com",
            host: "smtp.example.com",
            port: "465",
            ssl: 1,
            password: "pw",
          },
        ]),
        "json"
      )) as EmailServiceImportResult;

      expect(agreeResult.imported).to.equal(1);
      expect(agreeResult.skipped).to.equal(0);
      expect(agree.firstCall.args[0].smtpUsername).to.equal("login@x.com");
    });

    it("preserves existing identity when a legacy file omits the new columns", async () => {
      // §10.4 absent = preserve: a legacy CSV without smtpUsername/replyTo
      // columns must never wipe stored identity values on update.
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Legacy Service";
      existing.smtpUsername = "legacy-login@x.com";
      existing.replyTo = "legacy-reply@x.com";
      const update = sinon.stub().resolves();
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "Legacy Service,sender@example.com,smtp.example.com,465,1,newpass\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[1].smtpUsername).to.equal(
        "legacy-login@x.com"
      );
      expect(update.firstCall.args[1].replyTo).to.equal("legacy-reply@x.com");
    });

    it("clears replyTo to null when the imported value is blank", async () => {
      // §10.4 blank = clear: an empty replyto cell is an explicit reset.
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Clear Reply";
      existing.replyTo = "old-reply@x.com";
      const update = sinon.stub().resolves();
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
      });

      const csv =
        "name,replyto,from,host,port,ssl,password\n" +
        "Clear Reply,,sender@example.com,smtp.example.com,465,1,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[1].replyTo).to.equal(null);
    });

    it("resets smtpUsername to the From fallback when the imported value is blank", async () => {
      // §10.4 blank = reset: an empty smtpusername cell resets the stored
      // login to null (which resolves to From at runtime).
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Reset Login";
      existing.smtpUsername = "legacy-login@x.com";
      const update = sinon.stub().resolves();
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
      });

      const csv =
        "name,smtpusername,from,host,port,ssl,password\n" +
        "Reset Login,,sender@example.com,smtp.example.com,465,1,pw\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[1].smtpUsername).to.equal(null);
    });

    it("preserves the stored password when the imported password is blank (update)", async () => {
      // §10.4: a blank/absent password NEVER clears the stored one on update,
      // and validation runs in update mode with hasStoredPassword=true.
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Keep Secret";
      existing.password = "stored-secret";
      const update = sinon.stub().resolves();
      let captured: { mode?: string; hasStoredPassword?: boolean } = {};
      const validate = sinon
        .stub()
        .callsFake(
          (
            _entity: unknown,
            options: { mode: string; hasStoredPassword?: boolean }
          ) => {
            captured = options;
            return Promise.resolve({ valid: true, errors: [] });
          }
        );
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
        validateEmailService: validate,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "Keep Secret,sender@example.com,smtp.example.com,465,1,\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[1].password).to.equal("stored-secret");
      expect(captured.mode).to.equal("update");
      expect(captured.hasStoredPassword).to.equal(true);
    });

    it("rejects a new service with a blank password (create mode)", async () => {
      // No existing service → create mode; a blank password must be rejected
      // by validation (password_required) with hasStoredPassword=false.
      const create = sinon.stub().resolves(1);
      let captured: { mode?: string; hasStoredPassword?: boolean } = {};
      const validate = sinon
        .stub()
        .callsFake(
          (
            entity: { password?: string },
            options: { mode: string; hasStoredPassword?: boolean }
          ) => {
            captured = options;
            return Promise.resolve(
              options.mode === "create" && !entity.password
                ? {
                    valid: false,
                    errors: [
                      {
                        code: "password_required",
                        message: "Password is required",
                      },
                    ],
                  }
                : { valid: true, errors: [] }
            );
          }
        );
      emailMarketingController.emailServiceModule = makeStubModule({
        validateEmailService: validate,
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "NewNoPass,user@example.com,smtp.example.com,465,1,\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(0);
      expect(result.skipped).to.equal(1);
      expect(result.errors.some((e) => /password/i.test(e))).to.equal(true);
      expect(captured.mode).to.equal("create");
      expect(captured.hasStoredPassword).to.equal(false);
      expect(create.called).to.equal(false);
    });
  });

  describe("resolveOutboundSetting", () => {
    // sendEmail hands param.Setting straight to `new EmailService(...)`, whose
    // transporter reads Setting.password directly. When editing an existing
    // service, getEmailServiceDetail returns password: "" (credential
    // sentinel — plaintext never round-trips to the renderer), so an edit-mode
    // "Test" send arrives with an empty password. resolveOutboundSetting must
    // swap the sentinel for the stored password by id, mirroring
    // EMAILSERVICEUPDATE's credential handling.

    const makeSetting = (
      overrides: Partial<
        import("@/entityTypes/emailmarketingType").EmailServiceEntitydata
      > = {}
    ) => {
      const setting: import("@/entityTypes/emailmarketingType").EmailServiceEntitydata =
        {
          name: "Primary SMTP",
          from: "sender@example.com",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
          password: "",
          ...overrides,
        };
      return setting;
    };

    it("reuses the stored password when the incoming password is the empty sentinel (edit mode)", async () => {
      const existing = new EmailServiceEntity();
      existing.id = 9;
      existing.name = "Primary SMTP";
      existing.from = "sender@example.com";
      existing.host = "smtp.example.com";
      existing.port = "465";
      existing.password = "stored-smtp-password";
      existing.ssl = 1;

      const getEmailService = sinon.stub().resolves(existing);
      emailMarketingController.emailServiceModule = {
        getEmailService,
      } as unknown as EmailServiceModuleInterface;

      const setting = makeSetting({ id: 9 });
      const resolved = await emailMarketingController.resolveOutboundSetting(
        setting
      );

      expect(getEmailService.calledOnce).to.equal(true);
      expect(getEmailService.firstCall.args[0]).to.equal(9);
      expect(resolved.password).to.equal("stored-smtp-password");
      // The other form fields stay as the user edited them.
      expect(resolved.host).to.equal("smtp.example.com");
      expect(resolved.from).to.equal("sender@example.com");
      // Immutability: the caller's setting is not mutated.
      expect(setting.password).to.equal("");
    });

    it("keeps the incoming password when a non-empty password is supplied (create / re-entered)", async () => {
      const getEmailService = sinon.stub().resolves(undefined);
      emailMarketingController.emailServiceModule = {
        getEmailService,
      } as unknown as EmailServiceModuleInterface;

      const resolved = await emailMarketingController.resolveOutboundSetting(
        makeSetting({ id: 9, password: "fresh-password" })
      );

      // No DB lookup needed — the form sent a real password.
      expect(getEmailService.called).to.equal(false);
      expect(resolved.password).to.equal("fresh-password");
    });

    it("keeps the empty password when no id is carried (create mode, no lookup)", async () => {
      const getEmailService = sinon.stub().resolves(undefined);
      emailMarketingController.emailServiceModule = {
        getEmailService,
      } as unknown as EmailServiceModuleInterface;

      const resolved = await emailMarketingController.resolveOutboundSetting(
        makeSetting()
      );

      expect(getEmailService.called).to.equal(false);
      expect(resolved.password).to.equal("");
    });

    it("throws when the sentinel needs the stored password but the service no longer exists", async () => {
      emailMarketingController.emailServiceModule = {
        getEmailService: sinon.stub().resolves(undefined),
      } as unknown as EmailServiceModuleInterface;

      let threw = false;
      try {
        await emailMarketingController.resolveOutboundSetting(
          makeSetting({ id: 99 })
        );
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });
});

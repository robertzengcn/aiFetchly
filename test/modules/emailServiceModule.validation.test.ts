"use strict";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import expect from "expect.js";

function makeService(
  overrides: Partial<EmailServiceEntity> = {}
): EmailServiceEntity {
  const service = new EmailServiceEntity();
  service.id = 1;
  service.name = "Primary SMTP";
  service.from = "sales@example.com";
  service.smtpUsername = null;
  service.replyTo = null;
  service.password = "smtp-password";
  service.host = "smtp.example.com";
  service.port = "465";
  service.ssl = 1;
  service.status = 1;
  service.receiveProtocol = "imap";
  service.imapHost = null;
  service.imapPort = null;
  service.imapSsl = 1;
  service.pop3Host = null;
  service.pop3Port = null;
  service.pop3Ssl = 1;
  service.receiveUsername = null;
  service.receivePassword = null;
  service.receiveFolder = "INBOX";
  service.receiveEnabled = 0;
  service.lastReceiveSyncAt = null;
  service.lastReceiveSyncError = null;
  Object.assign(service, overrides);
  return service;
}

describe("EmailServiceModule.validateEmailService (options-aware)", function () {
  it("create mode requires an effective SMTP username and password", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ password: "" }),
      { mode: "create" }
    );
    expect(result.valid).to.be(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("password_required");
  });

  it("update mode accepts the password sentinel when a stored password exists", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ password: "" }),
      { mode: "update", hasStoredPassword: true }
    );
    expect(result.valid).to.be(true);
  });

  it("send mode requires a real decrypted password", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ password: "" }),
      { mode: "send" }
    );
    expect(result.valid).to.be(false);
    expect(result.errors.map((e) => e.code)).to.contain("password_required");
  });

  it("blank smtpUsername resolves to From and does not error", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ smtpUsername: "   ", password: "pw" }),
      { mode: "create" }
    );
    expect(result.valid).to.be(true);
  });

  it("CR/LF in smtpUsername is rejected with email_header_break_forbidden", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ smtpUsername: "user\n@x.com", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("email_header_break_forbidden");
  });

  it("invalid From is rejected with from_invalid", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ from: "not-an-email", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("from_invalid");
  });

  it("invalid Reply-To is rejected with reply_to_invalid", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ replyTo: "not-an-email", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("reply_to_invalid");
  });

  it("port out of range is rejected with port_invalid", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ port: "99999", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("port_invalid");
  });

  it("non-integer ports are rejected with port_invalid", async function () {
    const module = new EmailServiceModule();
    const fractional = await module.validateEmailService(
      makeService({ port: "4.65", password: "pw" }),
      { mode: "create" }
    );
    expect(fractional.errors.map((e) => e.code)).to.contain("port_invalid");
    const scientific = await module.validateEmailService(
      makeService({ port: "1e2", password: "pw" }),
      { mode: "create" }
    );
    expect(scientific.errors.map((e) => e.code)).to.contain("port_invalid");
  });

  it("port boundaries 0 and 65536 are rejected; 1 and 65535 are accepted", async function () {
    const module = new EmailServiceModule();
    for (const port of ["0", "65536"]) {
      const result = await module.validateEmailService(
        makeService({ port, password: "pw" }),
        { mode: "create" }
      );
      expect(result.errors.map((e) => e.code)).to.contain("port_invalid");
    }
    for (const port of ["1", "65535"]) {
      const result = await module.validateEmailService(
        makeService({ port, password: "pw" }),
        { mode: "create" }
      );
      expect(result.valid).to.be(true);
    }
  });

  it("update mode without a stored password still requires a password", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ password: "" }),
      { mode: "update", hasStoredPassword: false }
    );
    expect(result.valid).to.be(false);
    expect(result.errors.map((e) => e.code)).to.contain("password_required");
  });

  it("receive enabled with a missing receive host is rejected with receive_config_invalid", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ receiveEnabled: 1, imapHost: null }),
      { mode: "create" }
    );
    expect(result.valid).to.be(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("receive_config_invalid");
    const receiveError = result.errors.find(
      (e) => e.code === "receive_config_invalid"
    );
    expect(receiveError?.message ?? "").to.contain(
      "Receive IMAP host is required"
    );
  });

  it("receive enabled resolves the receive username through the 3-level fallback", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({
        smtpUsername: "smtp-login@example.com",
        receiveUsername: null,
        receiveEnabled: 1,
        imapHost: "imap.example.com",
        imapPort: "993",
      }),
      { mode: "create" }
    );
    expect(result.valid).to.be(true);
  });
});

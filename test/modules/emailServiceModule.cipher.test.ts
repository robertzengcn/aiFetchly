"use strict";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import expect from "expect.js";

const TEST_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex"
);

function makeEmailService(
  overrides: Partial<EmailServiceEntity> = {}
): EmailServiceEntity {
  const service = new EmailServiceEntity();
  service.id = 1;
  service.name = "Primary SMTP";
  service.from = "sender@example.com";
  service.password = "smtp-password";
  service.host = "smtp.example.com";
  service.port = "465";
  service.ssl = 1;
  service.status = 1;
  service.receiveProtocol = "imap";
  service.imapHost = "imap.example.com";
  service.imapPort = "993";
  service.imapSsl = 1;
  service.pop3Host = null;
  service.pop3Port = null;
  service.pop3Ssl = 1;
  service.receiveUsername = null;
  service.receivePassword = "receive-password";
  service.receiveFolder = "INBOX";
  service.receiveEnabled = 1;
  service.lastReceiveSyncAt = null;
  service.lastReceiveSyncError = null;
  Object.assign(service, overrides);
  return service;
}

describe("EmailServiceModule crypto wiring", function () {
  let originalGetKey: typeof userSecretKeyService.getKey;

  beforeEach(function () {
    originalGetKey = userSecretKeyService.getKey.bind(userSecretKeyService);
    (
      userSecretKeyService as unknown as { getKey: () => Promise<Buffer> }
    ).getKey = async () => TEST_KEY;
  });

  afterEach(function () {
    (
      userSecretKeyService as unknown as {
        getKey: typeof userSecretKeyService.getKey;
      }
    ).getKey = originalGetKey;
    userSecretKeyService.invalidate();
  });

  it("encrypts SMTP and receive passwords before creating a service", async function () {
    let captured: EmailServiceEntity | null = null;
    const module = new EmailServiceModule();
    (
      module as unknown as {
        emailServiceModel: {
          create: (service: EmailServiceEntity) => Promise<number>;
        };
      }
    ).emailServiceModel = {
      async create(service: EmailServiceEntity): Promise<number> {
        captured = service;
        return 7;
      },
    };

    const result = await module.createEmailService(makeEmailService());

    expect(result).to.equal(7);
    expect(captured).not.to.be(null);
    const stored = captured as unknown as EmailServiceEntity;
    expect(FieldCipher.isEncrypted(stored.password)).to.be(true);
    expect(FieldCipher.isEncrypted(stored.receivePassword)).to.be(true);
    expect(stored.password).not.to.equal("smtp-password");
    expect(stored.receivePassword).not.to.equal("receive-password");
  });

  it("decrypts stored encrypted credentials when reading a service", async function () {
    const stored = makeEmailService({
      password: FieldCipher.encrypt("smtp-password", TEST_KEY),
      receivePassword: FieldCipher.encrypt("receive-password", TEST_KEY),
    });
    const module = new EmailServiceModule();
    (
      module as unknown as {
        emailServiceModel: {
          read: (id: number) => Promise<EmailServiceEntity | undefined>;
        };
      }
    ).emailServiceModel = {
      async read(): Promise<EmailServiceEntity | undefined> {
        return stored;
      },
    };

    const service = await module.getEmailService(1);

    expect(service?.password).to.equal("smtp-password");
    expect(service?.receivePassword).to.equal("receive-password");
  });

  it("returns legacy plaintext credentials as-is", async function () {
    const module = new EmailServiceModule();
    (
      module as unknown as {
        emailServiceModel: {
          read: (id: number) => Promise<EmailServiceEntity | undefined>;
        };
      }
    ).emailServiceModel = {
      async read(): Promise<EmailServiceEntity | undefined> {
        return makeEmailService({
          password: "legacy-smtp-password",
          receivePassword: "legacy-receive-password",
        });
      },
    };

    const service = await module.getEmailService(1);

    expect(service?.password).to.equal("legacy-smtp-password");
    expect(service?.receivePassword).to.equal("legacy-receive-password");
  });

  it("does not double-encrypt already encrypted credentials", async function () {
    const encryptedPassword = FieldCipher.encrypt("smtp-password", TEST_KEY);
    const encryptedReceivePassword = FieldCipher.encrypt(
      "receive-password",
      TEST_KEY
    );
    let captured: EmailServiceEntity | null = null;
    const module = new EmailServiceModule();
    (
      module as unknown as {
        emailServiceModel: {
          update: (id: number, service: EmailServiceEntity) => Promise<void>;
        };
      }
    ).emailServiceModel = {
      async update(_id: number, service: EmailServiceEntity): Promise<void> {
        captured = service;
      },
    };

    await module.updateEmailService(
      1,
      makeEmailService({
        password: encryptedPassword,
        receivePassword: encryptedReceivePassword,
      })
    );

    const stored = captured as unknown as EmailServiceEntity;
    expect(stored.password).to.equal(encryptedPassword);
    expect(stored.receivePassword).to.equal(encryptedReceivePassword);
  });

  it("preserves encrypted envelopes when decrypt key lookup fails", async function () {
    const encryptedPassword = FieldCipher.encrypt("smtp-password", TEST_KEY);
    const encryptedReceivePassword = FieldCipher.encrypt(
      "receive-password",
      TEST_KEY
    );
    (
      userSecretKeyService as unknown as { getKey: () => Promise<Buffer> }
    ).getKey = async () => {
      throw new SecretKeyUnavailableError("stubbed key unavailable");
    };
    const originalWarn = console.warn;
    console.warn = (): void => undefined;
    const module = new EmailServiceModule();
    (
      module as unknown as {
        emailServiceModel: {
          read: (id: number) => Promise<EmailServiceEntity | undefined>;
        };
      }
    ).emailServiceModel = {
      async read(): Promise<EmailServiceEntity | undefined> {
        return makeEmailService({
          password: encryptedPassword,
          receivePassword: encryptedReceivePassword,
        });
      },
    };

    let service: EmailServiceEntity | undefined;
    try {
      service = await module.getEmailService(1);
    } finally {
      console.warn = originalWarn;
    }

    expect(service?.password).to.equal(encryptedPassword);
    expect(service?.receivePassword).to.equal(encryptedReceivePassword);
  });
});

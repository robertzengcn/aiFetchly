import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailServiceEntitydata } from "@/entityTypes/emailmarketingType";

const smtpMock = vi.hoisted(() => ({
  createTransport: vi.fn(() => ({
    on: vi.fn(),
    sendMail: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: smtpMock.createTransport,
  },
}));

import {
  SMTP_IMPLICIT_TLS_PORT,
  OutboundSmtpSession,
  buildSmtpTransportOptions,
  createOutboundSmtpTransporter,
  shouldRetrySmtpTlsMode,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";

function service(
  overrides: Partial<EmailServiceEntitydata> = {}
): EmailServiceEntitydata {
  return {
    name: "SpaceMail",
    from: "richard@aiagentlnc.com",
    password: "secret",
    host: "mail.spacemail.com",
    port: "587",
    ssl: 1,
    ...overrides,
  };
}

function fakeTransporter(sendMail: ReturnType<typeof vi.fn>) {
  return {
    on: vi.fn(),
    close: vi.fn(),
    sendMail,
  };
}

describe("buildSmtpTransportOptions", () => {
  it("uses STARTTLS when SSL is enabled on port 587", () => {
    expect(buildSmtpTransportOptions(service({ port: "587", ssl: 1 }))).toEqual(
      {
        host: "mail.spacemail.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: "richard@aiagentlnc.com",
          pass: "secret",
        },
      }
    );
  });

  it("uses implicit TLS when SSL is enabled on port 465", () => {
    expect(buildSmtpTransportOptions(service({ port: "465", ssl: 1 }))).toEqual(
      {
        host: "mail.spacemail.com",
        port: SMTP_IMPLICIT_TLS_PORT,
        secure: true,
        requireTLS: false,
        auth: {
          user: "richard@aiagentlnc.com",
          pass: "secret",
        },
      }
    );
  });

  it("uses implicit TLS on port 465 even when the SSL toggle is off", () => {
    const options = buildSmtpTransportOptions(
      service({ port: "465", ssl: 0 })
    );

    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it("does not require TLS when SSL is off on a STARTTLS port", () => {
    const options = buildSmtpTransportOptions(
      service({ port: "587", ssl: 0 })
    );

    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(false);
  });

  it("uses STARTTLS for SSL on non-465 ports such as 25", () => {
    const options = buildSmtpTransportOptions(
      service({ port: "25", ssl: 1 })
    );

    expect(options.port).toBe(25);
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
  });

  it("can force implicit TLS on port 587 for a fallback retry", () => {
    const options = buildSmtpTransportOptions(
      service({ port: "587", ssl: 1 }),
      "implicitTls"
    );

    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it("can force STARTTLS on port 465 for a fallback retry", () => {
    const options = buildSmtpTransportOptions(
      service({ port: "465", ssl: 1 }),
      "starttls"
    );

    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
  });
});

describe("shouldRetrySmtpTlsMode", () => {
  it("retries STARTTLS after WRONG_VERSION_NUMBER on implicit TLS", () => {
    const error = new Error(
      "70214976:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER"
    );

    expect(
      shouldRetrySmtpTlsMode(error, "configured", service({ port: "465" }))
    ).toBe("starttls");
  });

  it("retries implicit TLS after a STARTTLS greeting timeout on 587", () => {
    const error = new Error("Failed to receive greeting");
    Object.assign(error, { code: "GREETING_TIMEOUT" });

    expect(
      shouldRetrySmtpTlsMode(error, "configured", service({ port: "587" }))
    ).toBe("implicitTls");
  });

  it("retries implicit TLS after ECONNRESET on a STARTTLS port", () => {
    const error = new Error("socket hang up");
    Object.assign(error, { code: "ECONNRESET" });

    expect(
      shouldRetrySmtpTlsMode(error, "configured", service({ port: "587" }))
    ).toBe("implicitTls");
  });

  it("does not retry authentication failures", () => {
    const error = new Error(
      "Invalid login: 535 5.7.8 Error: authentication failed"
    );
    Object.assign(error, { command: "AUTH", code: "EAUTH" });

    expect(
      shouldRetrySmtpTlsMode(error, "configured", service({ port: "587" }))
    ).toBeNull();
  });

  it("does not retry a second time after the fallback attempt", () => {
    const error = new Error("OPENSSL_internal:WRONG_VERSION_NUMBER");

    expect(
      shouldRetrySmtpTlsMode(error, "implicitTls", service({ port: "587" }))
    ).toBeNull();
  });

  it("does not retry when SSL is off on a non-465 port", () => {
    const error = new Error("OPENSSL_internal:WRONG_VERSION_NUMBER");

    expect(
      shouldRetrySmtpTlsMode(
        error,
        "configured",
        service({ port: "587", ssl: 0 })
      )
    ).toBeNull();
  });
});

describe("smtpErrorMessage", () => {
  it("explains WRONG_VERSION_NUMBER as a TLS-mode mismatch", () => {
    const message = smtpErrorMessage(
      new Error(
        "70214976:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER"
      )
    );

    expect(message).toContain("WRONG_VERSION_NUMBER");
    expect(message).toContain("Port 587 uses STARTTLS");
    expect(message).toContain("port 465 uses implicit SSL/TLS");
  });

  it("returns a plain Error message unchanged", () => {
    expect(smtpErrorMessage(new Error("Invalid login"))).toBe("Invalid login");
  });

  it("stringifies non-Error throws", () => {
    expect(smtpErrorMessage("boom")).toBe("boom");
  });
});

describe("createOutboundSmtpTransporter", () => {
  beforeEach(() => {
    smtpMock.createTransport.mockClear();
  });

  it("passes STARTTLS options into nodemailer for SSL on 587", () => {
    createOutboundSmtpTransporter(service({ port: "587", ssl: 1 }));

    expect(smtpMock.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.spacemail.com",
        port: 587,
        secure: false,
        requireTLS: true,
      })
    );
  });

  it("passes implicit TLS options into nodemailer for SSL on 465", () => {
    createOutboundSmtpTransporter(service({ port: "465", ssl: 1 }));

    expect(smtpMock.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 465,
        secure: true,
        requireTLS: false,
      })
    );
  });
});

describe("OutboundSmtpSession TLS fallback", () => {
  beforeEach(() => {
    smtpMock.createTransport.mockReset();
    smtpMock.createTransport.mockImplementation(() => ({
      on: vi.fn(),
      sendMail: vi.fn(),
      close: vi.fn(),
    }));
  });

  it("retries STARTTLS after implicit TLS WRONG_VERSION_NUMBER", async () => {
    const first = fakeTransporter(
      vi.fn().mockRejectedValue(
        new Error("OPENSSL_internal:WRONG_VERSION_NUMBER")
      )
    );
    const second = fakeTransporter(
      vi.fn().mockResolvedValue({ response: "250 accepted" })
    );
    smtpMock.createTransport
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    const session = new OutboundSmtpSession(service({ port: "465", ssl: 1 }));
    const info = await session.sendMail({
      from: "richard@aiagentlnc.com",
      to: "buyer@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(info.response).toBe("250 accepted");
    expect(first.close).toHaveBeenCalledOnce();
    expect(smtpMock.createTransport).toHaveBeenCalledTimes(2);
    expect(smtpMock.createTransport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        port: 465,
        secure: false,
        requireTLS: true,
      })
    );
  });

  it("retries implicit TLS after a 587 STARTTLS greeting timeout", async () => {
    const greetingTimeout = new Error("Failed to receive greeting");
    Object.assign(greetingTimeout, { code: "GREETING_TIMEOUT" });
    const first = fakeTransporter(vi.fn().mockRejectedValue(greetingTimeout));
    const second = fakeTransporter(
      vi.fn().mockResolvedValue({ response: "250 accepted" })
    );
    smtpMock.createTransport
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    const session = new OutboundSmtpSession(service({ port: "587", ssl: 1 }));
    await session.sendMail({
      from: "richard@aiagentlnc.com",
      to: "buyer@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(second.sendMail).toHaveBeenCalledOnce();
    expect(smtpMock.createTransport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        port: 587,
        secure: true,
        requireTLS: false,
      })
    );
  });

  it("does not open a second transport for SMTP 535", async () => {
    const authError = new Error(
      "Invalid login: 535 5.7.8 Error: authentication failed"
    );
    Object.assign(authError, { command: "AUTH", code: "EAUTH" });
    const first = fakeTransporter(vi.fn().mockRejectedValue(authError));
    smtpMock.createTransport.mockImplementation(() => first);

    const session = new OutboundSmtpSession(service({ port: "587", ssl: 1 }));
    await expect(
      session.sendMail({
        from: "richard@aiagentlnc.com",
        to: "buyer@example.com",
        subject: "Test",
        text: "Hello",
      })
    ).rejects.toThrow(/535/);

    expect(smtpMock.createTransport).toHaveBeenCalledTimes(1);
    expect(first.close).not.toHaveBeenCalled();
  });
});

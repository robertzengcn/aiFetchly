import { describe, expect, it } from "vitest";
import { emailReceiveConnectionTestInputSchema } from "@/schemas/ipc/emailReceive";
import {
  normalizeReceiveConnectionConfig,
  validateReceiveEndpointConfig,
} from "@/service/emailReceive/EmailReceiveSyncService";
import {
  buildImapFlowOptions,
  shouldRetryWithImplicitTls,
} from "@/service/emailReceive/ImapEmailReceiveClient";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";

function makeConfig(
  overrides: Partial<EmailReceiveConnectionConfig>
): EmailReceiveConnectionConfig {
  return {
    emailServiceId: 1,
    protocol: "pop3",
    host: "mail.example.com",
    port: 110,
    ssl: false,
    username: "user@example.com",
    password: "secret",
    folder: "INBOX",
    ...overrides,
  };
}

describe("normalizeReceiveConnectionConfig", () => {
  it("enables TLS for the standard POP3 implicit TLS port", () => {
    const config = makeConfig({ protocol: "pop3", port: 995, ssl: false });

    expect(normalizeReceiveConnectionConfig(config)).toEqual({
      ...config,
      ssl: true,
    });
  });

  it("enables TLS for the standard IMAP implicit TLS port", () => {
    const config = makeConfig({ protocol: "imap", port: 993, ssl: false });

    expect(normalizeReceiveConnectionConfig(config)).toEqual({
      ...config,
      ssl: true,
    });
  });

  it("preserves explicit non-TLS settings on non-implicit TLS ports", () => {
    const config = makeConfig({ protocol: "pop3", port: 110, ssl: false });

    expect(normalizeReceiveConnectionConfig(config)).toBe(config);
  });

  it("preserves explicit TLS settings on custom ports", () => {
    const config = makeConfig({ protocol: "pop3", port: 1995, ssl: true });

    expect(normalizeReceiveConnectionConfig(config)).toBe(config);
  });
});

describe("validateReceiveEndpointConfig", () => {
  it("rejects SMTP port 465 for IMAP receive", () => {
    const message = validateReceiveEndpointConfig(
      makeConfig({
        protocol: "imap",
        host: "imap.qiye.aliyun.com",
        port: 465,
        ssl: true,
      })
    );

    expect(message).toContain("Port 465 is for SMTP sending");
    expect(message).toContain("port 993");
  });

  it("rejects SMTP hosts for IMAP receive", () => {
    const message = validateReceiveEndpointConfig(
      makeConfig({
        protocol: "imap",
        host: "smtp.qiye.aliyun.com",
        port: 993,
        ssl: true,
      })
    );

    expect(message).toContain("SMTP host is configured for IMAP receive");
  });

  it("allows normal Aliyun IMAP SSL receive settings", () => {
    expect(
      validateReceiveEndpointConfig(
        makeConfig({
          protocol: "imap",
          host: "imap.qiye.aliyun.com",
          port: 993,
          ssl: true,
        })
      )
    ).toBeNull();
  });
});

describe("buildImapFlowOptions", () => {
  it("uses direct TLS for IMAP implicit TLS port", () => {
    const options = buildImapFlowOptions(
      makeConfig({ protocol: "imap", port: 993, ssl: true })
    );

    expect(options.secure).toBe(true);
    expect(options.doSTARTTLS).toBe(false);
  });

  it("uses STARTTLS for IMAP SSL on non-implicit TLS ports", () => {
    const options = buildImapFlowOptions(
      makeConfig({ protocol: "imap", port: 143, ssl: true })
    );

    expect(options.secure).toBe(false);
    expect(options.doSTARTTLS).toBe(true);
  });

  it("does not opportunistically upgrade when IMAP SSL is disabled", () => {
    const options = buildImapFlowOptions(
      makeConfig({ protocol: "imap", port: 143, ssl: false })
    );

    expect(options.secure).toBe(false);
    expect(options.doSTARTTLS).toBe(false);
  });

  it("can retry direct TLS for IMAP SSL on custom TLS ports", () => {
    const options = buildImapFlowOptions(
      makeConfig({ protocol: "imap", port: 1993, ssl: true }),
      "implicitTls"
    );

    expect(options.secure).toBe(true);
    expect(options.doSTARTTLS).toBe(false);
  });
});

describe("shouldRetryWithImplicitTls", () => {
  it("retries greeting timeouts for IMAP SSL on non-implicit TLS ports", () => {
    const err = new Error("Failed to receive greeting");
    Object.assign(err, { code: "GREETING_TIMEOUT" });

    expect(
      shouldRetryWithImplicitTls(
        err,
        makeConfig({ protocol: "imap", port: 1993, ssl: true })
      )
    ).toBe(true);
  });

  it("retries plaintext unexpected close before greeting for IMAP SSL on non-implicit TLS ports", () => {
    const err = new Error("Unexpected close");
    Object.assign(err, { code: "ClosedAfterConnectText" });

    expect(
      shouldRetryWithImplicitTls(
        err,
        makeConfig({ protocol: "imap", port: 1993, ssl: true })
      )
    ).toBe(true);
  });

  it("does not retry when SSL is disabled", () => {
    const err = new Error("Failed to receive greeting");
    Object.assign(err, { code: "GREETING_TIMEOUT" });

    expect(
      shouldRetryWithImplicitTls(
        err,
        makeConfig({ protocol: "imap", port: 143, ssl: false })
      )
    ).toBe(false);
  });

  it("does not retry unexpected close from an already secure connection", () => {
    const err = new Error("Unexpected close");
    Object.assign(err, { code: "ClosedAfterConnectTLS" });

    expect(
      shouldRetryWithImplicitTls(
        err,
        makeConfig({ protocol: "imap", port: 1993, ssl: true })
      )
    ).toBe(false);
  });

  it("does not retry unrelated connection errors", () => {
    expect(
      shouldRetryWithImplicitTls(
        new Error("Invalid credentials"),
        makeConfig({ protocol: "imap", port: 143, ssl: true })
      )
    ).toBe(false);
  });
});

describe("emailReceiveConnectionTestInputSchema", () => {
  const settings = {
    protocol: "pop3" as const,
    host: "mail.example.com",
    port: 995,
    ssl: true,
    username: "user@example.com",
    password: "secret",
    folder: "INBOX",
  };

  it("allows testing unsaved receive settings", () => {
    const parsed = emailReceiveConnectionTestInputSchema().safeParse({
      emailServiceId: 0,
      settings,
    });

    expect(parsed.success).toBe(true);
  });

  it("requires a saved email service id when direct settings are absent", () => {
    const parsed = emailReceiveConnectionTestInputSchema().safeParse({
      emailServiceId: 0,
    });

    expect(parsed.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveEmailServiceIdentity,
  containsEmailHeaderBreak,
} from "@/modules/lib/EmailServiceIdentityResolver";

describe("EmailServiceIdentityResolver", () => {
  it("configured SMTP username wins over From", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      smtpUsername: "mailbox@example.com",
    });
    expect(identity.smtpUsername).toBe("mailbox@example.com");
    expect(identity.fromAddress).toBe("sales@example.com");
  });

  it("blank/null SMTP username falls back to From", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      smtpUsername: "  ",
    });
    expect(identity.smtpUsername).toBe("sales@example.com");

    const identity2 = resolveEmailServiceIdentity({
      from: "sales@example.com",
      smtpUsername: null,
    });
    expect(identity2.smtpUsername).toBe("sales@example.com");
  });

  it("configured Reply-To is trimmed", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      replyTo: "  support@example.com  ",
    });
    expect(identity.replyToAddress).toBe("support@example.com");
  });

  it("blank Reply-To becomes null", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      replyTo: "   ",
    });
    expect(identity.replyToAddress).toBe(null);

    const identity2 = resolveEmailServiceIdentity({
      from: "sales@example.com",
    });
    expect(identity2.replyToAddress).toBe(null);
  });

  it("receive username follows explicit, SMTP, From order", () => {
    expect(
      resolveEmailServiceIdentity({ from: "sales@example.com" }).receiveUsername
    ).toBe("sales@example.com");

    expect(
      resolveEmailServiceIdentity({
        from: "sales@example.com",
        smtpUsername: "mailbox@example.com",
      }).receiveUsername
    ).toBe("mailbox@example.com");

    expect(
      resolveEmailServiceIdentity({
        from: "sales@example.com",
        smtpUsername: "mailbox@example.com",
        receiveUsername: "inbox@example.com",
      }).receiveUsername
    ).toBe("inbox@example.com");
  });

  it("SMTP username case is preserved", () => {
    const identity = resolveEmailServiceIdentity({
      from: "Sales@Example.com",
      smtpUsername: "MailBox@Example.com",
    });
    expect(identity.smtpUsername).toBe("MailBox@Example.com");
  });

  it("resolver does not mutate input", () => {
    const input = {
      from: "  sales@example.com  ",
      smtpUsername: "  mailbox@example.com  ",
      replyTo: "  support@example.com  ",
    };
    const snapshot = { ...input };
    resolveEmailServiceIdentity(input);
    expect(input).toEqual(snapshot);
  });

  it("containsEmailHeaderBreak flags CR and LF", () => {
    expect(containsEmailHeaderBreak("a\rb")).toBe(true);
    expect(containsEmailHeaderBreak("a\nb")).toBe(true);
    expect(containsEmailHeaderBreak("a\r\nb")).toBe(true);
    expect(containsEmailHeaderBreak("plain")).toBe(false);
    expect(containsEmailHeaderBreak("")).toBe(false);
  });

  it("containsEmailHeaderBreak flags Unicode line/paragraph separators", () => {
    expect(containsEmailHeaderBreak("a\u2028b")).toBe(true);
    expect(containsEmailHeaderBreak("a\u2029b")).toBe(true);
    // A clean multi-word string is still allowed.
    expect(containsEmailHeaderBreak("hello world")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AD-003 drift detection: the `smtpUsername ?? from` fallback rule MUST live
// in exactly one place \u2014 resolveEmailServiceIdentity. No delivery, binding, or
// IPC site may re-inline the fallback. This test scans the known offender
// files and fails if anyone reintroduces an inline `?? from` / `?? senderAddress`
// fallback for the SMTP username. (P2.2, technical design \u00a77.1/\u00a721.)
// ---------------------------------------------------------------------------
describe("EmailServiceIdentityResolver \u2014 single-source fallback (AD-003 drift guard)", () => {
  const offenderFiles = [
    "src/service/emailReply/EmailReplySendBinding.ts",
    "src/service/outboundEmail/OutboundEmailDeliveryService.ts",
    "src/service/outboundEmail/OutboundEmailWorkerStarter.ts",
    "src/childprocess/emailSend.ts",
    "src/main-process/communication/outboundEmailDelivery-ipc.ts",
  ];

  /**
   * Strip line comments (// ...) and block comments (/* ... *\u200b/) so that
   * explanatory comments mentioning the fallback rule do not count as
   * violations. Only real code is scanned.
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  }

  /**
   * Match an inline SMTP-username-to-From fallback: `x.smtpUsername ?? y.from`
   * or `x.smtpUsername ?? y.senderAddress`. The resolver call itself never uses
   * `??` on smtpUsername, so it is not a match. A bare `?? ""` (normalization
   * coalesce) is intentionally NOT matched — only the identity fallback rule.
   */
  const inlineFallback = /\.smtpUsername\s*\?\?\s*\w+\.(from|senderAddress)/;

  it("no offender file inlines `smtpUsername ?? from` outside the resolver", () => {
    for (const relPath of offenderFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      const source = fs.readFileSync(absPath, "utf8");
      const code = stripComments(source);
      expect(
        code,
        `${relPath} must not inline the smtpUsername fallback`
      ).not.toMatch(inlineFallback);
    }
  });

  it("every offender file imports resolveEmailServiceIdentity", () => {
    for (const relPath of offenderFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      const source = fs.readFileSync(absPath, "utf8");
      expect(
        source,
        `${relPath} must import resolveEmailServiceIdentity`
      ).toContain("resolveEmailServiceIdentity");
    }
  });
});

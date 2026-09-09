import { describe, expect, it } from "vitest";
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
      resolveEmailServiceIdentity({ from: "sales@example.com" })
        .receiveUsername
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
});

import { describe, expect, it } from "vitest";
import type { EmailMessage, ParsedMail } from "mailparser";
import { ImapEmailReceiveClient } from "@/service/emailReceive/ImapEmailReceiveClient";
import type { ParsedInboundEmail } from "@/service/emailReceive/EmailReceiveClient";
import { shouldPromoteReplyStatusFromProvider } from "@/model/EmailReceivedMessage.model";

interface ImapParserProbe {
  toParsedInboundEmail(
    uid: number,
    parsed: ParsedMail,
    msg: { flags?: Set<string> }
  ): ParsedInboundEmail | null;
}

function parsedMail(): ParsedMail {
  const from = {
    value: [{ address: "sender@example.com", name: "Sender" }] as EmailMessage[],
  };

  return {
    from,
    subject: "Hello",
    text: "Message body",
    html: false,
    date: new Date("2026-07-14T08:00:00.000Z"),
    messageId: "<message-1@example.com>",
    headers: new Map<string, unknown>(),
  } as ParsedMail;
}

describe("IMAP receive status flags", () => {
  it("maps Seen and Answered flags independently", () => {
    const client = new ImapEmailReceiveClient() as unknown as ImapParserProbe;

    const record = client.toParsedInboundEmail(42, parsedMail(), {
      flags: new Set(["\\Seen", "\\Answered"]),
    });

    expect(record).not.toBeNull();
    expect(record?.isUnread).toBe(false);
    expect(record?.isAnswered).toBe(true);
  });

  it("keeps unread messages unread when only Answered is present", () => {
    const client = new ImapEmailReceiveClient() as unknown as ImapParserProbe;

    const record = client.toParsedInboundEmail(43, parsedMail(), {
      flags: new Set(["\\Answered"]),
    });

    expect(record).not.toBeNull();
    expect(record?.isUnread).toBe(true);
    expect(record?.isAnswered).toBe(true);
  });
});

describe("provider reply status promotion", () => {
  it("promotes locally not-started messages when the provider reports answered", () => {
    expect(shouldPromoteReplyStatusFromProvider("sent", "not_started")).toBe(
      true
    );
  });

  it("does not demote or rewrite existing sent state", () => {
    expect(shouldPromoteReplyStatusFromProvider("not_started", "sent")).toBe(
      false
    );
    expect(shouldPromoteReplyStatusFromProvider("sent", "sent")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { EmailMessage, ParsedMail } from "mailparser";
import { ImapEmailReceiveClient } from "@/service/emailReceive/ImapEmailReceiveClient";
import type { ParsedInboundEmail } from "@/service/emailReceive/EmailReceiveClient";
import { buildNamespacedProviderUid } from "@/service/emailReceive/EmailReplyIdentity";

interface ImapParserProbe {
  toParsedInboundEmail(
    uid: number,
    parsed: ParsedMail,
    msg: { flags?: Set<string> },
    folder: string,
    uidValidity: string | null
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

    const record = client.toParsedInboundEmail(
      42,
      parsedMail(),
      { flags: new Set(["\\Seen", "\\Answered"]) },
      "INBOX",
      "424242"
    );

    expect(record).not.toBeNull();
    expect(record?.isUnread).toBe(false);
    expect(record?.isAnswered).toBe(true);
    // Namespaced providerUid + provenance (FR-030 §5.1).
    expect(record?.providerUid).toBe(
      buildNamespacedProviderUid({ folder: "INBOX", uidValidity: "424242", uid: 42 })
    );
    expect(record?.providerFolder).toBe("INBOX");
    expect(record?.providerUidValidity).toBe("424242");
  });

  it("keeps unread messages unread when only Answered is present", () => {
    const client = new ImapEmailReceiveClient() as unknown as ImapParserProbe;

    const record = client.toParsedInboundEmail(
      43,
      parsedMail(),
      { flags: new Set(["\\Answered"]) },
      "INBOX",
      "424242"
    );

    expect(record).not.toBeNull();
    expect(record?.isUnread).toBe(true);
    expect(record?.isAnswered).toBe(true);
  });

  it("falls back to the bare legacy uid when UIDVALIDITY is unobservable", () => {
    const client = new ImapEmailReceiveClient() as unknown as ImapParserProbe;

    const record = client.toParsedInboundEmail(
      44,
      parsedMail(),
      { flags: new Set(["\\Seen"]) },
      "INBOX",
      null
    );

    expect(record).not.toBeNull();
    expect(record?.providerUid).toBe("44");
    expect(record?.providerFolder).toBe("INBOX");
    expect(record?.providerUidValidity).toBeNull();
  });
});


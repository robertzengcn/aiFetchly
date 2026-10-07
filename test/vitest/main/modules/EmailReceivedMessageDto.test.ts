import { describe, it, expect, vi } from "vitest";

// The DTO mappers live in the full emailReceive-ipc module, which imports
// registerValidatedHandler (electron ipcMain) and Logger at module top level.
// Mock both BEFORE the import, per the EmailReplyIpcStructuredFailure pattern.
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));
vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import type { FetchQueryObject } from "imapflow";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import {
  toMessageListDto,
  toMessageDetailDto,
} from "@/main-process/communication/emailReceive-ipc";
import {
  ImapEmailReceiveClient,
  type ImapFlowConnection,
} from "@/service/emailReceive/ImapEmailReceiveClient";

/**
 * T03/FR-030 Step 4 — renderer DTO contract. The list/detail DTOs must carry
 * the new evidence fields (safe observation subset in the list; the full
 * diagnostic set in the detail), and must never leak secrets, raw provider
 * errors, or bodies into the LIST view (the detail DTO intentionally carries
 * sanitized bodies for the detail page).
 */
describe("ReceivedMessage DTO evidence contract (T03)", () => {
  function entityFixture(): EmailReceivedMessageEntity {
    const e = new EmailReceivedMessageEntity();
    e.id = 7;
    e.emailServiceId = 3;
    e.providerUid = "imap:abc:424242:77";
    e.messageId = "<m-77@example.com>";
    e.fromAddress = "prospect@example.com";
    e.fromName = "Prospect";
    e.subject = "Pricing?";
    e.snippet = "How much";
    e.receivedAt = new Date("2026-10-05T10:00:00Z");
    e.isUnread = 1;
    e.classification = "interested";
    e.classificationConfidence = 0.9;
    e.replyStatus = "draft_created";
    e.processedAt = new Date("2026-10-05T12:00:00Z");
    e.isAnswered = 1;
    e.answeredFlagCheckedAt = new Date("2026-10-05T11:00:00Z");
    e.replyDetectedAt = new Date("2026-10-05T11:30:00Z");
    e.replyDetectionSource = "sent_search";
    e.replyMatchedMessageId = "<sent-1@example.com>";
    e.replyNegativeCheckAt = null;
    e.replyNegativeContextHash = "hash-abc";
    e.providerFolder = "INBOX";
    e.providerUidValidity = "424242";
    e.bodyText = "full body";
    e.bodyHtmlSanitized = "<p>full body</p>";
    e.toAddressesJson = '["me@x.com"]';
    e.ccAddressesJson = null;
    return e;
  }

  it("list DTO carries the safe observation evidence subset", () => {
    const dto = toMessageListDto(entityFixture());
    expect(dto.isAnswered).toBe(true);
    expect(dto.answeredFlagCheckedAt).toBe("2026-10-05T11:00:00.000Z");
    expect(dto.replyDetectedAt).toBe("2026-10-05T11:30:00.000Z");
    expect(dto.replyStatus).toBe("draft_created");
    expect(dto.isUnread).toBe(true);
  });

  it("list DTO key set is exactly the renderer-safe contract (no bodies, no diagnostics, no secrets)", () => {
    const dto = toMessageListDto(entityFixture());
    // Exact-set assertion: any future accidental addition (password echo,
    // raw provider error, matched message id, context hash, body) fails here.
    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "emailServiceId",
        "fromAddress",
        "fromName",
        "subject",
        "snippet",
        "receivedAt",
        "isUnread",
        "classification",
        "classificationConfidence",
        "replyStatus",
        "processedAt",
        "isAnswered",
        "answeredFlagCheckedAt",
        "replyDetectedAt",
      ].sort()
    );
  });

  it("detail DTO carries the full diagnostic evidence set", () => {
    const dto = toMessageDetailDto(entityFixture());
    expect(dto.replyDetectionSource).toBe("sent_search");
    expect(dto.replyMatchedMessageId).toBe("<sent-1@example.com>");
    expect(dto.replyNegativeCheckAt).toBe("");
    expect(dto.providerFolder).toBe("INBOX");
    expect(dto.providerUidValidity).toBe("424242");
    // Detail intentionally includes the sanitized body for the detail page.
    expect(dto.bodyText).toBe("full body");
    expect(dto.bodyHtmlSanitized).toBe("<p>full body</p>");
  });

  it("detail DTO key set never includes secrets or provider credentials", () => {
    const dto = toMessageDetailDto(entityFixture());
    const keys = Object.keys(dto);
    // Credentials/secret-shaped fields must have no place in the contract.
    for (const forbidden of ["password", "receivePassword", "rawError", "error"]) {
      expect(keys).not.toContain(forbidden);
    }
    // The serialized payload carries no secret-shaped values.
    expect(JSON.stringify(dto)).not.toContain("password");
  });
});

/**
 * UID-scoped flag refresh (FR-031 §7.1 step 5) — the refreshMessageFlags
 * contract, exercised through the imapFlowFactory seam against a behavioral
 * fake. Proves the UIDVALIDITY guard, the expunged-UID null, and that only
 * flags are requested (never source/bodies; the ImapFlowConnection interface
 * exposes no flag-write methods at all).
 */
describe("ImapEmailReceiveClient.refreshMessageFlags (T03 step 4)", () => {
  /** Behavioral fake recording every fetchOne query it receives. */
  function fakeImapConnection(input: {
    uidValidity: string;
    flagsByUid: Record<number, Set<string>> | null;
  }): ImapFlowConnection & { fetchOneQueries: FetchQueryObject[] } {
    const fetchOneQueries: FetchQueryObject[] = [];
    const connection: ImapFlowConnection = {
      async connect(): Promise<void> {},
      async logout(): Promise<void> {},
      close(): void {},
      async mailboxOpen(folder: string | string[]) {
        return {
          path: typeof folder === "string" ? folder : folder[0],
          delimiter: "/",
          flags: new Set<string>(),
          uidValidity: BigInt(input.uidValidity),
          uidNext: 1,
          exists: 0,
        };
      },
      async search(): Promise<number[] | false> {
        return [];
      },
      async fetchOne(seq, query) {
        fetchOneQueries.push(query);
        const flags = input.flagsByUid?.[Number(seq)];
        if (!flags) return false;
        return { seq: Number(seq), uid: Number(seq), flags };
      },
    };
    return { ...connection, fetchOneQueries };
  }

  function config(): EmailReceiveConnectionConfig {
    return {
      emailServiceId: 1,
      protocol: "imap",
      host: "imap.example.com",
      port: 993,
      ssl: true,
      username: "me@x.com",
      password: "recv-secret",
      folder: "INBOX",
    };
  }

  it("returns normalized flags for an existing UID with matching uidValidity", async () => {
    const fake = fakeImapConnection({
      uidValidity: "424242",
      flagsByUid: { 77: new Set(["\\Seen", "\\Answered", "\\Flagged"]) },
    });
    const client = new ImapEmailReceiveClient({
      imapFlowFactory: () => fake,
    });

    const refreshed = await client.refreshMessageFlags({
      config: config(),
      folder: "INBOX",
      uidValidity: "424242",
      uid: "77",
    });

    expect(refreshed).not.toBeNull();
    expect(refreshed?.uid).toBe("77");
    expect(refreshed?.isAnswered).toBe(true);
    expect(refreshed?.isSeen).toBe(true);
    expect(refreshed?.flags).toEqual(["\\seen", "\\answered", "\\flagged"]);
    expect(refreshed?.checkedAt).toBeInstanceOf(Date);

    // Flags only — PEEK semantics: the fetch query requests nothing beyond
    // flags/internalDate (no source, no envelope, no bodies, no headers).
    expect(fake.fetchOneQueries.length).toBe(1);
    const query = fake.fetchOneQueries[0];
    expect(Object.keys(query).sort()).toEqual(["flags", "internalDate"]);
  });

  it("returns null for an expunged/moved UID (a legitimate observation, not an error)", async () => {
    const fake = fakeImapConnection({
      uidValidity: "424242",
      flagsByUid: null,
    });
    const client = new ImapEmailReceiveClient({
      imapFlowFactory: () => fake,
    });

    const refreshed = await client.refreshMessageFlags({
      config: config(),
      folder: "INBOX",
      uidValidity: "424242",
      uid: "999",
    });
    expect(refreshed).toBeNull();
  });

  it("returns null without fetching when the folder UIDVALIDITY changed since sync stored it", async () => {
    // Server now reports validity 999999, sync stored 424242 → the UID
    // namespace was reset; trusting the bare UID would observe the WRONG
    // message's flags. The guard must fire BEFORE any fetch.
    const fake = fakeImapConnection({
      uidValidity: "999999",
      flagsByUid: { 77: new Set(["\\Answered"]) },
    });
    const client = new ImapEmailReceiveClient({
      imapFlowFactory: () => fake,
    });

    const refreshed = await client.refreshMessageFlags({
      config: config(),
      folder: "INBOX",
      uidValidity: "424242",
      uid: "77",
    });
    expect(refreshed).toBeNull();
    expect(fake.fetchOneQueries.length).toBe(0);
  });
});

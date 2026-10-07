import { describe, it, expect } from "vitest";
import type {
  FetchQueryObject,
  ListResponse,
  SearchObject,
} from "imapflow";

import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import {
  parseHeaderBlock,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  ImapEmailReceiveClient,
  type ImapFlowConnection,
} from "@/service/emailReceive/ImapEmailReceiveClient";

/**
 * T04/FR-031 Step 5 — Sent-folder discovery + reply-header search, exercised
 * through the imapFlowFactory seam against a behavioral fake.
 *
 * Proves: `\Sent` special-use wins; exactly-one name fallback; ambiguity or
 * absence → [] (never a silent negative); auth/list failures PROPAGATE (map
 * to unknown upstream, not to folder absence); `false` search return is
 * forwarded as false (not no-matches); header fetches are header-only with
 * PEEK semantics; caps bound the fetch count.
 */

/** Behavioral fake recording every call and query it receives. */
function fakeImapConnection(input: {
  folders?: ListResponse[];
  listThrows?: Error;
  searchResults?: (query: SearchObject) => number[] | false;
  searchThrows?: Error;
  headersByUid?: Record<number, Buffer>;
}): ImapFlowConnection & {
  readonly calls: {
    fetchOneQueries: Array<{ query: FetchQueryObject; uidOption?: boolean }>;
    searchQueries: SearchObject[];
    logouts: number;
  };
} {
  const calls = {
    fetchOneQueries: [] as Array<{ query: FetchQueryObject; uidOption?: boolean }>,
    searchQueries: [] as SearchObject[],
    logouts: 0,
  };
  const connection: ImapFlowConnection = {
    async connect(): Promise<void> {},
    async logout(): Promise<void> {
      calls.logouts++;
    },
    close(): void {},
    async list(): Promise<ListResponse[]> {
      if (input.listThrows) throw input.listThrows;
      return input.folders ?? [];
    },
    async mailboxOpen(): Promise<never> {
      throw new Error("not used by these probes");
    },
    async search(query): Promise<number[] | false> {
      calls.searchQueries.push(query);
      if (input.searchThrows) throw input.searchThrows;
      if (!input.searchResults) return [];
      return input.searchResults(query);
    },
    async fetchOne(seq, query, options) {
      calls.fetchOneQueries.push({
        query,
        uidOption: options?.uid === true,
      });
      const headers = input.headersByUid?.[Number(seq)];
      if (!headers) return false;
      return { seq: Number(seq), uid: Number(seq), headers };
    },
  };
  return { ...connection, calls };
}

function listFolder(path: string, specialUse?: string): ListResponse {
  return {
    path,
    pathAsListed: path,
    name: path.split("/").pop() ?? path,
    delimiter: "/",
    parent: [],
    parentPath: "",
    flags: new Set<string>(),
    listed: true,
    subscribed: true,
    ...(specialUse ? { specialUse } : {}),
  };
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

const ORIGINAL_ID = "<orig-77@example.com>";

describe("discoverSentFolders (T04 step 5)", () => {
  it("returns server-advertised \\Sent special-use folders as verified", async () => {
    const fake = fakeImapConnection({
      folders: [
        listFolder("INBOX", "\\Inbox"),
        listFolder("[Gmail]/Sent Mail", "\\Sent"),
        listFolder("Sent", "\\Sent"),
        listFolder("Sent", undefined), // a plain folder named Sent must not duplicate
      ],
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const folders = await client.discoverSentFolders(config());

    expect(folders).toEqual([
      { folder: "[Gmail]/Sent Mail", verified: true },
      { folder: "Sent", verified: true },
    ]);
    expect(fake.calls.logouts).toBe(1);
  });

  it("accepts exactly one conventional-name fallback as unverified", async () => {
    const fake = fakeImapConnection({
      folders: [
        listFolder("INBOX"),
        listFolder("Sent Items"), // case-insensitive fallback match
      ],
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const folders = await client.discoverSentFolders(config());
    expect(folders).toEqual([{ folder: "Sent Items", verified: false }]);
  });

  it("returns [] when multiple unverified fallback names exist (ambiguous)", async () => {
    const fake = fakeImapConnection({
      folders: [listFolder("Sent"), listFolder("INBOX/Sent")],
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const folders = await client.discoverSentFolders(config());
    expect(folders).toEqual([]);
  });

  it("returns [] when no Sent-shaped folder is accessible", async () => {
    const fake = fakeImapConnection({
      folders: [listFolder("INBOX"), listFolder("Drafts")],
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const folders = await client.discoverSentFolders(config());
    expect(folders).toEqual([]);
  });

  it("propagates auth/connection failures — never masks them as absence", async () => {
    const fake = fakeImapConnection({
      listThrows: new Error("AUTHENTICATIONFAILED"),
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    await expect(client.discoverSentFolders(config())).rejects.toThrow(
      "AUTHENTICATIONFAILED"
    );
    // Connection still closed in the finally path.
    expect(fake.calls.logouts).toBe(1);
  });
});

describe("searchReplyHeaders (T04 step 5)", () => {
  function replyHeaderBlock(): Buffer {
    // Folded References continuation line must be unfolded per RFC 5322.
    return Buffer.from(
      [
        "Message-ID: <reply-1@example.com>",
        `In-Reply-To: ${ORIGINAL_ID}`,
        `References: ${ORIGINAL_ID}`,
        "\t<older-ancestor@example.com>",
        "From: Me <me@example.com>",
        "To: prospect@example.com",
        "Date: Mon, 5 Oct 2026 11:00:00 +0000",
        "not-a-header-line-without-colon",
        "",
      ].join("\r\n"),
      "utf8"
    );
  }

  it("searches both threading headers and parses candidate header blocks", async () => {
    const fake = fakeImapConnection({
      searchResults: () => [501, 502],
      headersByUid: {
        501: replyHeaderBlock(),
        502: Buffer.from("Message-ID: <reply-2@example.com>\r\n", "utf8"),
      },
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const result = await client.searchReplyHeaders({
      config: config(),
      folder: "Sent",
      originalMessageId: ORIGINAL_ID,
      cap: 10,
    });

    expect(result).not.toBe(false);
    expect(result).toHaveLength(2);

    const first = result?.[0];
    expect(first?.folder).toBe("Sent");
    expect(first?.uid).toBe(501);
    expect(first?.messageId).toBe("<reply-1@example.com>");
    expect(first?.inReplyTo).toBe(ORIGINAL_ID);
    // Folded References line unfolded into a single space-joined value.
    expect(first?.references).toBe(
      `${ORIGINAL_ID} <older-ancestor@example.com>`
    );
    expect(first?.from).toBe("Me <me@example.com>");
    expect(first?.to).toBe("prospect@example.com");
    expect(first?.date).toBe("Mon, 5 Oct 2026 11:00:00 +0000");

    // The search covers BOTH In-Reply-To and References via `or`.
    expect(fake.calls.searchQueries).toHaveLength(1);
    const query = fake.calls.searchQueries[0];
    expect(query.or).toEqual([
      { header: { "in-reply-to": ORIGINAL_ID } },
      { header: { references: ORIGINAL_ID } },
    ]);
    // PEEK: every candidate fetch is header-only — no source/envelope/body,
    // and addressed by UID.
    for (const fetch of fake.calls.fetchOneQueries) {
      expect(Object.keys(fetch.query).sort()).toEqual(["headers"]);
      expect(fetch.uidOption).toBe(true);
    }
  });

  it("forwards a failed/incomplete search as false — never as no-matches", async () => {
    const fake = fakeImapConnection({ searchResults: () => false });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const result = await client.searchReplyHeaders({
      config: config(),
      folder: "Sent",
      originalMessageId: ORIGINAL_ID,
      cap: 10,
    });
    expect(result).toBe(false);
    // No candidate fetches were attempted after the failed search.
    expect(fake.calls.fetchOneQueries).toHaveLength(0);
  });

  it("bounds candidate header fetches to the cap", async () => {
    const fake = fakeImapConnection({
      searchResults: () => [1, 2, 3, 4, 5],
      headersByUid: {
        1: replyHeaderBlock(),
        2: replyHeaderBlock(),
        3: replyHeaderBlock(),
        4: replyHeaderBlock(),
        5: replyHeaderBlock(),
      },
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const result = await client.searchReplyHeaders({
      config: config(),
      folder: "Sent",
      originalMessageId: ORIGINAL_ID,
      cap: 3,
    });
    expect(result).not.toBe(false);
    expect(result).toHaveLength(3);
    expect(fake.calls.fetchOneQueries).toHaveLength(3);
  });

  it("skips candidates whose header fetch returns nothing", async () => {
    const fake = fakeImapConnection({
      searchResults: () => [1, 2],
      headersByUid: { 2: replyHeaderBlock() }, // UID 1 expunged mid-probe
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    const result = await client.searchReplyHeaders({
      config: config(),
      folder: "Sent",
      originalMessageId: ORIGINAL_ID,
      cap: 10,
    });
    expect(result).not.toBe(false);
    expect(result).toHaveLength(1);
    expect(result?.[0].uid).toBe(2);
  });

  it("propagates search failures (auth/permission) instead of returning false/[]", async () => {
    const fake = fakeImapConnection({
      searchThrows: new Error("ACL: no search permission"),
    });
    const client = new ImapEmailReceiveClient({ imapFlowFactory: () => fake });

    await expect(
      client.searchReplyHeaders({
        config: config(),
        folder: "Sent",
        originalMessageId: ORIGINAL_ID,
        cap: 10,
      })
    ).rejects.toThrow("ACL");
    expect(fake.calls.logouts).toBe(1);
  });
});

describe("parseHeaderBlock (T04 step 5)", () => {
  it("lowercases keys, trims values, and returns an empty map for null", () => {
    expect(parseHeaderBlock(null).size).toBe(0);
    expect(parseHeaderBlock(undefined).size).toBe(0);

    const map = parseHeaderBlock(
      Buffer.from("Message-ID:  <x@y.z> \r\nSubject: hi\r\n", "utf8")
    );
    expect(map.get("message-id")).toBe("<x@y.z>");
    expect(map.get("subject")).toBe("hi");
  });

  it("unfolds continuation lines with whitespace joins and skips malformed lines", () => {
    const map = parseHeaderBlock(
      "References: <a@b.c>\r\n\t<d@e.f>\r\n\r\nbroken-line-no-colon\r\n: empty-key\r\n"
    );
    expect(map.get("references")).toBe("<a@b.c> <d@e.f>");
    expect(map.size).toBe(1);
  });
});

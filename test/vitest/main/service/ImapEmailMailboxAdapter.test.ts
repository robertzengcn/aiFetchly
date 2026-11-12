import { describe, it, expect } from "vitest";
import { ImapEmailMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import type {
  MailboxActionConnection,
} from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";

const config: EmailReceiveConnectionConfig = {
  emailServiceId: 1,
  protocol: "imap",
  host: "imap.example.test",
  port: 993,
  ssl: true,
  username: "user@example.test",
  password: "secret-do-not-log",
  folder: "INBOX",
};

interface FakeMailbox {
  uidValidity: string;
  messages: Map<number, Buffer>;
}

interface FakeServerState {
  moveCapability: boolean;
  mailboxes: Map<string, FakeMailbox>;
  /** When set, messageMove rejects with this error (post-dispatch fault). */
  moveError?: Error;
  /** When false, the move result carries no uidMap (no COPYUID from server). */
  reportUidMap?: boolean;
}

class FakeConnection implements MailboxActionConnection {
  capabilities: Set<string>;
  public readonly calls: Array<{ kind: string; args: unknown[] }> = [];
  private currentMailbox: FakeMailbox | null = null;
  constructor(private readonly state: FakeServerState) {
    this.capabilities = new Set(
      state.moveCapability ? ["IMAP4rev1", "MOVE"] : ["IMAP4rev1"]
    );
  }
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  close(): void {}
  async list() {
    this.calls.push({ kind: "list", args: [] });
    return [
      { path: "INBOX", name: "INBOX" },
      { path: "Trash", name: "Trash", specialUse: "\\Trash" },
      { path: "Sent", name: "Sent", specialUse: "\\Sent" },
    ];
  }
  async search(query: Record<string, unknown>, options?: { uid?: boolean }) {
    this.calls.push({ kind: "search", args: [query, options] });
    return [];
  }
  async append(
    folder: string,
    message: Buffer | string,
    options?: { flags?: string[] }
  ) {
    this.calls.push({ kind: "append", args: [folder] });
    return { uid: 99 };
  }
  async mailboxOpen(path: string) {
    this.calls.push({ kind: "mailboxOpen", args: [path] });
    const mailbox = this.state.mailboxes.get(path);
    if (!mailbox) throw new Error("Mailbox does not exist");
    this.currentMailbox = mailbox;
    return { uidValidity: BigInt(mailbox.uidValidity) };
  }
  async fetchOne(seq: string | number, query: Record<string, unknown>, options?: { uid?: boolean }) {
    this.calls.push({ kind: "fetchOne", args: [seq, query, options] });
    const mailbox = this.currentMailbox;
    if (!mailbox) return false;
    const uid = Number(seq);
    if (!mailbox.messages.has(uid)) return false;
    return {
      flags: new Set<string>(),
      source: mailbox.messages.get(uid),
      uid,
      query,
      options,
    };
  }
  async messageMove(range: string | number, destination: string, options?: { uid?: boolean }) {
    this.calls.push({ kind: "messageMove", args: [range, destination, options] });
    if (this.state.moveError) throw this.state.moveError;
    const mailbox = this.currentMailbox;
    if (!mailbox) return false;
    const uid = Number(range);
    if (!mailbox.messages.has(uid)) return false;
    const destinationMailbox = this.state.mailboxes.get(destination);
    if (!destinationMailbox) return false;
    const nextUid = destinationMailbox.messages.size + 1;
    const bytes = mailbox.messages.get(uid) as Buffer;
    mailbox.messages.delete(uid);
    destinationMailbox.messages.set(nextUid, bytes);
    return {
      path: "INBOX",
      destination,
      uidValidity: BigInt(destinationMailbox.uidValidity),
      uidMap: this.state.reportUidMap === false ? undefined : new Map([[uid, nextUid]]),
    };
  }
}

function buildAdapter(state: FakeServerState): ImapEmailMailboxAdapter {
  return new ImapEmailMailboxAdapter({
    connectionFactory: () => new FakeConnection(state),
  });
}

function makeState(overrides?: Partial<FakeServerState>): FakeServerState {
  const inbox: FakeMailbox = { uidValidity: "4242", messages: new Map() };
  inbox.messages.set(7, Buffer.from("From: a@b.test\r\nSubject: hi\r\n\r\nbody"));
  const trash: FakeMailbox = { uidValidity: "99", messages: new Map() };
  return {
    moveCapability: true,
    mailboxes: new Map([
      ["INBOX", inbox],
      ["Trash", trash],
    ]),
    ...overrides,
  };
}

const location = { folderPath: "INBOX", uidValidity: "4242", uid: "7" };

describe("ImapEmailMailboxAdapter (fake connection)", () => {
  it("refuses a move when the server lacks MOVE capability (no COPY+EXPUNGE fallback)", async () => {
    const adapter = buildAdapter(makeState({ moveCapability: false }));
    const result = await adapter.moveMessage(config, location, "Trash");
    expect(result.status).toBe("no_move_capability");
  });

  it("moves a message natively and reports the destination mapping", async () => {
    const adapter = buildAdapter(makeState());
    const result = await adapter.moveMessage(config, location, "Trash");
    expect(result.status).toBe("moved");
    if (result.status === "moved") {
      expect(result.destinationUidValidity).toBe("99");
      expect(result.destinationUid).toBe("1");
    }
  });

  it("rejects the move when UIDVALIDITY changed", async () => {
    const adapter = buildAdapter(makeState());
    const result = await adapter.moveMessage(
      config,
      { ...location, uidValidity: "1" },
      "Trash"
    );
    expect(result.status).toBe("uid_validity_changed");
  });

  it("reports a missing source without issuing any move", async () => {
    const adapter = buildAdapter(makeState());
    const result = await adapter.moveMessage(
      config,
      { ...location, uid: "999" },
      "Trash"
    );
    expect(result.status).toBe("source_missing");
  });

  it("maps a post-dispatch transport error to OUTCOME_UNKNOWN (no blind retry)", async () => {
    const adapter = buildAdapter(
      makeState({ moveError: new Error("connection reset by peer") })
    );
    const result = await adapter.moveMessage(config, location, "Trash");
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reasonCode).toBe("OUTCOME_UNKNOWN");
    }
  });

  it("reports an unresolved destination when the server gives no uidMap", async () => {
    const adapter = buildAdapter(makeState({ reportUidMap: false }));
    const result = await adapter.moveMessage(config, location, "Trash");
    expect(result.status).toBe("moved");
    if (result.status === "moved") {
      expect(result.destinationUid).toBeNull();
    }
  });

  it("fetches full source with a PEEK query that cannot set \\Seen", async () => {
    const state = makeState();
    const connectionRef: { value: FakeConnection | null } = { value: null };
    const adapter = new ImapEmailMailboxAdapter({
      connectionFactory: () => {
        connectionRef.value = new FakeConnection(state);
        return connectionRef.value;
      },
    });
    const result = await adapter.fetchFullSource(config, location);
    expect(result.status).toBe("fetched");
    const fetchCalls = (connectionRef.value as FakeConnection).calls.filter(
      (call) => call.kind === "fetchOne"
    );
    expect(fetchCalls.length).toBe(1);
    const [seq, query, options] = fetchCalls[0].args as [
      string,
      Record<string, unknown>,
      { uid?: boolean }
    ];
    expect(seq).toBe("7");
    expect(query["source"]).toBe(true);
    expect(options?.uid).toBe(true);
  });

  it("rejects a source fetch when UIDVALIDITY changed", async () => {
    const adapter = buildAdapter(makeState());
    const result = await adapter.fetchFullSource(config, {
      ...location,
      uidValidity: "1",
    });
    expect(result.status).toBe("uid_validity_changed");
  });

  it("verifies presence with the current UIDVALIDITY", async () => {
    const adapter = buildAdapter(makeState());
    const present = await adapter.checkMessagePresent(config, location);
    expect(present.status).toBe("present");
    const absent = await adapter.checkMessagePresent(config, { ...location, uid: "404" });
    expect(absent.status).toBe("absent");
  });

  it("searchUids maps the query and extracts envelope metadata (FR-17 server)", async () => {
    const state = makeState();
    const holder: { value: FakeConnection | null } = { value: null };
    const adapter = new ImapEmailMailboxAdapter({
      connectionFactory: () => {
        const fake = new FakeConnection(state);
        fake.search = (async (query) => {
          fake.calls.push({ kind: "search", args: [query] });
          return [11, 12, 13];
        }) as FakeConnection["search"];
        fake.fetchOne = (async (seq: string | number) => ({
          flags: new Set<string>(["\\seen"]),
          envelope: {
            from: [{ address: "a@b.test" }],
            subject: `subject ${String(seq)}`,
            date: new Date("2026-09-15T10:00:00Z"),
          },
        })) as unknown as FakeConnection["fetchOne"];
        holder.value = fake;
        return fake;
      },
    });
    const connection = holder;
    const result = await adapter.searchUids(config, "INBOX", {
      fromAddress: "a@b.test",
      subject: "September",
      since: new Date("2026-09-01T00:00:00Z"),
      before: new Date("2026-10-01T00:00:00Z"),
      unreadOnly: false,
      cap: 1000,
      metadataLimit: 2,
    });
    expect(result.status).toBe("listed");
    if (result.status !== "listed") return;
    // Envelope fetches are bounded to metadataLimit, not the cap.
    expect(result.candidates.length).toBe(2);
    expect(result.capped).toBe(false);
    expect(result.candidates[0].fromAddress).toBe("a@b.test");
    expect(result.candidates[0].seen).toBe(true);
    const searchCall = (connection.value as FakeConnection).calls.find(
      (c) => c.kind === "search"
    );
    const query = searchCall?.args[0] as Record<string, unknown>;
    expect(query["since"]).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(query["before"]).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(query["subject"]).toBe("September");
    expect(query["from"]).toBe("a@b.test");
  });

  it("searchUids reports capped only when the window was cut before the SEARCH end (R7-02)", async () => {
    const state = makeState();
    const adapter = new ImapEmailMailboxAdapter({
      connectionFactory: () => {
        const fake = new FakeConnection(state);
        fake.search = (async () => [1, 2, 3]) as unknown as FakeConnection["search"];
        return fake;
      },
    });
    const connection = { value: null };
    // A window that reaches the END of the match list is NOT capped — even
    // at exactly the window size (R7-02: window size never lied about a
    // ceiling).
    const exhausted = await adapter.searchUids(config, "INBOX", {
      cap: 3,
      metadataLimit: 0,
    });
    expect(exhausted.status).toBe("listed");
    if (exhausted.status !== "listed") return;
    expect(exhausted.capped).toBe(false);
    // A window cut before the end IS capped.
    const cut = await adapter.searchUids(config, "INBOX", {
      cap: 2,
      metadataLimit: 0,
    });
    expect(cut.status).toBe("listed");
    if (cut.status !== "listed") return;
    expect(cut.capped).toBe(true);
    expect(cut.candidates.length).toBe(0);
  });

  it("searchUids reports PROVIDER_REJECTED when the server cannot search", async () => {
    const state = makeState();
    const adapter = new ImapEmailMailboxAdapter({
      connectionFactory: () => {
        const fake = new FakeConnection(state);
        fake.search = (async () => false) as unknown as FakeConnection["search"];
        return fake;
      },
    });
    const connection = { value: null };
    const result = await adapter.searchUids(config, "INBOX", { cap: 10 });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.reasonCode).toBe("PROVIDER_REJECTED");
  });

  it("probes capabilities and special-use folders in one connection", async () => {
    const adapter = buildAdapter(makeState());
    const probe = await adapter.probeCapabilities(config);
    expect(probe.moveCapability).toBe(true);
    const trash = probe.folders.find((folder) => folder.specialUse === "\\Trash");
    expect(trash?.path).toBe("Trash");
  });

  it("reports missing move capability through the probe", async () => {
    const adapter = buildAdapter(makeState({ moveCapability: false }));
    const probe = await adapter.probeCapabilities(config);
    expect(probe.moveCapability).toBe(false);
  });
});

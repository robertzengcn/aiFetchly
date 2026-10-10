/**
 * T04 step 9 (FR-031 §7.2/§12) — behavioral fake implementing the imapflow
 * subset the {@link ImapEmailReceiveClient} probes (`mailboxOpen`, `list`,
 * `search`, `fetchOne`, `logout`, `close`). Backed by an in-memory mailbox
 * fixture so the §12 adversarial matrix can exercise the FULL chain from
 * {@link EmailReplyDetectionService.detect} → `searchReplyHeaders` /
 * `refreshMessageFlags` → imapflow calls, proving the header-map search,
 * PEEK semantics, UIDVALIDITY guard, and candidate caps work against a
 * realistic protocol surface — NOT a mock that bypasses the client code.
 *
 * This is a BEHAVIORAL FAKE, not a `vi.fn` mock: it implements the
 * {@link ImapFlowConnection} contract exactly as the real imapflow would,
 * so the production client code path runs unchanged. Configurable per-test:
 * folder list + special-use, per-UID flags + header blocks, search return
 * shape (`number[]` vs `false`), auth/permission throws, latency, and a
 * `uidValidity` per folder (the §5.1 UIDVALIDITY guard).
 */
import type {
  FetchMessageObject,
  FetchQueryObject,
  ListResponse,
  MailboxObject,
  SearchObject,
} from "imapflow";
import type { ImapFlowConnection } from "@/service/emailReceive/ImapEmailReceiveClient";

/** One in-memory message: its UID, flags, and a raw header block. */
export interface FakeMailboxMessage {
  readonly uid: number;
  readonly flags: Set<string>;
  /** Raw header block as imapflow would return it (Buffer). */
  readonly headers: Buffer;
}

/** One in-memory folder with its own UIDVALIDITY and messages. */
export interface FakeMailboxFolder {
  readonly path: string;
  readonly specialUse?: string;
  readonly uidValidity: bigint;
  readonly messages: FakeMailboxMessage[];
}

/** Per-folder search behavior overrides for one probe. */
export interface FakeSearchBehavior {
  /**
   * Return a fixed set of UIDs, `false` (failed/incomplete search), or omit
   * to fall through to the default substring-search over the fixture.
   */
  readonly result?: number[] | false;
  /** Throw on search (auth/permission failure). */
  readonly throws?: Error;
  /** Delay ms before resolving (deadline tests). */
  readonly delayMs?: number;
}

/** A complete in-memory mailbox fixture + per-call behavior overrides. */
export interface FakeImapFlowFixture {
  readonly folders: FakeMailboxFolder[];
  /** Per-folder search overrides; absent folders fall through to substring. */
  readonly searchOverrides?: Map<string, FakeSearchBehavior>;
  /** Throw on `connect()` (auth/connection failure). */
  readonly connectThrows?: Error;
  /** Throw on `list()` (auth/permission failure during folder discovery). */
  readonly listThrows?: Error;
  /** Delay ms for every `fetchOne` (slow fake for deadline tests). */
  readonly fetchDelayMs?: number;
  /**
   * Path of a folder whose `mailboxOpen` hangs forever (never resolves) — for
   * deadline-abort tests. The probe's abort listener must call `close()` to
   * tear down the in-flight socket; the test asserts `close` was recorded.
   */
  readonly hangOnMailboxOpen?: string;
}

/** Recorded call for assertion in tests. */
export interface FakeImapFlowCall {
  readonly method:
    | "connect"
    | "logout"
    | "list"
    | "mailboxOpen"
    | "search"
    | "fetchOne";
  readonly args: ReadonlyArray<unknown>;
}

/**
 * Build a behavioral fake satisfying {@link ImapFlowConnection}. Records every
 * call so tests can assert PEEK semantics (header-only fetch queries), UID
 * addressing, and candidate caps. The fake is per-instance; one fixture = one
 * connection, matching imapflow's one-connection-per-call lifecycle.
 */
export function fakeImapFlow(
  fixture: FakeImapFlowFixture
): ImapFlowConnection & {
  readonly calls: FakeImapFlowCall[];
} {
  const calls: FakeImapFlowCall[] = [];
  const record = (
    method: FakeImapFlowCall["method"],
    args: ReadonlyArray<unknown>
  ): void => {
    calls.push({ method, args });
  };
  const connection: ImapFlowConnection = {
    async connect(): Promise<void> {
      record("connect", []);
      if (fixture.connectThrows) throw fixture.connectThrows;
    },
    async logout(): Promise<void> {
      record("logout", []);
    },
    close(): void {
      record("close" as FakeImapFlowCall["method"], []);
    },
    async list(): Promise<ListResponse[]> {
      record("list", []);
      if (fixture.listThrows) throw fixture.listThrows;
      return fixture.folders.map((f) => ({
        path: f.path,
        pathAsListed: f.path,
        name: f.path.split("/").pop() ?? f.path,
        delimiter: "/",
        parent: [],
        parentPath: "",
        flags: new Set<string>(),
        listed: true,
        subscribed: true,
        ...(f.specialUse ? { specialUse: f.specialUse } : {}),
      }));
    },
    async mailboxOpen(path: string | string[]): Promise<MailboxObject> {
      record("mailboxOpen", [path]);
      const folderPath = Array.isArray(path) ? path[0] : path;
      const folder = fixture.folders.find((f) => f.path === folderPath);
      if (!folder) {
        throw new Error(`FakeImapFlow: folder not found: ${folderPath}`);
      }
      if (
        fixture.hangOnMailboxOpen &&
        folderPath === fixture.hangOnMailboxOpen
      ) {
        // Hang forever — simulates a hung/slow IMAP server. The deadline
        // racer aborts; the probe's abort listener calls `close()` to tear
        // down the socket. This await NEVER resolves on its own; the test
        // releases control via the racer's timeout winning Promise.race.
        await new Promise<MailboxObject>(() => {});
      }
      return {
        path: folder.path,
        delimiter: "/",
        flags: new Set<string>(),
        ...(folder.specialUse ? { specialUse: folder.specialUse } : {}),
        listed: true,
        subscribed: true,
        permanentFlags: new Set<string>(),
        uidValidity: folder.uidValidity,
        uidNext: folder.messages.reduce((m, x) => Math.max(m, x.uid), 0) + 1,
        exists: folder.messages.length,
      };
    },
    async search(
      query: SearchObject,
      options?: { uid?: boolean }
    ): Promise<number[] | false> {
      record("search", [query, options]);
      // Determine the folder from the most recent mailboxOpen call (imapflow
      // searches against the open mailbox).
      const lastOpen = [...calls]
        .reverse()
        .find((c) => c.method === "mailboxOpen");
      const folderPath = lastOpen
        ? Array.isArray(lastOpen.args[0])
          ? String(lastOpen.args[0][0])
          : String(lastOpen.args[0])
        : "";
      const folder = fixture.folders.find((f) => f.path === folderPath);

      const override = fixture.searchOverrides?.get(folderPath);
      if (override?.throws) throw override.throws;
      if (override?.delayMs) {
        await new Promise((r) => setTimeout(r, override.delayMs));
      }
      if (override && override.result !== undefined) {
        return override.result;
      }
      if (!folder) return [];

      // Default: substring search over In-Reply-To / References headers for
      // the `or: [{header: {in-reply-to: X}}, {header: {references: X}}]`
      // shape the client emits. Other search shapes return all UIDs (the
      // matrix does not exercise them).
      const orClauses = (query as { or?: Array<{ header?: Record<string, string> }> }).or;
      if (!orClauses) {
        return folder.messages.map((m) => m.uid);
      }
      const needles = orClauses
        .map((c) => c.header)
        .filter(Boolean)
        .flatMap((h) => Object.values(h ?? {}));
      if (needles.length === 0) return [];
      const matched = new Set<number>();
      for (const msg of folder.messages) {
        const block = msg.headers.toString("utf8").toLowerCase();
        for (const needle of needles) {
          if (block.includes(String(needle).toLowerCase())) {
            matched.add(msg.uid);
            break;
          }
        }
      }
      return Array.from(matched).sort((a, b) => a - b);
    },
    async fetchOne(
      seq: string | number | bigint,
      query: FetchQueryObject,
      options?: { uid?: boolean }
    ): Promise<FetchMessageObject | false> {
      record("fetchOne", [seq, query, options]);
      if (fixture.fetchDelayMs) {
        await new Promise((r) => setTimeout(r, fixture.fetchDelayMs));
      }
      const lastOpen = [...calls]
        .reverse()
        .find((c) => c.method === "mailboxOpen");
      const folderPath = lastOpen
        ? Array.isArray(lastOpen.args[0])
          ? String(lastOpen.args[0][0])
          : String(lastOpen.args[0])
        : "";
      const folder = fixture.folders.find((f) => f.path === folderPath);
      if (!folder) return false;
      const uid = Number(seq);
      const msg = folder.messages.find((m) => m.uid === uid);
      if (!msg) return false;

      const result: FetchMessageObject = {
        seq: uid,
        uid,
      };
      if (query.flags === true) {
        result.flags = new Set(msg.flags);
      }
      if (query.internalDate === true) {
        result.internalDate = new Date(0);
      }
      if (query.headers) {
        result.headers = msg.headers;
      }
      return result;
    },
  };
  return { ...connection, calls };
}

/** Build a fake ImapFlow factory from a fixture (the seam the client takes). */
export function fakeImapFlowFactory(
  fixture: FakeImapFlowFixture
): () => ImapFlowConnection {
  return () => fakeImapFlow(fixture);
}

/** Convenience: a header block Buffer from line parts. */
export function headerBlock(lines: string[]): Buffer {
  return Buffer.from(lines.join("\r\n"), "utf8");
}

import crypto from "crypto";
import { BaseModule } from "@/modules/baseModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import type { EmailMailboxAdapter } from "@/service/emailOrganization/EmailMailboxAdapter";
import { ImapEmailMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailOrganizationActionError } from "@/service/emailOrganization/EmailOrganizationErrors";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import { log } from "@/modules/Logger";

/**
 * Organization search (PRD FR-17, design §11): one explicitly selected
 * account, user-visible folders, literal subject matching, timezone-aware
 * UTC date bounds. Local mode queries the stored rows; server mode runs a
 * bounded IMAP SEARCH per folder and reports honest completeness. Trash is
 * searched ONLY when explicitly included in folderPaths.
 *
 * R5-09: cursors are bound to the exact account + query that produced them
 * (a foreign cursor is refused, never replayed), positions advance by the
 * UIDs actually consumed (including candidates dropped by the exact date
 * filter), and unknown completeness never masquerades as a filtered answer.
 */

const SERVER_SCAN_CANDIDATE_CAP = 1000;
const SERVER_SCAN_BUDGET_MS = 30_000;
const SERVER_SCAN_PAGE_MAX = 100;
/** Matched UIDs fetched per SEARCH window (bounds per-call envelope fetches). */
const SERVER_SCAN_WINDOW = 200;

export interface OrganizationSearchInput {
  readonly emailServiceId: number;
  readonly source: "local" | "server";
  /** Explicit folder scope; Trash must be listed to be searched. */
  readonly folderPaths?: readonly string[];
  readonly fromAddress?: string;
  readonly subject?: string;
  /** Inclusive UTC lower bound on receivedAt. */
  readonly receivedFrom?: string;
  /** Exclusive UTC upper bound on receivedAt. */
  readonly receivedTo?: string;
  readonly unreadOnly?: boolean;
  readonly hasAttachments?: boolean;
  readonly pageSize?: number;
  /** R15: opaque continuation cursor from a previous page. */
  readonly cursor?: string;
}

export interface OrganizationSearchResultRow {
  readonly messageId: number | null;
  readonly providerUid: string | null;
  readonly folderPath: string | null;
  readonly fromAddress: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly isUnread: boolean;
  /** null = unknown (server rows cannot report attachment presence). */
  readonly hasAttachments: boolean | null;
}

export interface OrganizationSearchResult {
  readonly source: "local" | "server";
  readonly emailServiceId: number;
  readonly searchedFolders: readonly string[];
  /** Folders whose server search failed; completeness is false when set. */
  readonly failedFolders: ReadonlyArray<{ readonly folderPath: string; readonly reasonCode: string }>;
  readonly rows: readonly OrganizationSearchResultRow[];
  readonly totalMatched: number;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly lastSyncAt: string | null;
  readonly limitation: string | null;
  /** R15: opaque cursor for the next page; null when exhausted/unknown. */
  readonly nextCursor: string | null;
}

export class EmailOrganizationSearchService extends BaseModule {
  private readonly messageModule: EmailReceivedMessageModule;
  private readonly serviceModule: EmailServiceModule;
  private readonly locationModule: EmailMessageLocationModule;
  private readonly adapter: EmailMailboxAdapter;
  private readonly capabilityService: EmailOrganizationCapabilityService;

  constructor(options?: {
    adapter?: EmailMailboxAdapter;
    capabilityService?: EmailOrganizationCapabilityService;
  }) {
    super();
    this.messageModule = new EmailReceivedMessageModule();
    this.serviceModule = new EmailServiceModule();
    this.locationModule = new EmailMessageLocationModule();
    this.adapter = options?.adapter ?? new ImapEmailMailboxAdapter();
    this.capabilityService =
      options?.capabilityService ?? new EmailOrganizationCapabilityService();
  }

  async search(input: OrganizationSearchInput): Promise<OrganizationSearchResult> {
    await this.ensureConnection();
    if (input.source === "server") {
      return await this.searchServer(input);
    }
    return await this.searchLocal(input);
  }

  private async searchLocal(
    input: OrganizationSearchInput
  ): Promise<OrganizationSearchResult> {
    const service = await this.serviceModule.getEmailService(input.emailServiceId);
    if (!service) {
      throw new EmailOrganizationActionError(
        "ACCOUNT_NOT_AVAILABLE",
        "Account not found.",
        false
      );
    }
    const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
    // PRD §7: Trash is searched only when explicitly listed. Unscoped local
    // searches exclude the account's Trash folder.
    let excludedFolder: string | null = null;
    if (input.folderPaths === undefined) {
      const capabilities = await this.capabilityService.getCapabilities(input.emailServiceId);
      excludedFolder = capabilities.trashFolderPath;
    } else if (input.folderPaths.length === 0) {
      throw new EmailOrganizationActionError(
        "VALIDATION_FAILED",
        "folderPaths must contain at least one folder when provided.",
        false
      );
    }
    // R5-09: the continuation cursor feeds the model's keyset predicate.
    const keysetBefore = decodeLocalCursor(input.cursor, searchQueryHash(input, null));
    const result = await this.messageModule.searchForOrganization({
      emailServiceId: input.emailServiceId,
      excludeFolderPath: excludedFolder ?? undefined,
      folderPaths: input.folderPaths,
      fromAddress: input.fromAddress,
      subject: input.subject,
      receivedFrom: input.receivedFrom ? new Date(input.receivedFrom) : undefined,
      receivedTo: input.receivedTo ? new Date(input.receivedTo) : undefined,
      unreadOnly: input.unreadOnly,
      hasAttachments: input.hasAttachments,
      keysetBefore,
      limit: pageSize,
    });
    const folders = await this.locationModule.readByMessageIds(
      result.rows.map((row) => row.id)
    );
    const folderByMessageId = new Map(folders.map((row) => [row.messageId, row.folderPath]));
    const lastRow = result.rows[result.rows.length - 1];
    return {
      source: "local",
      emailServiceId: input.emailServiceId,
      searchedFolders: input.folderPaths ? [...input.folderPaths] : ["ALL_LOCAL"],
      failedFolders: [],
      rows: result.rows.map((row) => ({
        messageId: row.id,
        providerUid: row.providerUid,
        folderPath: folderByMessageId.get(row.id) ?? null,
        fromAddress: row.fromAddress,
        subject: row.subject,
        receivedAt: row.receivedAt.toISOString(),
        isUnread: row.isUnread === 1,
        hasAttachments: row.hasAttachments === 1,
      })),
      totalMatched: result.totalMatched,
      complete: !result.truncated,
      truncated: result.truncated,
      nextCursor:
        result.truncated && lastRow !== undefined
          ? encodeCursor({
              v: 1,
              q: searchQueryHash(input, null),
              receivedAt: lastRow.receivedAt.toISOString(),
              id: lastRow.id,
            })
          : null,
      lastSyncAt: service.lastReceiveSyncAt ? service.lastReceiveSyncAt.toISOString() : null,
      limitation:
        excludedFolder !== null
          ? `Unscoped local search: messages in ${excludedFolder} are excluded (Trash is searched only when explicitly listed).`
          : null,
    };
  }

  /**
   * Bounded server scan (design §11): IMAP SEARCH per folder, capped at
   * 1000 candidates; the scan advances window-by-window INSIDE a folder
   * until the page fills or the folder is exhausted, so continuation
   * resumes at the exact (folder, matched-UID offset) actually consumed —
   * including candidates dropped by the exact date filter (R5-09).
   */
  private async searchServer(
    input: OrganizationSearchInput
  ): Promise<OrganizationSearchResult> {
    const receiveConfig: EmailReceiveConnectionConfig | null =
      await this.serviceModule.getEmailServiceReceiveConfig(input.emailServiceId);
    if (!receiveConfig) {
      throw new EmailOrganizationActionError(
        "ACCOUNT_NOT_AVAILABLE",
        "Account receive configuration is unavailable.",
        false
      );
    }
    const folders = input.folderPaths && input.folderPaths.length > 0
      ? [...input.folderPaths]
      : [receiveConfig.folder];
    if (folders.length === 0) {
      throw new EmailOrganizationActionError(
        "VALIDATION_FAILED",
        "folderPaths must contain at least one folder when provided.",
        false
      );
    }
    const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), SERVER_SCAN_PAGE_MAX);
    // R5-09: an exact true/false attachment filter the server cannot apply
    // is REFUSED — returning the unfiltered page would be a silent broader
    // hit list (PRD §7). Attachment presence on server rows reports unknown.
    if (input.hasAttachments !== undefined) {
      throw new EmailOrganizationActionError(
        "VALIDATION_FAILED",
        "Attachment presence cannot be evaluated by a server search; use source: 'local' or drop the hasAttachments filter.",
        false
      );
    }
    const rows: OrganizationSearchResultRow[] = [];
    const failedFolders: Array<{ folderPath: string; reasonCode: string }> = [];
    const searchedFolders: string[] = [];
    let candidatesSeen = 0;
    let capped = false;
    // Design §11: bounded work — 1000 candidates or 30 seconds overall.
    const deadline = Date.now() + SERVER_SCAN_BUDGET_MS;
    let budgetExhausted = false;
    // R5-09: the resume position is the (folder, matched-UID offset) the
    // previous page actually stopped at; the query hash refuses foreign
    // cursors and out-of-range/negative fields are rejected outright.
    const queryHash = searchQueryHash(input, folders);
    const cursorState = decodeServerCursor(input.cursor, queryHash, folders.length);
    const fromMs = input.receivedFrom ? new Date(input.receivedFrom).getTime() : null;
    const toMs = input.receivedTo ? new Date(input.receivedTo).getTime() : null;
    let resumePosition: { folderIndex: number; uidOffset: number } | null = null;
    let foldersExhausted = true;

    outer: for (let folderIndex = cursorState.folderIndex; folderIndex < folders.length; folderIndex += 1) {
      const folder = folders[folderIndex];
      let uidOffset = folderIndex === cursorState.folderIndex ? cursorState.uidOffset : 0;
      for (;;) {
        if (rows.length >= pageSize) {
          resumePosition = { folderIndex, uidOffset };
          foldersExhausted = false;
          break outer;
        }
        if (candidatesSeen >= SERVER_SCAN_CANDIDATE_CAP) {
          capped = true;
          resumePosition = { folderIndex, uidOffset };
          foldersExhausted = false;
          break outer;
        }
        if (Date.now() >= deadline) {
          budgetExhausted = true;
          resumePosition = { folderIndex, uidOffset };
          foldersExhausted = false;
          break outer;
        }
        const windowCap = Math.min(SERVER_SCAN_WINDOW, SERVER_SCAN_CANDIDATE_CAP - candidatesSeen);
        const result = await this.adapter.searchUids(
          receiveConfig,
          folder,
          {
            fromAddress: input.fromAddress,
            subject: input.subject,
            since: input.receivedFrom ? new Date(input.receivedFrom) : undefined,
            before: input.receivedTo ? new Date(input.receivedTo) : undefined,
            unreadOnly: input.unreadOnly,
            cap: windowCap,
            uidOffset,
          }
        );
        // Review (false completeness): a failed folder search is never a
        // "no matches" result — it is disclosed and forces complete:false.
        if (result.status !== "listed") {
          failedFolders.push({ folderPath: folder, reasonCode: result.reasonCode });
          continue outer;
        }
        searchedFolders.push(folder);
        // The adapter's own truncation claim always forces incomplete.
        capped = capped || result.capped;
        candidatesSeen += result.candidates.length;
        // R15: exact UTC post-filter over the coarse IMAP date search.
        // R5-09: the cursor advances by the candidates actually CONSUMED —
        // date-filtered candidates included — and stops mid-window when the
        // page fills, so the next page resumes at the first unprocessed UID.
        let consumedInWindow = 0;
        let pageFilled = false;
        for (const candidate of result.candidates) {
          if (rows.length >= pageSize) {
            pageFilled = true;
            break;
          }
          consumedInWindow += 1;
          const rowMs = candidate.date !== null ? new Date(candidate.date).getTime() : null;
          if (fromMs !== null && (rowMs === null || rowMs < fromMs)) continue;
          if (toMs !== null && (rowMs === null || rowMs >= toMs)) continue;
          rows.push({
            messageId: null,
            providerUid: candidate.uid,
            folderPath: folder,
            fromAddress: candidate.fromAddress ?? "",
            subject: candidate.subject ?? "",
            receivedAt: candidate.date ?? "",
            isUnread: candidate.seen === false,
            hasAttachments: null,
          });
        }
        uidOffset += consumedInWindow;
        if (pageFilled) {
          resumePosition = { folderIndex, uidOffset };
          foldersExhausted = false;
          break outer;
        }
        if (result.candidates.length < windowCap) {
          // Folder exhausted: continue with the next folder at offset 0.
          break;
        }
      }
    }
    // R5-09: the cursor points at the exact consumed position — the folder
    // being scanned and its matched-UID offset (dropped candidates included).
    const pageCutShort = rows.length >= pageSize;
    const nextCursor =
      !foldersExhausted && resumePosition !== null
        ? encodeCursor({
            v: 1,
            q: queryHash,
            folderIndex: resumePosition.folderIndex,
            uidOffset: resumePosition.uidOffset,
          })
        : null;

    const limitationParts: string[] = [];
    if (capped) {
      limitationParts.push(
        `The server scan stopped at the ${SERVER_SCAN_CANDIDATE_CAP}-candidate bound; results are incomplete and not an exact total.`
      );
    }
    if (budgetExhausted) {
      limitationParts.push(
        `The server scan exceeded its ${Math.round(SERVER_SCAN_BUDGET_MS / 1000)}s budget; remaining folders were not searched.`
      );
    }
    if (failedFolders.length > 0) {
      limitationParts.push(
        `${failedFolders.length} folder(s) could not be searched (${failedFolders.map((f) => f.reasonCode).join(", ")}).`
      );
    }
    if (!capped && !budgetExhausted && failedFolders.length === 0) {
      limitationParts.push(
        "Server metadata is a bounded scan, not an exact total; attachment presence is not server-filtered and reports unknown."
      );
    }

    return {
      source: "server",
      emailServiceId: input.emailServiceId,
      searchedFolders: searchedFolders,
      failedFolders,
      rows,
      totalMatched: rows.length,
      complete: !capped && !budgetExhausted && failedFolders.length === 0 && !pageCutShort && foldersExhausted,
      truncated: rows.length >= pageSize,
      lastSyncAt: null,
      limitation: limitationParts.join(" "),
      nextCursor,
    };
  }
}

/** Opaque cursor payload: version + query binding + mode position. */
interface SearchCursorPayload {
  readonly v: number;
  readonly q: string;
}

function encodeCursor(payload: SearchCursorPayload & Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/** Stable binding of account + normalized filters (+ folder scope) → hash. */
function searchQueryHash(
  input: OrganizationSearchInput,
  folders: readonly string[] | null
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        emailServiceId: input.emailServiceId,
        folders,
        fromAddress: input.fromAddress?.trim().toLowerCase() ?? null,
        subject: input.subject?.trim() ?? null,
        receivedFrom: input.receivedFrom ?? null,
        receivedTo: input.receivedTo ?? null,
        unreadOnly: input.unreadOnly === true,
        hasAttachments: input.hasAttachments ?? null,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

function decodeCursorBase(cursor: string | undefined, expectedQueryHash: string): Record<string, unknown> {
  if (cursor === undefined) {
    return { v: 1, q: expectedQueryHash } as Record<string, unknown>;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as unknown;
  } catch {
    throw new EmailOrganizationActionError(
      "VALIDATION_FAILED",
      "Invalid continuation cursor; start a fresh search.",
      false
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new EmailOrganizationActionError(
      "VALIDATION_FAILED",
      "Invalid continuation cursor; start a fresh search.",
      false
    );
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || typeof record.q !== "string" || record.q !== expectedQueryHash) {
    // A cursor from a different account/query/folder scope is never
    // replayed against another search (R5-09).
    throw new EmailOrganizationActionError(
      "VALIDATION_FAILED",
      "The continuation cursor does not belong to this search; start a fresh search.",
      false
    );
  }
  return record;
}

/** R5-09: local keyset cursor → strict (receivedAt, id) position. */
function decodeLocalCursor(
  cursor: string | undefined,
  expectedQueryHash: string
): { receivedAt: Date; id: number } | undefined {
  if (cursor === undefined) return undefined;
  const record = decodeCursorBase(cursor, expectedQueryHash);
  const id = record.id;
  const receivedAt = record.receivedAt;
  if (
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id < 1 ||
    typeof receivedAt !== "string" ||
    Number.isNaN(new Date(receivedAt).getTime())
  ) {
    throw new EmailOrganizationActionError(
      "VALIDATION_FAILED",
      "Invalid continuation cursor; start a fresh search.",
      false
    );
  }
  return { receivedAt: new Date(receivedAt), id };
}

/** R5-09: server cursor → validated (folderIndex, uidOffset) position. */
function decodeServerCursor(
  cursor: string | undefined,
  expectedQueryHash: string,
  folderCount: number
): { folderIndex: number; uidOffset: number } {
  if (cursor === undefined) {
    return { folderIndex: 0, uidOffset: 0 };
  }
  const record = decodeCursorBase(cursor, expectedQueryHash);
  const folderIndex = record.folderIndex;
  const uidOffset = record.uidOffset;
  if (
    typeof folderIndex !== "number" ||
    !Number.isInteger(folderIndex) ||
    folderIndex < 0 ||
    folderIndex >= folderCount ||
    typeof uidOffset !== "number" ||
    !Number.isInteger(uidOffset) ||
    uidOffset < 0
  ) {
    // Negative offsets would slice from the END of the UID list; an
    // out-of-range folder index would scan zero folders and report a
    // bogus empty complete page — both rejected outright.
    throw new EmailOrganizationActionError(
      "VALIDATION_FAILED",
      "Invalid continuation cursor; start a fresh search.",
      false
    );
  }
  return { folderIndex, uidOffset };
}

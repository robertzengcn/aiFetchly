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
 */

const SERVER_SCAN_CANDIDATE_CAP = 1000;
const SERVER_SCAN_BUDGET_MS = 30_000;
const SERVER_SCAN_PAGE_MAX = 100;

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
      limit: pageSize,
    });
    const folders = await this.locationModule.readByMessageIds(
      result.rows.map((row) => row.id)
    );
    const folderByMessageId = new Map(folders.map((row) => [row.messageId, row.folderPath]));
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
      complete: true,
      truncated: result.truncated,
      nextCursor: null,
      lastSyncAt: service.lastReceiveSyncAt ? service.lastReceiveSyncAt.toISOString() : null,
      limitation:
        excludedFolder !== null
          ? `Unscoped local search: messages in ${excludedFolder} are excluded (Trash is searched only when explicitly listed).`
          : null,
    };
  }

  /**
   * Bounded server scan (design §11): IMAP SEARCH per folder, capped at
   * 1000 candidates; envelope metadata fetched only for the requested
   * page. Reaching the cap reports complete:false with a resumable note.
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
    const rows: OrganizationSearchResultRow[] = [];
    const failedFolders: Array<{ folderPath: string; reasonCode: string }> = [];
    const searchedFolders: string[] = [];
    let candidatesSeen = 0;
    let capped = false;
    // Design §11: bounded work — 1000 candidates or 30 seconds overall.
    const deadline = Date.now() + SERVER_SCAN_BUDGET_MS;
    let budgetExhausted = false;
    // R15: cursor = base64 {folderIndex, uidOffset} bound to this scan.
    let cursorState = { folderIndex: 0, uidOffset: 0 };
    if (input.cursor !== undefined) {
      try {
        const decoded = JSON.parse(Buffer.from(input.cursor, "base64").toString("utf8")) as {
          folderIndex?: number;
          uidOffset?: number;
        };
        cursorState = {
          folderIndex: typeof decoded.folderIndex === "number" ? decoded.folderIndex : 0,
          uidOffset: typeof decoded.uidOffset === "number" ? decoded.uidOffset : 0,
        };
      } catch {
        throw new EmailOrganizationActionError(
          "VALIDATION_FAILED",
          "Invalid continuation cursor; start a fresh search.",
          false
        );
      }
    }
    const fromMs = input.receivedFrom ? new Date(input.receivedFrom).getTime() : null;
    const toMs = input.receivedTo ? new Date(input.receivedTo).getTime() : null;
    const hasAttachmentFilter = input.hasAttachments !== undefined;

    for (let folderIndex = cursorState.folderIndex; folderIndex < folders.length; folderIndex += 1) {
      const folder = folders[folderIndex];
      if (candidatesSeen >= SERVER_SCAN_CANDIDATE_CAP) {
        capped = true;
        break;
      }
      if (Date.now() >= deadline) {
        budgetExhausted = true;
        break;
      }
      const result = await this.adapter.searchUids(
        receiveConfig,
        folder,
        {
          fromAddress: input.fromAddress,
          subject: input.subject,
          since: input.receivedFrom ? new Date(input.receivedFrom) : undefined,
          before: input.receivedTo ? new Date(input.receivedTo) : undefined,
          unreadOnly: input.unreadOnly,
          cap: SERVER_SCAN_CANDIDATE_CAP - candidatesSeen,
          metadataLimit: Math.max(pageSize - rows.length, 0),
        }
      );
      // Review (false completeness): a failed folder search is never a
      // "no matches" result — it is disclosed and forces complete:false.
      if (result.status !== "listed") {
        failedFolders.push({ folderPath: folder, reasonCode: result.reasonCode });
        continue;
      }
      searchedFolders.push(folder);
      candidatesSeen += result.candidates.length;
      capped = capped || result.capped || candidatesSeen >= SERVER_SCAN_CANDIDATE_CAP;
      // R15: hasAttachments is NOT server-filterable — it is reported as
      // unknown (null) and forces incomplete results rather than silently
      // returning rows that may fail the requested predicate.
      for (const candidate of result.candidates.slice(0, pageSize - rows.length)) {
        // R15: exact UTC post-filter over the coarse IMAP date search.
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
          hasAttachments: hasAttachmentFilter ? null : false,
        });
      }
      if (rows.length >= pageSize) break;
    }
    // R15: a page-full exit before the LAST folder means more results exist.
    // R15-review: the cursor advances to the NEXT folder (candidates within
    // a folder are not offset-addressable through the bounded SEARCH), so a
    // page that cuts a folder short discloses the truncation via
    // complete:false instead of pretending an exact continuation.
    const pageCutShort = rows.length >= pageSize;
    const nextCursor =
      pageCutShort && cursorState.folderIndex + 1 < folders.length
        ? Buffer.from(
            JSON.stringify({ folderIndex: cursorState.folderIndex + 1 })
          ).toString("base64")
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
        "Server metadata is a bounded scan, not an exact total; attachment presence is not server-filtered and reports false locally."
      );
    }

    return {
      source: "server",
      emailServiceId: input.emailServiceId,
      searchedFolders: searchedFolders,
      failedFolders,
      rows,
      totalMatched: rows.length,
      complete:
        !capped && !budgetExhausted && failedFolders.length === 0 && !pageCutShort && !hasAttachmentFilter,
      truncated: rows.length >= pageSize,
      lastSyncAt: null,
      limitation: hasAttachmentFilter
        ? `${limitationParts.join(" ")} Attachment presence is not server-searchable; rows report it as unknown.`.trim()
        : limitationParts.join(" "),
      nextCursor,
    };
  }
}

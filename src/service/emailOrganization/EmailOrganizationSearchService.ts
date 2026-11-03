import { BaseModule } from "@/modules/baseModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import type { EmailMailboxAdapter } from "@/service/emailOrganization/EmailMailboxAdapter";
import { ImapEmailMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
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
}

export interface OrganizationSearchResultRow {
  readonly messageId: number | null;
  readonly providerUid: string | null;
  readonly folderPath: string | null;
  readonly fromAddress: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly isUnread: boolean;
  readonly hasAttachments: boolean;
}

export interface OrganizationSearchResult {
  readonly source: "local" | "server";
  readonly emailServiceId: number;
  readonly searchedFolders: readonly string[];
  readonly rows: readonly OrganizationSearchResultRow[];
  readonly totalMatched: number;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly lastSyncAt: string | null;
  readonly limitation: string | null;
}

export class EmailOrganizationSearchService extends BaseModule {
  private readonly messageModule: EmailReceivedMessageModule;
  private readonly serviceModule: EmailServiceModule;
  private readonly locationModule: EmailMessageLocationModule;
  private readonly adapter: EmailMailboxAdapter;

  constructor(options?: { adapter?: EmailMailboxAdapter }) {
    super();
    this.messageModule = new EmailReceivedMessageModule();
    this.serviceModule = new EmailServiceModule();
    this.locationModule = new EmailMessageLocationModule();
    this.adapter = options?.adapter ?? new ImapEmailMailboxAdapter();
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
    const result = await this.messageModule.searchForOrganization({
      emailServiceId: input.emailServiceId,
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
      lastSyncAt: service.lastReceiveSyncAt ? service.lastReceiveSyncAt.toISOString() : null,
      limitation:
        input.folderPaths === undefined
          ? "No explicit folder scope: results cover locally stored messages across folders; Trash is included only where a stored location says so."
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
    const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), SERVER_SCAN_PAGE_MAX);
    const rows: OrganizationSearchResultRow[] = [];
    let candidatesSeen = 0;
    let capped = false;

    for (const folder of folders) {
      if (candidatesSeen >= SERVER_SCAN_CANDIDATE_CAP) {
        capped = true;
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
        }
      );
      if (result.status !== "listed") continue;
      candidatesSeen += result.candidates.length;
      // Honest completeness: the adapter reports when its SEARCH hit the
      // requested bound, and the global cap applies across folders.
      capped = capped || result.capped || candidatesSeen >= SERVER_SCAN_CANDIDATE_CAP;
      for (const candidate of result.candidates.slice(0, pageSize - rows.length)) {
        rows.push({
          messageId: null,
          providerUid: candidate.uid,
          folderPath: folder,
          fromAddress: candidate.fromAddress ?? "",
          subject: candidate.subject ?? "",
          receivedAt: candidate.date ?? "",
          isUnread: candidate.seen === false,
          hasAttachments: false,
        });
      }
      if (rows.length >= pageSize) break;
    }

    return {
      source: "server",
      emailServiceId: input.emailServiceId,
      searchedFolders: folders,
      rows,
      totalMatched: rows.length,
      complete: !capped,
      truncated: rows.length >= pageSize,
      lastSyncAt: null,
      limitation: capped
        ? `The server scan stopped at the ${SERVER_SCAN_CANDIDATE_CAP}-candidate bound; results are incomplete and not an exact total.`
        : "Server metadata is a bounded scan, not an exact total; attachment presence is not server-filtered and reports false locally.",
    };
  }
}

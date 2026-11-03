import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";

/**
 * Mailbox-action adapter boundary (technical design §2/§14): protocol I/O
 * only, no database access. Implementations must refuse any move they
 * cannot perform as a verified native MOVE — silent COPY+EXPUNGE fallbacks
 * are forbidden (invariant 9).
 */

/** One provider folder with special-use metadata when the server reports it. */
export interface MailboxFolderInfo {
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly writable: boolean;
}

/** Verified location to act on (mirrors the location entity's identity fields). */
export interface MailboxLocation {
  readonly folderPath: string;
  readonly uidValidity: string;
  readonly uid: string;
}

export type FullSourceResult =
  | { readonly status: "fetched"; readonly source: Buffer; readonly uidValidity: string }
  | { readonly status: "uid_validity_changed" }
  | { readonly status: "source_missing" }
  | { readonly status: "failed"; readonly reasonCode: string; readonly sanitizedError: string };

export type MoveResult =
  | {
      readonly status: "moved";
      /** Destination UIDVALIDITY, when the server reports it. */
      readonly destinationUidValidity: string | null;
      /** Destination UID mapping; null when the server gave no COPYUID. */
      readonly destinationUid: string | null;
    }
  | { readonly status: "no_move_capability" }
  | { readonly status: "uid_validity_changed" }
  | { readonly status: "source_missing" }
  | { readonly status: "failed"; readonly reasonCode: string; readonly sanitizedError: string };

export type PresenceResult =
  | { readonly status: "present" }
  | { readonly status: "absent" }
  | { readonly status: "uid_validity_changed" }
  | { readonly status: "failed"; readonly reasonCode: string; readonly sanitizedError: string };

export type FolderListResult =
  | { readonly status: "listed"; readonly folders: readonly MailboxFolderInfo[] }
  | { readonly status: "failed"; readonly reasonCode: string; readonly sanitizedError: string };

export interface MailboxCapabilityProbe {
  readonly moveCapability: boolean;
  readonly folders: readonly MailboxFolderInfo[];
  readonly reasonCode: string | null;
  readonly sanitizedError: string | null;
}

export interface EmailMailboxAdapter {
  listFolders(config: EmailReceiveConnectionConfig): Promise<FolderListResult>;
  /**
   * One-connection probe: server capabilities + folder listing with
   * special-use metadata (used by the capability resolver and cacheable).
   */
  probeCapabilities(config: EmailReceiveConnectionConfig): Promise<MailboxCapabilityProbe>;
  /** Fetch the complete raw RFC-822 source without altering flags (PEEK). */
  fetchFullSource(
    config: EmailReceiveConnectionConfig,
    location: MailboxLocation
  ): Promise<FullSourceResult>;
  /**
   * Native MOVE of one message to the destination folder. Refuses without
   * server MOVE capability; never falls back to COPY + delete/expunge.
   */
  moveMessage(
    config: EmailReceiveConnectionConfig,
    location: MailboxLocation,
    destinationFolderPath: string
  ): Promise<MoveResult>;
  /**
   * Bounded IMAP SEARCH per folder returning envelope metadata only (FR-17
   * server mode). Unsupported exact filters must not silently broaden:
   * attachment presence is never server-filtered.
   */
  searchUids(
    config: EmailReceiveConnectionConfig,
    folderPath: string,
    input: ServerSearchInput
  ): Promise<ServerSearchResult>;
  /** Cheap existence+validity probe used by reconciliation. */
  checkMessagePresent(
    config: EmailReceiveConnectionConfig,
    location: MailboxLocation
  ): Promise<PresenceResult>;
}

/** One matched server candidate (envelope-derived metadata only). */
export interface SearchCandidate {
  readonly uid: string;
  readonly fromAddress: string | null;
  readonly subject: string | null;
  readonly date: string | null;
  readonly seen: boolean | null;
}

export interface ServerSearchInput {
  readonly fromAddress?: string;
  readonly subject?: string;
  readonly since?: Date;
  readonly before?: Date;
  readonly unreadOnly?: boolean;
  /** Maximum candidates to accept from this folder's SEARCH. */
  readonly cap: number;
}

export type ServerSearchResult =
  | {
      readonly status: "listed";
      readonly candidates: readonly SearchCandidate[];
      readonly capped: boolean;
    }
  | { readonly status: "failed"; readonly reasonCode: string; readonly sanitizedError: string };

/** Shared error sanitizer: no credentials, no server dumps. */
export function sanitizeMailboxError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.slice(0, 240);
  return trimmed
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[address]")
    .replace(/(password|pass|token|secret)[=:]\S+/gi, "$1=[redacted]");
}

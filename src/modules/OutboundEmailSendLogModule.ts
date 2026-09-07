import { BaseModule } from "@/modules/baseModule";
import { EmailMarketingSendLogModule } from "@/modules/emailMarketingSendLogModule";
import { OutboundEmailDeliveryModule } from "@/modules/OutboundEmailDeliveryModule";
import { OutboundEmailDraftModule } from "@/modules/OutboundEmailDraftModule";
import type { SortBy } from "@/entityTypes/commonType";
import type {
  UnifiedSendLogEntry,
  UnifiedSendLogDetailEntry,
} from "@/entityTypes/buckemailType";
import type { OutboundEmailRecipientOutcomeStatus } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Aggregator module for the unified send-log view. Merges the two parallel
 * outbound-email send paths into one timeline:
 *
 *   - legacy bulk-task sends  → emailmarketing_send_log (task-keyed)
 *   - authorized outbound sends → outbound_email_delivery_outcome (draft-keyed)
 *
 * The authorized half has no subject column of its own — the title lives on the
 * draft's current revision, so this module joins each outcome to its revision
 * via {@link OutboundEmailDraftModule.readCurrentRevision}.
 *
 * Pagination strategy: this is a local SQLite app, so we read a bounded recent
 * window from each half (PAGE_FETCH_CAP rows), merge them in memory, apply the
 * unified sort, then take the requested page slice. This avoids a cross-table
 * SQL UNION (the two tables have different schemas) and keeps the read cheap.
 */
const PAGE_FETCH_CAP = 500;

/** Sort key the unified view accepts. id | record_time | status | source. */
type UnifiedSortKey = "id" | "record_time" | "status" | "source";

function isUnifiedSortKey(key: string | undefined): key is UnifiedSortKey {
  return (
    key === "id" ||
    key === "record_time" ||
    key === "status" ||
    key === "source"
  );
}

/**
 * Map an authorized outcome status to a human label consistent with the legacy
 * send-log's "Success"/"Failure" names so both halves sort/compare uniformly.
 * Non-terminal statuses (pending/submitted) surface as their own labels so the
 * user can see an in-flight send.
 */
function authorizedStatusLabel(
  status: OutboundEmailRecipientOutcomeStatus
): string {
  switch (status) {
    case "sent":
      return "Success";
    case "failed":
      return "Failure";
    case "suppressed":
      return "Suppressed";
    case "delivery_unknown":
      return "Unknown";
    case "pending":
      return "Pending";
    case "submitted":
      return "Submitted";
    default:
      return "Unknown";
  }
}

export class OutboundEmailSendLogModule extends BaseModule {
  private legacyModule: EmailMarketingSendLogModule;
  private deliveryModule: OutboundEmailDeliveryModule;
  private draftModule: OutboundEmailDraftModule;

  constructor() {
    super();
    this.legacyModule = new EmailMarketingSendLogModule();
    this.deliveryModule = new OutboundEmailDeliveryModule();
    this.draftModule = new OutboundEmailDraftModule();
  }

  /**
   * Fetch one page of the unified send log. The `where` filter matches the
   * recipient/title fields on both halves (legacy: receiver/title/content;
   * authorized: recipientAddress, plus the joined revision subject).
   *
   * Returns {records, total} where total is the merged count of matching rows
   * across both sources within the bounded recent window.
   */
  async getUnifiedSendLog(
    page: number,
    limit: number,
    where?: string,
    sortby?: SortBy
  ): Promise<{ records: UnifiedSendLogEntry[]; total: number }> {
    await this.ensureConnection();

    // Sort: default newest-first by id. The unified view mixes two id spaces,
    // so "newest" really means "most recent record_time" — prefer record_time
    // when no explicit sort is given.
    let sortKey: UnifiedSortKey = "record_time";
    let sortAsc = false;
    if (sortby?.key && sortby?.order) {
      const key = sortby.key.toLowerCase();
      const order = sortby.order.toLowerCase();
      if (!isUnifiedSortKey(key)) {
        throw new Error("not allow sort key");
      }
      if (order !== "asc" && order !== "desc") {
        throw new Error("not allow sort order");
      }
      sortKey = key;
      sortAsc = order === "asc";
    }

    const legacy = await this.fetchLegacyHalf(where);
    const authorized = await this.fetchAuthorizedHalf(where);
    const merged = [...legacy, ...authorized];
    this.sortMerged(merged, sortKey, sortAsc);

    const total = merged.length;
    const start = Math.max(0, page);
    const records = merged.slice(start, start + limit);
    return { records, total };
  }

  /**
   * Detail payload for one unified send-log row, keyed by the (source, id)
   * pair — `id` alone is not globally unique across the two halves.
   *
   *  - legacy: the full emailmarketing_send_log row (content, log, task_id)
   *  - authorized: the delivery outcome joined to the revision pinned by
   *    outcome.revisionId — the exact revision that was sent, not the draft's
   *    current one — so the displayed body matches what left the app.
   */
  async getUnifiedSendLogDetail(
    source: "legacy" | "authorized",
    id: number
  ): Promise<UnifiedSendLogDetailEntry> {
    await this.ensureConnection();
    if (source === "legacy") {
      const row = await this.legacyModule.readItem(id);
      if (!row) {
        throw new Error("send log record not found");
      }
      return {
        id: row.id ?? 0,
        source: "legacy",
        status:
          row.status !== undefined && row.status !== null
            ? this.legacyModule.getStatusName(row.status)
            : "Unknown",
        receiver: row.receiver ?? "",
        title: row.title ?? "",
        record_time: row.record_time,
        content: row.content,
        log: row.log,
        taskId: row.task_id,
      };
    }

    const outcome = await this.deliveryModule.readOutcome(id);
    if (!outcome) {
      throw new Error("send log record not found");
    }
    // Join the EXACT revision sent — the outcome pins revisionId.
    const revision = await this.draftModule.readRevision(outcome.revisionId);
    return {
      id: outcome.id,
      source: "authorized",
      status: authorizedStatusLabel(outcome.status),
      receiver: outcome.recipientAddress,
      title: revision?.subject ?? "",
      record_time:
        outcome.completedAt?.toISOString() ??
        outcome.submittedAt?.toISOString() ??
        undefined,
      sender: revision?.senderAddress,
      actor: revision?.actor,
      bodyText: revision?.bodyText,
      providerMessageId: outcome.providerMessageId ?? undefined,
      errorCode: outcome.errorCode ?? undefined,
      submittedAt: outcome.submittedAt?.toISOString(),
      completedAt: outcome.completedAt?.toISOString(),
      batchId: outcome.batchId,
      draftId: outcome.draftId,
      revisionId: outcome.revisionId,
      attemptId: outcome.sendAttemptId,
    };
  }

  private async fetchLegacyHalf(
    where?: string
  ): Promise<UnifiedSendLogEntry[]> {
    const { records, total } = await this.legacyModule.getRecentSendlogList(
      0,
      PAGE_FETCH_CAP,
      where
    );
    void total;
    return records.map((row) => {
      const status =
        row.status !== undefined && row.status !== null
          ? this.legacyModule.getStatusName(row.status)
          : "Unknown";
      return {
        id: row.id ?? 0,
        source: "legacy",
        status,
        receiver: row.receiver ?? "",
        title: row.title ?? "",
        record_time: row.record_time,
        taskId: row.task_id,
      };
    });
  }

  private async fetchAuthorizedHalf(
    where?: string
  ): Promise<UnifiedSendLogEntry[]> {
    const { records } = await this.deliveryModule.listOutcomesRecent(
      0,
      PAGE_FETCH_CAP,
      where
    );

    if (records.length === 0) {
      return [];
    }

    // Batch the revision join: one query for all draftIds instead of one per
    // outcome (N+1 → 1). The map is keyed by draftId for O(1) lookup.
    const draftIds = records.map((r) => r.draftId);
    const revisions = await this.draftModule.readCurrentRevisions(draftIds);

    const entries: UnifiedSendLogEntry[] = [];
    for (const outcome of records) {
      const revision = revisions.get(outcome.draftId);
      const title = revision?.subject ?? "";
      const recordTime =
        outcome.completedAt?.toISOString() ??
        outcome.submittedAt?.toISOString() ??
        undefined;
      entries.push({
        id: outcome.id,
        source: "authorized",
        status: authorizedStatusLabel(outcome.status),
        receiver: outcome.recipientAddress,
        title,
        record_time: recordTime,
        batchId: outcome.batchId,
        draftId: outcome.draftId,
      });
    }
    return entries;
  }

  private sortMerged(
    merged: UnifiedSendLogEntry[],
    key: UnifiedSortKey,
    asc: boolean
  ): void {
    merged.sort((a, b) => {
      const av = this.sortValue(a, key);
      const bv = this.sortValue(b, key);
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
  }

  private sortValue(entry: UnifiedSendLogEntry, key: UnifiedSortKey): string {
    switch (key) {
      case "id":
        return String(entry.id).padStart(10, "0");
      case "record_time":
        return entry.record_time ?? "";
      case "status":
        return entry.status;
      case "source":
        return entry.source;
      default:
        return "";
    }
  }
}

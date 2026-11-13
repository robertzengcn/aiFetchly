import type {
  EmailOrganizationItemStatus,
  EmailOrganizationOperationStatus,
} from "@/entityTypes/emailOrganizationTypes";

/**
 * Pure aggregate-status derivation for organization operations
 * (technical design §6.2): `needs_reconciliation` takes precedence while any
 * item outcome is unknown; cancellation preserves completed items; a missing
 * source alone never proves success (`noop` requires recorded proof and is
 * supplied by the caller as a terminal item status).
 */
export function deriveOperationStatus(
  itemStatuses: readonly EmailOrganizationItemStatus[],
  cancelRequested: boolean
): EmailOrganizationOperationStatus {
  if (itemStatuses.length === 0) {
    return cancelRequested ? "cancelled" : "prepared";
  }

  const counts = countItemStatuses(itemStatuses);
  const hasOpenWork = counts.pending + counts.claimed > 0;

  if (counts.outcomeUnknown > 0) {
    return "needs_reconciliation";
  }
  if (hasOpenWork) {
    return cancelRequested ? "cancelled" : "running";
  }
  // An explicit user cancellation names the operation even when some items
  // completed first; the completed/failed breakdown stays visible in counts.
  if (cancelRequested) {
    return "cancelled";
  }
  if (counts.failed > 0 && counts.completed + counts.noop + counts.partial > 0) {
    return "partially_succeeded";
  }
  if (counts.failed > 0) {
    return "failed";
  }
  if (counts.partial > 0) {
    return "partially_succeeded";
  }
  return "succeeded";
}

export interface OperationItemCounts {
  readonly completed: number;
  readonly failed: number;
  readonly unresolved: number;
  readonly pending: number;
  readonly cancelled: number;
}

/**
 * UI/tool counts (design §7): `completed` includes proven no-ops and
 * partial item successes; `unresolved` covers unknown outcomes and any
 * item still claimed/pending; forward recipient counts are tracked
 * separately on items and never mixed in here.
 */
export function countItemsForDisplay(
  itemStatuses: readonly EmailOrganizationItemStatus[]
): OperationItemCounts {
  const counts = countItemStatuses(itemStatuses);
  return {
    completed: counts.completed + counts.noop + counts.partial,
    failed: counts.failed,
    unresolved: counts.outcomeUnknown + counts.claimed,
    pending: counts.pending,
    cancelled: counts.cancelled,
  };
}

function countItemStatuses(
  itemStatuses: readonly EmailOrganizationItemStatus[]
): {
  pending: number;
  claimed: number;
  completed: number;
  partial: number;
  noop: number;
  failed: number;
  cancelled: number;
  outcomeUnknown: number;
} {
  const counts = {
    pending: 0,
    claimed: 0,
    completed: 0,
    partial: 0,
    noop: 0,
    failed: 0,
    cancelled: 0,
    outcomeUnknown: 0,
  };
  for (const status of itemStatuses) {
    switch (status) {
      case "pending":
        counts.pending += 1;
        break;
      case "claimed":
        counts.claimed += 1;
        break;
      case "succeeded":
        counts.completed += 1;
        break;
      case "partially_succeeded":
        counts.partial += 1;
        break;
      case "noop":
        counts.noop += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
      case "outcome_unknown":
        counts.outcomeUnknown += 1;
        break;
    }
  }
  return counts;
}

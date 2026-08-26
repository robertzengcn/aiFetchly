/**
 * Shared type definitions for the Subscription Entitlement Reconciliation feature.
 *
 * These types are consumed by `SubscriptionEntitlementService` (main process),
 * the IPC layer, the renderer composable, and tests. They are pure data
 * shapes — no runtime behavior lives here.
 *
 * Source: docs/prd/subscription-entitlement-reconciliation-technical-design.md §5
 *
 * Design constraints:
 * - Type-only file (no main-process imports) so it can be imported from both
 *   main and renderer without pulling Electron into the bundle.
 * - Reuses {@link UserPlanType} for plan entries; no new plan shape.
 */

import type { UserPlanType } from "@/entityTypes/userType";

/**
 * Triggers that may request an entitlement reconciliation.
 *
 * Each value is logged with the reconcile result so support can trace why a
 * GET /api/user/info was issued. See PRD FR-1.6.
 */
export const ENTITLEMENT_TRIGGERS = [
  "startup",
  "login",
  "pricing",
  "focus",
  "token_refresh",
  "ws_connect",
  "ws_notify",
  "gated_feature",
  "manual",
] as const;

export type EntitlementTrigger = (typeof ENTITLEMENT_TRIGGERS)[number];

/**
 * A normalized snapshot of the local entitlement cache at one point in time.
 *
 * Used to compare previous vs new state after a `GET /api/user/info` so the
 * renderer is only notified when something actually changed.
 */
export interface EntitlementSnapshot {
  /** Raw plan entries from the Token store (may be empty for Community). */
  readonly plans: ReadonlyArray<UserPlanType>;
  /** Whether hosted AI features are unlocked for this snapshot. */
  readonly aiEnabled: boolean;
  /** Derived active plan names, joined for logging only. */
  readonly planNames: readonly string[];
}

/**
 * Why a reconcile returned the result it did. Absent when `ok` is true and
 * the call was not skipped/coalesced.
 */
export type EntitlementFailReason =
  | "network"
  | "auth"
  | "in_flight_shared"
  | "cooldown";

/**
 * Outcome of a single {@link SubscriptionEntitlementService.reconcile} call.
 *
 * - `ok: false` + `failReason: "network"` → cache untouched (PRD FR-1.3).
 * - `skipped: true` → cooldown or coalesced with an in-flight call; the caller
 *   awaited the shared promise but did not initiate a new GET.
 */
export interface EntitlementReconcileResult {
  readonly ok: boolean;
  readonly changed: boolean;
  readonly skipped: boolean;
  readonly trigger: EntitlementTrigger;
  readonly snapshot: EntitlementSnapshot;
  readonly previous: EntitlementSnapshot;
  readonly failReason?: EntitlementFailReason;
}

/**
 * Optional arguments to {@link SubscriptionEntitlementService.reconcile}.
 */
export interface ReconcileOptions {
  /** WebSocket notify type, attached to the renderer event when `reason === "ws_notify"`. */
  readonly notificationType?: string;
  /** Bypass cooldowns. Pricing retries and ws_notify use this. */
  readonly force?: boolean;
}

/**
 * Main → renderer broadcast payload. Validated with Zod before send.
 *
 * Sent on the `USER_INFO_UPDATED` channel only when entitlement changed.
 * See technical design §5.4.
 */
export interface UserInfoUpdatedEvent {
  /** Why this reconcile ran. */
  readonly reason: EntitlementTrigger;
  /** WS notify type, present when `reason === "ws_notify"`. */
  readonly notificationType?: string;
  /** The new plan set from /api/user/info. */
  readonly plans: ReadonlyArray<UserPlanType>;
  /** Whether hosted AI is unlocked after this reconcile. */
  readonly aiEnabled: boolean;
  /** Whether the snapshot differed from the previous one. */
  readonly changed: boolean;
}

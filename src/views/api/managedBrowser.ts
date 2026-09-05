import { windowInvoke } from "@/views/utils/apirequest";
import {
  MANAGED_BROWSER_LIST_ELIGIBLE_ACCOUNTS,
  MANAGED_BROWSER_LIST_ACTIVE,
  MANAGED_BROWSER_START,
  MANAGED_BROWSER_STATUS,
  MANAGED_BROWSER_HANDOFF,
  MANAGED_BROWSER_VERIFY_MANUAL_LOGIN,
  MANAGED_BROWSER_RESUME,
  MANAGED_BROWSER_STOP,
  MANAGED_BROWSER_APPROVE,
  MANAGED_BROWSER_EXTEND_HANDOFF,
  MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS,
  MANAGED_BROWSER_GET_CACHE_STATUS,
  MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION,
  MANAGED_BROWSER_CLEAR_CACHE,
} from "@/config/channellist";
import type {
  EffectiveManagedBrowserSettings,
  SafeManagedBrowserCacheClearResult,
  SafeManagedBrowserCacheStatus,
  SafeManagedBrowserStatus,
} from "@/entityTypes/managedBrowserTypes";

/**
 * Managed-browser frontend API (design §22). The renderer only ever sends
 * account ids, session ids, UI decisions, and confirmation tokens — the Zod
 * schemas on the main-process side reject anything else.
 */

export interface EligibleManagedBrowserAccount {
  readonly accountId: number;
  readonly platformId: number;
  readonly accountLabel: string;
}

export async function listEligibleAccounts(): Promise<
  EligibleManagedBrowserAccount[]
> {
  return await windowInvoke(MANAGED_BROWSER_LIST_ELIGIBLE_ACCOUNTS, {});
}

export async function listActiveSessions(): Promise<
  SafeManagedBrowserStatus[]
> {
  return await windowInvoke(MANAGED_BROWSER_LIST_ACTIVE, {});
}

export async function startManagedBrowser(input: {
  accountId: number;
  purpose: string;
  requestedStartUrl?: string;
  conversationId?: string;
}): Promise<SafeManagedBrowserStatus> {
  return await windowInvoke(MANAGED_BROWSER_START, input);
}

export async function getManagedBrowserStatus(
  sessionId: string
): Promise<SafeManagedBrowserStatus | null> {
  return await windowInvoke(MANAGED_BROWSER_STATUS, { sessionId });
}

export async function requestHandoff(sessionId: string): Promise<SafeManagedBrowserStatus> {
  return await windowInvoke(MANAGED_BROWSER_HANDOFF, { sessionId });
}

export async function verifyManualLogin(
  sessionId: string
): Promise<SafeManagedBrowserStatus> {
  return await windowInvoke(MANAGED_BROWSER_VERIFY_MANUAL_LOGIN, {
    sessionId,
  });
}

export async function resumeAfterHandoff(
  sessionId: string
): Promise<SafeManagedBrowserStatus> {
  return await windowInvoke(MANAGED_BROWSER_RESUME, { sessionId });
}

export async function stopManagedBrowser(
  sessionId: string,
  reason: "user_stop" | "cancelled" | "shutdown" = "user_stop"
): Promise<SafeManagedBrowserStatus> {
  return await windowInvoke(MANAGED_BROWSER_STOP, { sessionId, reason });
}

export async function approveBrowserAction(input: {
  sessionId: string;
  requestId: string;
  decision: "approve" | "deny";
}): Promise<{ recorded: boolean }> {
  return await windowInvoke(MANAGED_BROWSER_APPROVE, input);
}

export async function extendHandoff(
  sessionId: string,
  extendMinutes: number
): Promise<SafeManagedBrowserStatus> {
  return await windowInvoke(MANAGED_BROWSER_EXTEND_HANDOFF, {
    sessionId,
    extendMinutes,
  });
}

export async function getEffectiveBrowserSettings(): Promise<EffectiveManagedBrowserSettings> {
  return await windowInvoke(MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS, {});
}

export async function getCacheStatus(input: {
  scope: "account" | "all";
  accountId?: number;
}): Promise<SafeManagedBrowserCacheStatus | null> {
  return await windowInvoke(MANAGED_BROWSER_GET_CACHE_STATUS, input);
}

/**
 * Two-step clear (design §13.8): request the confirmation first, show the
 * size/impact dialog, then clear with the returned single-use id.
 */
export async function issueClearConfirmation(input: {
  scope: "account" | "all";
  accountId?: number;
}): Promise<{ confirmationId: string }> {
  return await windowInvoke(MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION, input);
}

export async function clearCache(input: {
  scope: "account";
  accountId: number;
  activeSessionDecision: "stop_and_clear" | "defer" | "cancel";
  confirmationId: string;
}): Promise<SafeManagedBrowserCacheClearResult>;
export async function clearCache(input: {
  scope: "all";
  activeSessionDecision: "stop_and_clear" | "skip_active" | "cancel";
  confirmationId: string;
}): Promise<SafeManagedBrowserCacheClearResult>;
export async function clearCache(input: {
  scope: "account" | "all";
  accountId?: number;
  activeSessionDecision: "stop_and_clear" | "defer" | "skip_active" | "cancel";
  confirmationId: string;
}): Promise<SafeManagedBrowserCacheClearResult> {
  return await windowInvoke(MANAGED_BROWSER_CLEAR_CACHE, input);
}

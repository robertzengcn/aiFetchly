import { SearchResult } from "./types";
import { ItemSearchparam } from "@/entityTypes/commonType";
import {
  windowInvoke,
  windowSend,
  windowReceive,
} from "@/views/utils/apirequest";
import {
  SocialAccountDetailData,
  SoASuccessEntity,
  SoADeleteResp,
  SocialLoginParam,
  SocialAccountListData,
} from "@/entityTypes/socialaccount-type";
import {
  SOCIALACCOUNTlIST,
  SOCIAL_ACCOUNT_LOGIN,
  SOCIALACCOUNTSAVE,
  SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES,
  SOCIAL_ACCOUNT_CLEAN_COOKIES,
  SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE,
  SOCIAL_ACCOUNT_SESSION_METADATA,
  SOCIAL_ACCOUNT_BROWSER_IMPORT_AVAILABILITY,
  SOCIAL_ACCOUNT_BROWSER_IMPORT_START,
  SOCIAL_ACCOUNT_BROWSER_IMPORT_CANCEL,
  SOCIAL_ACCOUNT_BROWSER_IMPORT_EVENT,
} from "@/config/channellist";
import {
  RequireCookiesParam,
  RequireCookiesMsgbox,
} from "@/entityTypes/cookiesType";

// Renderer-local return types for the secure-session / browser-import APIs.
// Kept here (not imported from src/schemas) so the renderer bundle does not pull
// in zod. These mirror the main-process contracts in src/schemas/accountCookies.ts
// and BrowserImportCoordinator.ts and must never include cookie values/names.
export type SessionStatus =
  | "available"
  | "missing"
  | "invalid"
  | "migration_pending";
export interface AccountSessionMetadata {
  hasCookies: boolean;
  cookieCount: number;
  lastUpdatedAt: string | null;
  importSource: "manual_login" | "netscape_file" | "browser_profile" | null;
  sessionStatus: SessionStatus;
}
export interface BrowserImportAvailability {
  enabled: boolean;
  platformId?: number;
  platformName?: string;
  approvedDomains?: string[];
  verificationUrl?: string;
  reason?: "feature_disabled" | "platform_unsupported" | "account_not_found";
}
export interface PairingInfo {
  requestId: string;
  expiresAtMs: number;
  approvedDomains: string[];
  verificationUrl: string;
}

export async function getSocialAccountlist(
  data: ItemSearchparam
): Promise<SearchResult<SocialAccountListData>> {
  const resp = await windowInvoke(SOCIALACCOUNTlIST, data);

  if (!resp) {
    throw new Error("unknow error");
  }

  const resdata: SearchResult<SocialAccountListData> = {
    data: resp.records,
    total: resp.total,
  };
  return resdata;
}
//get social account detail
export async function getSocialaccountinfo(
  id: number
): Promise<SocialAccountDetailData> {
  const resp = await windowInvoke("socialaccount:detail", { id: id });
  console.log(resp);
  if (!resp) {
    throw new Error("unknow error");
  }

  return resp;
}
//save social account
export async function saveSocialAccount(
  soc: SocialAccountDetailData
): Promise<SoASuccessEntity> {
  const resp = await windowInvoke(SOCIALACCOUNTSAVE, soc);
  return resp;
}
//delete social account
export async function deleteSocialAccount(id: number): Promise<SoADeleteResp> {
  const resp = await windowInvoke("socialaccount:delete", { id: id });
  return resp;
}
export function socialaccountLogin(data: RequireCookiesMsgbox) {
  windowSend(SOCIAL_ACCOUNT_LOGIN, data);
}
export function receiveAccountLoginevent(
  channel: string,
  cb: (data: any) => void
) {
  windowReceive(channel, cb);
}
export async function requireCookiesselecttab(data: RequireCookiesParam) {
  await windowSend(SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES, data);
}
export async function cleanCookies(data: RequireCookiesParam) {
  await windowSend(SOCIAL_ACCOUNT_CLEAN_COOKIES, data);
}
export async function showPlatformpage(data: RequireCookiesParam) {
  await windowSend(SOCIAL_ACCOUNT_SHOW_PLATFORMPAGE, data);
}

// ---- Secure session metadata + browser-profile import (validated invoke) ----

/** Renderer-safe session metadata (no cookie values). */
export async function getSessionMetadata(
  id: number
): Promise<AccountSessionMetadata> {
  return windowInvoke(SOCIAL_ACCOUNT_SESSION_METADATA, { id });
}

/** Whether browser-profile import is offered for this account. */
export async function getBrowserImportAvailability(
  id: number
): Promise<BrowserImportAvailability> {
  return windowInvoke(SOCIAL_ACCOUNT_BROWSER_IMPORT_AVAILABILITY, { id });
}

/** Start pairing (requires explicit user confirmation). */
export async function startBrowserPairing(id: number): Promise<PairingInfo> {
  return windowInvoke(SOCIAL_ACCOUNT_BROWSER_IMPORT_START, {
    id,
    confirmed: true,
  });
}

/** Cancel a pending pairing request. */
export async function cancelBrowserImport(
  requestId: string
): Promise<{ cancelled: boolean }> {
  return windowInvoke(SOCIAL_ACCOUNT_BROWSER_IMPORT_CANCEL, { requestId });
}

/** Subscribe to main->renderer import events (progress / terminal result). */
export function receiveBrowserImportEvent(cb: (data: unknown) => void): void {
  windowReceive(SOCIAL_ACCOUNT_BROWSER_IMPORT_EVENT, cb);
}

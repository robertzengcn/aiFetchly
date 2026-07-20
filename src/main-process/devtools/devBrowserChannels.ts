"use strict";
/**
 * Dev Browser Bridge channel allowlists.
 *
 * The bridge is a development-only path that lets a normal browser drive the
 * real Electron main process. Because it is reachable from a browser context,
 * the set of channels it will dispatch MUST be explicitly reviewed and kept
 * small. Nothing is exposed "because preload exposes it" — every entry here is
 * a deliberate, reviewed decision.
 *
 * Selection rules (see docs/prd/dev-browser-ui-testing-technical-design.md
 * §12 Security Model):
 *   - Read-only first. No file, credential, cookie, login, or automation channels.
 *   - No channel that launches child processes or automation.
 *   - No channel that reads/writes arbitrary local files.
 *
 * High-risk categories that MUST stay blocked until separately reviewed:
 *   - local file reads/writes & file dialogs      (SHOW_OPEN_DIALOG, GET_FILE_STATS, ...)
 *   - plugin import / install / uninstall         (PLUGIN_*, EXTRAMODULECHANNE_*)
 *   - system dependency install                   (SYSTEM_DEPENDENCY_INSTALL)
 *   - credential / cookie flows                   (*_LOGIN_UPLOADCOOKIES, ...)
 *   - task execution that launches automation     (task:run, START_CONTACT_EXTRACTION, ...)
 *   - AI file tools / shell-like operations       (AI_FILE_OPEN, AI_FILE_OPERATION)
 */
import {
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_DELETE,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_UPDATE,
  GET_APP_INFO,
  GET_LOGIN_URL,
  NATIVATECOMMAND,
  QUERY_USER_INFO,
  SYSTEM_MESSAGE,
  LOGIN_STATUS,
} from "@/config/channellist";

/**
 * Invoke (request/response) channels the dev browser bridge may dispatch.
 *
 * MVP scope: read-only app/user channels, the reviewed desktop-login URL
 * bootstrap, and typed subagent management channels used by the Subagents
 * settings page. GET_LOGIN_URL starts the same localhost PKCE handoff used by
 * the Electron IPC path; it returns only a URL and never exposes stored tokens.
 */
export const DEV_BROWSER_INVOKE_ALLOWLIST = Object.freeze([
  GET_APP_INFO,
  QUERY_USER_INFO,
  GET_LOGIN_URL,
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_UPDATE,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_DELETE,
] as const);

/**
 * Main->renderer event channels the bridge will relay to browser clients.
 *
 * Kept smaller than the preload `receive` allowlist on purpose: streaming
 * channels (AI chat chunks, scraper progress) are deferred until the base
 * request/response bridge is stable (PRD FR-5.4).
 */
export const DEV_BROWSER_EVENT_ALLOWLIST = Object.freeze([
  SYSTEM_MESSAGE,
  LOGIN_STATUS,
  NATIVATECOMMAND,
] as const);

/** True iff an invoke channel is on the reviewed allowlist. */
export function isInvokeAllowed(channel: string): boolean {
  return DEV_BROWSER_INVOKE_ALLOWLIST.includes(channel as typeof DEV_BROWSER_INVOKE_ALLOWLIST[number]);
}

/** True iff an event channel is on the reviewed allowlist. */
export function isEventAllowed(channel: string): boolean {
  return DEV_BROWSER_EVENT_ALLOWLIST.includes(channel as typeof DEV_BROWSER_EVENT_ALLOWLIST[number]);
}

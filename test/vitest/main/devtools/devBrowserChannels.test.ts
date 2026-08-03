"use strict";
import { describe, expect, it } from "vitest";
import {
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_DELETE,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_UPDATE,
  AI_ARTIFACT_GET,
  AI_ARTIFACT_LIST,
  GET_APP_INFO,
  QUERY_USER_INFO,
  SHOW_OPEN_DIALOG,
  OPENDIRECTORY,
  PLUGIN_IMPORT,
  PLUGIN_INSTALL_FROM_SOURCE,
  SYSTEM_DEPENDENCY_INSTALL,
  GET_LOGIN_URL,
  SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES,
  START_CONTACT_EXTRACTION,
  AI_FILE_OPEN,
  SYSTEM_MESSAGE,
  LOGIN_STATUS,
  NATIVATECOMMAND,
  AI_CHAT_V2_STREAM_CHUNK,
} from "@/config/channellist";
import {
  DEV_BROWSER_INVOKE_ALLOWLIST,
  DEV_BROWSER_EVENT_ALLOWLIST,
  isInvokeAllowed,
  isEventAllowed,
} from "@/main-process/devtools/devBrowserChannels";

// `task:run` is a legacy literal channel (not an exported const).
const TASK_RUN_CHANNEL = "task:run";

describe("devBrowserChannels — invoke allowlist", () => {
  it("includes the PRD-named MVP read-only channels", () => {
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(GET_APP_INFO);
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(QUERY_USER_INFO);
  });

  it("includes the reviewed desktop-login URL bootstrap channel", () => {
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(GET_LOGIN_URL);
    expect(isInvokeAllowed(GET_LOGIN_URL)).toBe(true);
  });

  it("includes reviewed subagent management channels for browser QA", () => {
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AGENT_MANAGEMENT_LIST);
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AGENT_MANAGEMENT_GET);
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AGENT_MANAGEMENT_CREATE);
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AGENT_MANAGEMENT_UPDATE);
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AGENT_MANAGEMENT_TOGGLE);
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AGENT_MANAGEMENT_DELETE);
  });

  it("includes reviewed AI artifact read channels for browser preview", () => {
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AI_ARTIFACT_GET);
    expect(DEV_BROWSER_INVOKE_ALLOWLIST).toContain(AI_ARTIFACT_LIST);
    expect(isInvokeAllowed(AI_ARTIFACT_GET)).toBe(true);
    expect(isInvokeAllowed(AI_ARTIFACT_LIST)).toBe(true);
  });

  it("isInvokeAllowed returns true only for listed channels", () => {
    expect(isInvokeAllowed(GET_APP_INFO)).toBe(true);
    expect(isInvokeAllowed(QUERY_USER_INFO)).toBe(true);
    expect(isInvokeAllowed(AGENT_MANAGEMENT_CREATE)).toBe(true);
    expect(isInvokeAllowed(AI_ARTIFACT_GET)).toBe(true);
    expect(isInvokeAllowed("unknown:channel")).toBe(false);
  });

  it("blocks high-risk channel categories by omission", () => {
    // File access / dialogs
    expect(isInvokeAllowed(SHOW_OPEN_DIALOG)).toBe(false);
    expect(isInvokeAllowed(OPENDIRECTORY)).toBe(false);
    // Plugin install
    expect(isInvokeAllowed(PLUGIN_IMPORT)).toBe(false);
    expect(isInvokeAllowed(PLUGIN_INSTALL_FROM_SOURCE)).toBe(false);
    // System dependency install
    expect(isInvokeAllowed(SYSTEM_DEPENDENCY_INSTALL)).toBe(false);
    // Credential / cookie import
    expect(isInvokeAllowed(SOCIAL_ACCOUNT_LOGIN_UPLOADCOOKIES)).toBe(false);
    // Automation task execution
    expect(isInvokeAllowed(TASK_RUN_CHANNEL)).toBe(false);
    expect(isInvokeAllowed(START_CONTACT_EXTRACTION)).toBe(false);
    // AI file tools
    expect(isInvokeAllowed(AI_FILE_OPEN)).toBe(false);
  });

  it("allowlist is frozen / immutable", () => {
    expect(Object.isFrozen(DEV_BROWSER_INVOKE_ALLOWLIST)).toBe(true);
  });
});

describe("devBrowserChannels — event allowlist", () => {
  it("isEventAllowed returns true only for listed event channels", () => {
    expect(DEV_BROWSER_EVENT_ALLOWLIST.length).toBeGreaterThan(0);
    for (const ch of DEV_BROWSER_EVENT_ALLOWLIST) {
      expect(isEventAllowed(ch)).toBe(true);
    }
    // High-volume streaming channels are NOT in the MVP event allowlist.
    expect(isEventAllowed(AI_CHAT_V2_STREAM_CHUNK)).toBe(false);
    expect(isEventAllowed("not-an-event-channel")).toBe(false);
  });

  it("includes common safe main->renderer event channels", () => {
    expect(DEV_BROWSER_EVENT_ALLOWLIST).toContain(SYSTEM_MESSAGE);
    expect(DEV_BROWSER_EVENT_ALLOWLIST).toContain(LOGIN_STATUS);
    expect(DEV_BROWSER_EVENT_ALLOWLIST).toContain(NATIVATECOMMAND);
  });

  it("allowlist is frozen / immutable", () => {
    expect(Object.isFrozen(DEV_BROWSER_EVENT_ALLOWLIST)).toBe(true);
  });
});

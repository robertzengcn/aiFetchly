import { describe, expect, it } from "vitest";

import {
  browserActionProgramSchema,
  isWithinWorkerMessageLimit,
  managedBrowserInboundSchema,
  managedBrowserOutboundSchema,
  serializedMessageBytes,
} from "@/schemas/worker/managedBrowser";
import {
  managedBrowserClearCacheInputSchema,
  managedBrowserGetCacheStatusInputSchema,
} from "@/schemas/ipc/managedBrowser";
import {
  browserNavigateToolSchema,
  browserRunActionsToolSchema,
  browserStartSessionToolSchema,
} from "@/schemas/aiTools/managedBrowser";
import { MANAGED_BROWSER_ACTION_LIMITS } from "@/config/managedBrowser";

const base = {
  protocolVersion: 1,
  sessionId: "mb_7f2abc123def",
  requestId: "req-0001",
  sequence: 0,
} as const;

const executable = {
  path: "/opt/chrome/chrome",
  source: "system",
  product: "chrome",
  version: "136.0.7103.94",
  majorVersion: 136,
  architecture: "x64",
} as const;

const launchPolicy = {
  headless: false,
  locale: null,
  timezoneId: null,
  viewport: { width: 1365, height: 768 },
  windowSize: { width: 1400, height: 900 },
  userAgentOverride: null,
  enabledStealthEvasions: ["chrome.runtime"],
  extraArgs: [],
} as const;

const storagePolicy = {
  temporaryProfilePath: "/tmp/aifetchly-managed-browser/mb_x/profile",
  persistentCache: { enabled: false, reasonCode: "cache_disabled_setting" },
} as const;

const platform = {
  platformId: 2,
  platformName: "youtube",
  loginUrl: "https://www.youtube.com",
  verificationUrl: "https://www.youtube.com/",
  allowedDomainSuffixes: ["youtube.com", "google.com", "accounts.google.com"],
} as const;

const cookie = {
  domain: "youtube.com",
  path: "/",
  name: "SID",
  value: "synthetic-secret-value",
  secure: true,
  httpOnly: true,
  expirationDate: 4102444800,
  sameSite: "no_restriction",
} as const;

const identity = {
  sessionId: "mb_7f2abc123def",
  sessionNonce: "nonce_12345678",
  workerPid: 4321,
  browserPid: 8765,
  executableSha256: "a".repeat(64),
  executableVersion: "136.0.7103.94",
  launchedAtEpochMs: 1770000000000,
};

const validStartSession = {
  ...base,
  type: "START_SESSION",
  executable,
  launchPolicy,
  storagePolicy,
  platform,
  proxy: { mode: "direct" },
  cookies: [cookie],
};

describe("worker inbound schema", () => {
  it("accepts a well-formed START_SESSION", () => {
    const result = managedBrowserInboundSchema().safeParse(validStartSession);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict) even inside START_SESSION", () => {
    const result = managedBrowserInboundSchema().safeParse({
      ...validStartSession,
      accountDisplayName: "attacker@x.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a cookie that misses required normalized fields", () => {
    const result = managedBrowserInboundSchema().safeParse({
      ...validStartSession,
      cookies: [{ domain: "youtube.com", name: "SID" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a wrong protocol version", () => {
    const result = managedBrowserInboundSchema().safeParse({
      ...validStartSession,
      protocolVersion: 2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a proxy with credentials in a malformed shape", () => {
    const result = managedBrowserInboundSchema().safeParse({
      ...validStartSession,
      proxy: { mode: "socks5", host: "p.example", port: 1080 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a session id without the mb_ prefix", () => {
    const result = managedBrowserInboundSchema().safeParse({
      ...validStartSession,
      sessionId: "8f2abc123def",
    });
    expect(result.success).toBe(false);
  });

  it("rejects RUN_ACTIONS with an over-limit program", () => {
    const actions = Array.from({ length: 26 }, (_, i) => ({
      type: "press_key",
      key: `k${i}`,
    }));
    const result = managedBrowserInboundSchema().safeParse({
      ...base,
      type: "RUN_ACTIONS",
      program: { actions },
    });
    expect(result.success).toBe(false);
  });
});

describe("browser action program schema", () => {
  it("accepts the P0 action set and enforces the per-program cap", () => {
    const ok = browserActionProgramSchema.safeParse({
      actions: [
        { type: "navigate", url: "https://www.youtube.com/feed/history" },
        { type: "wait_for", condition: "navigation", timeoutMs: 5000 },
        { type: "extract", refs: ["e_abc123"] },
      ],
    });
    expect(ok.success).toBe(true);

    const tooMany = browserActionProgramSchema.safeParse({
      actions: Array.from(
        { length: MANAGED_BROWSER_ACTION_LIMITS.maxActionsPerProgram + 1 },
        () => ({ type: "press_key", key: "a" })
      ),
    });
    expect(tooMany.success).toBe(false);
  });

  it("requires a page revision with reference-using actions", () => {
    const missing = browserActionProgramSchema.safeParse({
      actions: [{ type: "click", ref: "e_abc123" }],
    });
    expect(missing.success).toBe(false);

    const present = browserActionProgramSchema.safeParse({
      actions: [{ type: "click", ref: "e_abc123", pageRevision: 3 }],
    });
    expect(present.success).toBe(true);
  });

  it("rejects CSS-selector-looking refs", () => {
    const result = browserActionProgramSchema.safeParse({
      actions: [{ type: "click", ref: "div#login", pageRevision: 1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("worker outbound schema", () => {
  it("accepts WORKER_READY without a prior session sequence dependency", () => {
    const result = managedBrowserOutboundSchema().safeParse({
      protocolVersion: 1,
      type: "WORKER_READY",
      sessionId: "mb_7f2abc123def",
      requestId: "evt-boot",
      sequence: 0,
      workerPid: 4321,
    });
    expect(result.success).toBe(true);
  });

  it("accepts SESSION_READY with identity and assessment", () => {
    const result = managedBrowserOutboundSchema().safeParse({
      ...base,
      type: "SESSION_READY",
      fingerprintResult: "pass",
      fingerprintReasonCodes: [],
      appliedCookieCount: 1,
      rejectedCookieCount: 0,
      assessment: { state: "authenticated", evidenceCodes: ["avatar_visible"] },
      identity,
    });
    expect(result.success).toBe(true);
  });

  it("accepts REFRESHED_COOKIES as the second cookie-bearing message", () => {
    const result = managedBrowserOutboundSchema().safeParse({
      ...base,
      type: "REFRESHED_COOKIES",
      cookies: [cookie],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a heartbeat with an invalid lag bucket", () => {
    const result = managedBrowserOutboundSchema().safeParse({
      protocolVersion: 1,
      type: "WORKER_HEARTBEAT",
      sessionId: "mb_7f2abc123def",
      requestId: "evt-hb",
      sequence: 5,
      state: "running",
      lagBucket: "enormous",
      ts: 1770000000000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a WORKER_ERROR leaking a long stack trace as message", () => {
    const result = managedBrowserOutboundSchema().safeParse({
      ...base,
      type: "WORKER_ERROR",
      code: "internal_error",
      message: "x".repeat(301),
    });
    expect(result.success).toBe(false);
  });
});

describe("message size limits", () => {
  it("measures serialized bytes", () => {
    expect(serializedMessageBytes({ a: "aaa" })).toBeGreaterThan(0);
    expect(serializedMessageBytes(undefined)).toBeGreaterThanOrEqual(0);
  });

  it("bounds general messages to 2 MiB and screenshots to 8 MiB", () => {
    const small = { data: "x".repeat(1024) };
    expect(isWithinWorkerMessageLimit(small, "general")).toBe(true);

    const overGeneral = { data: "x".repeat(3 * 1024 * 1024) };
    expect(isWithinWorkerMessageLimit(overGeneral, "general")).toBe(false);
    expect(isWithinWorkerMessageLimit(overGeneral, "screenshot")).toBe(true);
  });
});

describe("IPC clear-cache schema rejects caller paths", () => {
  it("accepts a valid account-scoped clear request", () => {
    const result = managedBrowserClearCacheInputSchema().safeParse({
      scope: "account",
      accountId: 42,
      activeSessionDecision: "defer",
      confirmationId: "confirm-1234",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a smuggled filesystem path", () => {
    const result = managedBrowserClearCacheInputSchema().safeParse({
      scope: "account",
      accountId: 42,
      activeSessionDecision: "defer",
      confirmationId: "confirm-1234",
      path: "/home/user/.cache",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an all-scope request carrying an accountId form", () => {
    const result = managedBrowserClearCacheInputSchema().safeParse({
      scope: "all",
      accountId: 42,
      activeSessionDecision: "skip_active",
      confirmationId: "confirm-1234",
    });
    expect(result.success).toBe(false);
  });

  it("requires accountId for account-scope cache status", () => {
    expect(
      managedBrowserGetCacheStatusInputSchema().safeParse({ scope: "account" })
        .success
    ).toBe(false);
    expect(
      managedBrowserGetCacheStatusInputSchema().safeParse({
        scope: "account",
        accountId: 7,
      }).success
    ).toBe(true);
  });
});

describe("AI tool schemas", () => {
  it("start session takes an account id and purpose only", () => {
    expect(
      browserStartSessionToolSchema().safeParse({
        account_id: 9,
        purpose: "Reply to unanswered YouTube comments",
      }).success
    ).toBe(true);
    expect(
      browserStartSessionToolSchema().safeParse({
        account_id: 9,
        purpose: "x",
        cookies: [{ name: "SID" }],
      }).success
    ).toBe(false);
  });

  it("navigate requires a URL and session", () => {
    expect(
      browserNavigateToolSchema().safeParse({
        session_id: "mb_7f2abc123def",
        url: "https://www.youtube.com/",
      }).success
    ).toBe(true);
    expect(
      browserNavigateToolSchema().safeParse({
        session_id: "mb_7f2abc123def",
        url: "file:///etc/passwd",
      }).success
    ).toBe(false);
  });

  it("run actions requires the producing page revision", () => {
    const result = browserRunActionsToolSchema().safeParse({
      session_id: "mb_7f2abc123def",
      page_revision: 4,
      program: {
        actions: [{ type: "fill", ref: "e_abc123", pageRevision: 4, value: "hi" }],
      },
    });
    expect(result.success).toBe(true);
  });
});

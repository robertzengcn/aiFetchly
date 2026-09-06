import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  ManagedBrowserAiToolService,
  type BrowserModuleLike,
  type ManagedBrowserAiToolServiceDeps,
} from "@/service/ManagedBrowserAiToolService";
import { BrowserActionRiskClassifier } from "@/service/BrowserActionRiskClassifier";
import type { SafeManagedBrowserStatus } from "@/entityTypes/managedBrowserTypes";

/**
 * Managed-browser AI tool service (design §15/§17): gate ORDER (AI enable →
 * browser settings → session → risk), safe error codes, credential routing
 * to handoff, approval enforcement, and sanitized results.
 */

const SESSION_ID = "mb_test000000001";

function status(
  overrides: Partial<SafeManagedBrowserStatus> = {}
): SafeManagedBrowserStatus {
  return {
    sessionId: SESSION_ID,
    accountId: 101,
    platformId: 2,
    accountLabel: "My Channel",
    platformLabel: "YouTube",
    state: "ready",
    currentOrigin: "https://www.youtube.com",
    pageTitle: "YouTube",
    pageRevision: 1,
    authenticated: true,
    handoffReason: null,
    handoffExpiresAtEpochMs: null,
    lastErrorCode: null,
    ...overrides,
  };
}

function makeModule(
  overrides: Partial<Record<keyof BrowserModuleLike, unknown>> = {}
): BrowserModuleLike {
  return {
    start: vi.fn(async () => status()),
    getLastObservation: vi.fn(() => null),
    notifyApprovalRequired: vi.fn(),
    getStatus: vi.fn((sessionId: string) =>
      sessionId === SESSION_ID ? status() : null
    ),
    observe: vi.fn(async () => ({
      sessionId: SESSION_ID,
      pageRevision: 2,
      url: "https://www.youtube.com",
      origin: "https://www.youtube.com",
      title: "YouTube",
      state: "ready",
      elements: [],
      visibleText: "page text",
      notices: [],
      truncated: false,
    })),
    runActions: vi.fn(async () => ({
      type: "ACTION_RESULT",
      effect: "known",
      pageRevision: 3,
      results: [
        {
          actionIndex: 0,
          type: "click",
          success: true,
          errorCode: null,
          elementFound: true,
          urlAfter: "https://www.youtube.com",
        },
      ],
      observation: null,
    })),
    captureScreenshot: vi.fn(async () => ({
      mimeType: "image/jpeg",
      base64: "x".repeat(64),
    })),
    evaluateScript: vi.fn(async () => ({
      ok: true,
      resultSummary: "{\"n\":1}",
      resultBytes: 7,
      truncated: false,
    })),
    requestHandoff: vi.fn(async () => status({ state: "handoff" })),
    resumeAfterHandoff: vi.fn(async () => status()),
    stop: vi.fn(async () => status({ state: "stopped" })),
    ...overrides,
  } as BrowserModuleLike;
}

function makeSettings(browserEnabled = true) {
  return {
    getEffectiveSettings: vi.fn(async () => ({
      browserEnabled,
      cacheEnabled: true,
      cacheMaxBytes: 500 * 1024 * 1024,
      clearCacheOnExit: false,
      disabledReasonCode: browserEnabled ? null : "user_setting_disabled",
    })),
  } as unknown as ManagedBrowserAiToolServiceDeps["settings"];
}

function makeService(overrides: {
  module?: BrowserModuleLike;
  browserEnabled?: boolean;
  aiEnabled?: boolean;
  cacheModule?: { clearCache: (input: unknown) => Promise<unknown> };
}) {
  return new ManagedBrowserAiToolService({
    browserModule: overrides.module ?? makeModule(),
    settings: makeSettings(overrides.browserEnabled ?? true),
    classifier: new BrowserActionRiskClassifier(),
    isAiEnabled: () => overrides.aiEnabled ?? true,
    cacheModule:
      overrides.cacheModule ??
      ({
        clearCache: vi.fn(async () => ({
          state: "cleared",
          scope: "account",
          approximateDeletedBytes: 1024,
          savedLoginSessionPreserved: true,
          reasonCode: null,
        })),
      } as unknown as ManagedBrowserAiToolServiceDeps["cacheModule"]),
  });
}

const CTX = { conversationId: "conv-1", toolCallId: "call-1" };

async function errorOf(p: Promise<unknown>): Promise<{
  code: string;
  riskClass?: string;
  reasonCode?: string;
}> {
  try {
    await p;
  } catch (error) {
    return error as { code: string; riskClass?: string; reasonCode?: string };
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gate order", () => {
  it("rejects with ai_disabled BEFORE any other work when AI is off", async () => {
    const module = makeModule();
    const service = makeService({ module, aiEnabled: false });
    const err = await errorOf(
      service.startSession({ account_id: 101, purpose: "x" }, CTX)
    );
    expect(err.code).toBe("ai_disabled");
    expect(module.start).not.toHaveBeenCalled();
  });

  it("rejects with managed_browser_disabled when the setting is off", async () => {
    const module = makeModule();
    const settings = makeSettings(false);
    const service = new ManagedBrowserAiToolService({
      browserModule: module,
      settings,
      isAiEnabled: () => true,
    });
    const err = await errorOf(
      service.startSession({ account_id: 101, purpose: "x" }, CTX)
    );
    expect(err.code).toBe("managed_browser_disabled");
    expect(err.reasonCode).toBe("user_setting_disabled");
    expect(module.start).not.toHaveBeenCalled();
  });

  it("rejects unknown sessions with a safe code", async () => {
    const service = makeService({});
    const err = await errorOf(
      service.observe({ session_id: "mb_missing0000001" }, CTX)
    );
    expect(err.code).toBe("worker_exited");
    expect(err.reasonCode).toBe("no_active_session");
  });

  it("rejects invalid model arguments (strict schema)", async () => {
    const service = makeService({});
    const err = await errorOf(
      service.startSession({ account_id: 101, purpose: "x", path: "/etc" }, CTX)
    );
    expect(err.code).toBe("invalid_tool_arguments");
  });
});

describe("risk routing", () => {
  it("navigate to a credential URL triggers handoff and returns challenge_requires_handoff", async () => {
    const module = makeModule();
    const service = makeService({ module });
    const err = await errorOf(
      service.navigate({
        session_id: SESSION_ID,
        url: "https://accounts.google.com/login",
      })
    );
    expect(err.code).toBe("challenge_requires_handoff");
    expect(err.riskClass).toBe("credential_or_security");
    expect(module.requestHandoff).toHaveBeenCalledWith(
      SESSION_ID,
      "user_requested"
    );
    expect(module.runActions).not.toHaveBeenCalled();
  });

  it("consequential programs require approval unless consent was already granted", async () => {
    const module = makeModule();
    const service = makeService({ module });
    const program = {
      actions: [{ type: "click", ref: "e_abc", pageRevision: 1 }],
    };
    // The program-level registry confirmation covers ref-only clicks; a
    // credential URL inside the program still forces approval/handoff:
    const err = await errorOf(
      service.runActions(
        {
          session_id: SESSION_ID,
          page_revision: 1,
          program: {
            actions: [
              { type: "navigate", url: "https://x.com/settings/password" },
            ],
          },
        },
        CTX
      )
    );
    expect(err.code).toBe("challenge_requires_handoff");

    // With consent already granted, ordinary programs execute.
    const result = await service.runActions(
      {
        session_id: SESSION_ID,
        page_revision: 1,
        program,
      },
      { ...CTX, skipPermissionCheck: true }
    );
    expect(result.effect).toBe("known");
    expect(module.runActions).toHaveBeenCalledWith(SESSION_ID, program);
  });
});

describe("sanitized results", () => {
  it("observation payloads carry the untrusted-content notice", async () => {
    const service = makeService({});
    const result = await service.observe({ session_id: SESSION_ID }, CTX);
    expect(result.contentNotice).toContain("untrusted_page_content");
  });

  it("action results expose per-step outcomes and the notice, never raw extras", async () => {
    const service = makeService({});
    const result = await service.runActions(
      {
        session_id: SESSION_ID,
        page_revision: 1,
        program: { actions: [{ type: "scroll", direction: "down", amount: 10 }] },
      },
      { ...CTX, skipPermissionCheck: true }
    );
    expect(result.pageRevision).toBe(3);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.contentNotice).toContain("untrusted_page_content");
  });

  it("screenshots return metadata only — never the base64 bytes", async () => {
    const service = makeService({});
    const result = await service.captureScreenshot({ session_id: SESSION_ID });
    expect(result.captured).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    expect(String(JSON.stringify(result)).includes("base64")).toBe(false);
  });
});

describe("GAP-01 resolved-target approval", () => {
  const OBSERVATION = {
    sessionId: SESSION_ID,
    pageRevision: 4,
    url: "https://www.youtube.com/upload",
    origin: "https://www.youtube.com",
    title: "Upload",
    state: "ready",
    elements: [
      { ref: "e_pub", role: "button", name: "Publish", disabled: false },
      { ref: "e_title", role: "textbox", name: "Title", disabled: false },
    ],
    visibleText: "",
    notices: [],
    truncated: false,
  };

  function moduleWithObservation() {
    const module = makeModule();
    (module.getLastObservation as ReturnType<typeof vi.fn>).mockImplementation(
      () => OBSERVATION
    );
    return module;
  }

  it("requires approval when the RESOLVED target is consequential (opaque ref)", async () => {
    const module = moduleWithObservation();
    const service = makeService({ module });
    const err = await errorOf(
      service.runActions(
        {
          session_id: SESSION_ID,
          page_revision: 4,
          program: { actions: [{ type: "click", ref: "e_pub", pageRevision: 4 }] },
        },
        CTX
      )
    );
    expect(err.code).toBe("approval_required");
    expect(err.riskClass).toBe("consequential_write");
    expect(module.runActions).not.toHaveBeenCalled();
    // The renderer approval request carries the resolved target name.
    expect(module.notifyApprovalRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        riskClass: "consequential_write",
        contentSummary: expect.stringContaining("Publish"),
      })
    );
  });

  it("attests expected fingerprints and executes once consent was granted", async () => {
    const module = moduleWithObservation();
    const service = makeService({ module });
    const result = await service.runActions(
      {
        session_id: SESSION_ID,
        page_revision: 4,
        program: { actions: [{ type: "click", ref: "e_title", pageRevision: 4 }] },
      },
      { ...CTX, skipPermissionCheck: true }
    );
    expect(result.effect).toBe("known");
    expect(module.runActions).toHaveBeenCalledWith(SESSION_ID, {
      actions: [
        {
          type: "click",
          ref: "e_title",
          pageRevision: 4,
          expectedRole: "textbox",
          expectedName: "Title",
        },
      ],
    });
  });

  it("a full-access grant still cannot bypass consequential approval", async () => {
    const module = moduleWithObservation();
    const service = makeService({ module });
    // skipPermissionCheck ONLY arrives from a real permission grant for the
    // exact approved program; absent it, even session-level consent fails.
    const err = await errorOf(
      service.runActions(
        {
          session_id: SESSION_ID,
          page_revision: 4,
          program: { actions: [{ type: "click", ref: "e_pub", pageRevision: 4 }] },
        },
        CTX
      )
    );
    expect(err.code).toBe("approval_required");
  });
});

describe("clear cache", () => {
  it("clears with the user-issued confirmation id and defers on active scopes", async () => {
    const clearCache = vi.fn(async () => ({
      state: "cleared",
      scope: "account",
      approximateDeletedBytes: 2048,
      savedLoginSessionPreserved: true,
      reasonCode: null,
    }));
    const service = makeService({ cacheModule: { clearCache } });
    const result = await service.clearCache({
      session_id: SESSION_ID,
      confirmation_id: "conf-1234-abcd",
    });
    expect(clearCache).toHaveBeenCalledWith({
      scope: "account",
      accountId: 101,
      activeSessionDecision: "defer",
      confirmationId: "conf-1234-abcd",
    });
    expect(result.state).toBe("cleared");
  });

  it("surfaces approval_required when the confirmation id is unknown", async () => {
    const clearCache = vi.fn(async () => {
      throw Object.assign(new Error("approval_required"), {
        code: "approval_required",
      });
    });
    const service = makeService({ cacheModule: { clearCache } });
    const err = await errorOf(
      service.clearCache({
        session_id: SESSION_ID,
        confirmation_id: "never-issued",
      })
    );
    expect(err.code).toBe("approval_required");
  });
});


describe("GAP-12 privileged page-context script", () => {
  const ARGS = {
    session_id: SESSION_ID,
    source: "document.querySelectorAll('a').length",
    purpose: "count links",
    page_revision: 2,
  };

  it("ALWAYS requires approval — no permission mode may skip it", async () => {
    const module = makeModule();
    const service = makeService({ module });
    const err = await errorOf(service.evaluateScript(ARGS, CTX));
    expect(err.code).toBe("approval_required");
    expect(err.riskClass).toBe("privileged_script");
    expect(module.evaluateScript).not.toHaveBeenCalled();
    // The approval request shows the source size + purpose for review.
    expect(module.notifyApprovalRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        riskClass: "privileged_script",
        contentSummary: expect.stringContaining("count links"),
      })
    );
  });

  it("executes with consent and returns redacted, budgeted results", async () => {
    const module = makeModule();
    const service = makeService({ module });
    const result = await service.evaluateScript(ARGS, {
      ...CTX,
      skipPermissionCheck: true,
    });
    expect(result.ok).toBe(true);
    expect(module.evaluateScript).toHaveBeenCalledWith(SESSION_ID, {
      source: ARGS.source,
      timeoutMs: 5000,
    });
    expect(String(result.sourceHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(result.contentNotice).toContain("untrusted_page_content");
  });

  it("rejects oversized or malformed model arguments", async () => {
    const service = makeService({});
    const err = await errorOf(
      service.evaluateScript(
        { ...ARGS, source: "x".repeat(20_001) },
        CTX
      )
    );
    expect(err.code).toBe("invalid_tool_arguments");
  });
});

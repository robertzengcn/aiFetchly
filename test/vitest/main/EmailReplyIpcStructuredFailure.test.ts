import { describe, it, expect, vi, beforeEach } from "vitest";

// B12 acceptance: exercise the REAL IPC wrapper (registerValidatedHandler /
// registerAiValidatedHandler -> dispatchValidated) end-to-end, not a mocked
// service. We capture ipcMain.handle registrations in a Map and invoke them
// directly, so the duck-typing catch in dispatchValidated is the code path
// under test. This is the pattern from registerValidatedHandler.test.ts.

// Capture registered handlers per channel for direct invocation.
const handlers = new Map<
  string,
  (event: unknown, arg: unknown) => Promise<unknown>
>();

// Mock electron BEFORE importing the wrapper.
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, h: (...args: unknown[]) => unknown) => {
      handlers.set(channel, h as never);
    },
  },
}));

// Mock Logger to keep test output clean.
vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Token so the AI-enabled gate is deterministic. Default: enabled.
const tokenGetValue = vi.fn((key: string) =>
  key === "user_ai_enabled" ? "true" : "false"
);
vi.mock("@/modules/token", () => ({
  Token: class {
    constructor() {
      return { getValue: tokenGetValue };
    }
  },
}));

// Import AFTER mocks are in place.
import {
  registerValidatedHandler,
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import { StructuredIpcError } from "@/main-process/communication/_shared/StructuredIpcError";
import {
  SendPolicyRejection,
  SendBindingError,
} from "@/service/emailReply/EmailReplySendBinding";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  tokenGetValue.mockImplementation((key: string) =>
    key === "user_ai_enabled" ? "true" : "false"
  );
});

async function invoke(
  channel: string,
  arg: unknown
): Promise<{
  status: boolean;
  msg: string;
  data: unknown;
  code?: string;
  existing_draft_id?: number;
  next_action?: string;
  requestCorrelationId?: string;
}> {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler registered for ${channel}`);
  return (await h({}, arg)) as never;
}

describe("B12: dispatchValidated preserves structured failure fields", () => {
  it("carries code/existing_draft_id/next_action/requestCorrelationId from a StructuredIpcError", async () => {
    const schema = lazySchema(() => z.strictObject({ messageId: z.number() }));
    registerValidatedHandler("b12:structured", schema, async () => {
      // Mirrors the EMAIL_REPLY_DRAFT_CREATE handler's failure path: the
      // service returns a widened CreateDraftOutcome failure, the handler
      // throws StructuredIpcError carrying the typed fields.
      throw new StructuredIpcError(
        "[needs_human_review] Generation failed validation twice (2 codes)",
        {
          code: "needs_human_review",
          next_action: "await_human_review",
          requestCorrelationId: "erx-req-abc-1",
        }
      );
    });

    const res = await invoke("b12:structured", { messageId: 1 });
    expect(res.status).toBe(false);
    // Legacy fields intact (FR-033: safe fields survive unchanged).
    expect(res.msg).toContain("needs_human_review");
    expect(res.data).toBeNull();
    // Typed fields preserved through the duck-typing catch.
    expect(res.code).toBe("needs_human_review");
    expect(res.next_action).toBe("await_human_review");
    expect(res.requestCorrelationId).toBe("erx-req-abc-1");
    expect(res.existing_draft_id).toBeUndefined();
  });

  it("preserves existing_draft_id from a StructuredIpcError (reuse-audit persistence failure)", async () => {
    const schema = lazySchema(() => z.strictObject({ messageId: z.number() }));
    registerValidatedHandler("b12:reuse", schema, async () => {
      // B09/B10 path: a definitely-failed draft is reused, but persisting the
      // reuse audit fails. The code stays undefined (audit-persistence is not
      // a policy code), but existing_draft_id must survive so the renderer can
      // route the user to the existing draft.
      throw new StructuredIpcError(
        "Reuse audit persistence failed",
        {
          existing_draft_id: 77,
          next_action: "await_human_review",
          requestCorrelationId: "erx-req-abc-2",
        }
      );
    });

    const res = await invoke("b12:reuse", { messageId: 1 });
    expect(res.status).toBe(false);
    expect(res.msg).toBe("Reuse audit persistence failed");
    expect(res.data).toBeNull();
    // No typed code (audit-persistence is not a policy refusal), but the
    // existing draft id + correlation id survive.
    expect(res.code).toBeUndefined();
    expect(res.existing_draft_id).toBe(77);
    expect(res.next_action).toBe("await_human_review");
    expect(res.requestCorrelationId).toBe("erx-req-abc-2");
  });

  it("preserves the typed code from a SendPolicyRejection (pre-send refusal)", async () => {
    const schema = lazySchema(() =>
      z.strictObject({ draftId: z.number(), approvalToken: z.string() })
    );
    registerValidatedHandler("b12:send:policy", schema, async () => {
      // Mirrors the EMAIL_REPLY_SEND handler: typed errors propagate
      // unchanged (no try/catch reformatting), and dispatchValidated's catch
      // duck-types error.code into the envelope.
      throw new SendPolicyRejection(
        "Send rejected by policy: Message already has a sent reply",
        "already_replied"
      );
    });

    const res = await invoke("b12:send:policy", {
      draftId: 10,
      approvalToken: "tok",
    });
    expect(res.status).toBe(false);
    expect(res.msg).toContain("already has a sent reply");
    expect(res.data).toBeNull();
    expect(res.code).toBe("already_replied");
  });

  it("preserves the typed code from a SendBindingError (envelope mismatch)", async () => {
    const schema = lazySchema(() =>
      z.strictObject({ draftId: z.number(), approvalToken: z.string() })
    );
    registerValidatedHandler("b12:send:binding", schema, async () => {
      throw new SendBindingError(
        "Send rejected: approval is not bound to the draft's current revision",
        "approval_stale"
      );
    });

    const res = await invoke("b12:send:binding", {
      draftId: 11,
      approvalToken: "tok",
    });
    expect(res.status).toBe(false);
    expect(res.msg).toContain("approval is not bound");
    expect(res.data).toBeNull();
    expect(res.code).toBe("approval_stale");
  });

  it("yields a safe {status,msg,data:null} envelope with NO typed fields on an unexpected internal exception", async () => {
    // B12 acceptance: an unexpected plain throw (e.g. a NullPointer in a
    // transitive dependency) must still produce a safe envelope — legacy
    // fields intact, and NO typed code/next_action/requestCorrelationId
    // invented. The duck-typer returns {} for non-code errors.
    const schema = lazySchema(() => z.strictObject({ x: z.number() }));
    registerValidatedHandler("b12:plain-throw", schema, async () => {
      throw new Error("unexpected internal failure");
    });

    const res = await invoke("b12:plain-throw", { x: 1 });
    expect(res.status).toBe(false);
    expect(res.msg).toBe("unexpected internal failure");
    expect(res.data).toBeNull();
    // No typed fields surface — the renderer cannot mistake a generic
    // internal exception for a policy refusal.
    expect(res.code).toBeUndefined();
    expect(res.existing_draft_id).toBeUndefined();
    expect(res.next_action).toBeUndefined();
    expect(res.requestCorrelationId).toBeUndefined();
  });

  it("yields a safe envelope with NO typed fields on schema-invalid input (validation failure, not a refusal)", async () => {
    const schema = lazySchema(() => z.strictObject({ x: z.number() }));
    registerValidatedHandler("b12:invalid", schema, async () => "ok");

    const res = await invoke("b12:invalid", { x: "not-a-number" });
    expect(res.status).toBe(false);
    expect(res.data).toBeNull();
    expect(res.msg).toMatch(/type|number|expected/i);
    // Validation failures carry no policy code — distinct from a refusal.
    expect(res.code).toBeUndefined();
    expect(res.next_action).toBeUndefined();
    expect(res.requestCorrelationId).toBeUndefined();
  });

  it("AI-gated handler: AI-disabled returns the existing disabled shape before any handler work", async () => {
    tokenGetValue.mockImplementation(() => "false");
    const schema = lazySchema(() => z.strictObject({ q: z.string() }));
    const inner = vi.fn(async () => "should-not-run");
    registerAiValidatedHandler("b12:ai:disabled", schema, inner);

    const res = await invoke("b12:ai:disabled", { q: "hello" });
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/not enabled/i);
    expect(res.data).toBeNull();
    expect(inner).not.toHaveBeenCalled();
    // The AI-disabled gate is not a policy refusal — no typed code surfaces.
    expect(res.code).toBeUndefined();
    expect(res.next_action).toBeUndefined();
  });
});

describe("B12: structured fields are NOT recovered by parsing English", () => {
  it("does not extract a code from an error whose message contains a [bracket] but carries no code property", async () => {
    // The legacy error text contains a [needs_human_review] bracket, but the
    // thrown error is a plain Error with no `code` property. B12 forbids
    // recovering the code by parsing the bracket out of the message — the
    // envelope must NOT carry a typed code.
    const schema = lazySchema(() => z.strictObject({ x: z.number() }));
    registerValidatedHandler("b12:no-parse", schema, async () => {
      throw new Error(
        "Reuse audit persistence failed: [needs_human_review] unrelated text"
      );
    });

    const res = await invoke("b12:no-parse", { x: 1 });
    expect(res.status).toBe(false);
    expect(res.msg).toContain("[needs_human_review]");
    // CRITICAL: the bracket is in the message text, but no typed code surfaces.
    expect(res.code).toBeUndefined();
    expect(res.next_action).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T06 step 13: EMAIL_REPLY_CHECK_REPLIED channel (FR-032)
// ---------------------------------------------------------------------------

describe("EMAIL_REPLY_CHECK_REPLIED — AI-gated reply-check channel (T06 step 13)", () => {
  // The real handler is in emailReceive-ipc.ts; these tests exercise the
  // dispatchValidated wrapper behavior for the AI-gated reply-check pattern
  // (registerAiValidatedHandler + a {messageId} schema + a DTO-returning
  // body that throws on detection failure). The body mirrors the production
  // handler: AI-gated, delegates to a checkReply-style function, returns the
  // typed DTO on success, throws a bounded error string on failure.
  const checkReplyStub = vi.fn();

  function registerCheckRepliedHandler(): void {
    const schema = lazySchema(() =>
      z.strictObject({ messageId: z.number().int().positive() })
    );
    registerAiValidatedHandler(
      "t06:reply:check:replied",
      schema,
      async (input) => {
        const outcome = await checkReplyStub(input.messageId);
        if (!outcome.success || !outcome.result) {
          // Mirrors the production handler — bounded error string only.
          throw new Error(outcome.error ?? "Reply detection failed");
        }
        return outcome.result;
      }
    );
  }

  beforeEach(() => {
    checkReplyStub.mockReset();
  });

  it("returns the typed three-state DTO on a successful detection", async () => {
    registerCheckRepliedHandler();
    checkReplyStub.mockResolvedValue({
      success: true,
      result: {
        success: true,
        message_id: 42,
        state: "replied",
        replied: true,
        source: "sent_search",
        reason_code: "already_replied",
        matched_message_id: "<outgoing-42@svc.com>",
        checked_at: "2026-10-05T00:00:00.000Z",
        from_cache: true,
        coverage: "configured_imap",
      },
    });

    const res = await invoke("t06:reply:check:replied", { messageId: 42 });
    expect(res.status).toBe(true);
    expect(res.data).toMatchObject({
      message_id: 42,
      state: "replied",
      replied: true,
      reason_code: "already_replied",
      matched_message_id: "<outgoing-42@svc.com>",
      from_cache: true,
      coverage: "configured_imap",
    });
  });

  it("returns the unknown-state DTO with replied=null on an inconclusive probe", async () => {
    registerCheckRepliedHandler();
    checkReplyStub.mockResolvedValue({
      success: true,
      result: {
        success: true,
        message_id: 43,
        state: "unknown",
        replied: null,
        source: "unavailable",
        reason_code: "sent_folder_unavailable",
        matched_message_id: null,
        checked_at: "2026-10-05T00:00:00.000Z",
        from_cache: false,
        coverage: "partial",
      },
    });

    const res = await invoke("t06:reply:check:replied", { messageId: 43 });
    expect(res.status).toBe(true);
    expect(res.data).toMatchObject({
      state: "unknown",
      replied: null,
      reason_code: "sent_folder_unavailable",
    });
  });

  it("AI-disabled returns the existing {status:false,msg,data:null} shape before any handler work", async () => {
    tokenGetValue.mockImplementation(() => "false");
    registerCheckRepliedHandler();

    const res = await invoke("t06:reply:check:replied", { messageId: 1 });
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/not enabled/i);
    expect(res.data).toBeNull();
    // The AI-disabled gate is not a policy refusal — no typed code surfaces.
    expect(res.code).toBeUndefined();
    expect(res.next_action).toBeUndefined();
    expect(checkReplyStub).not.toHaveBeenCalled();
  });

  it("schema-invalid input returns {status:false} with no typed code (validation, not a refusal)", async () => {
    registerCheckRepliedHandler();

    const res = await invoke("t06:reply:check:replied", {
      messageId: "not-a-number",
    });
    expect(res.status).toBe(false);
    expect(res.data).toBeNull();
    expect(res.msg).toMatch(/type|number|expected/i);
    expect(res.code).toBeUndefined();
    expect(res.next_action).toBeUndefined();
    expect(checkReplyStub).not.toHaveBeenCalled();
  });

  it("detection failure throws a bounded error string into the safe envelope (no raw provider errors)", async () => {
    registerCheckRepliedHandler();
    checkReplyStub.mockResolvedValue({
      success: false,
      error: "Reply detection failed",
    });

    const res = await invoke("t06:reply:check:replied", { messageId: 5 });
    expect(res.status).toBe(false);
    expect(res.msg).toBe("Reply detection failed");
    expect(res.data).toBeNull();
    // A persistence/detection failure carries no typed policy code.
    expect(res.code).toBeUndefined();
    expect(res.next_action).toBeUndefined();
  });
});

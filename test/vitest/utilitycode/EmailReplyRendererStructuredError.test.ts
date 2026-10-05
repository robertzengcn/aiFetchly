import { describe, it, expect, vi, beforeEach } from "vitest";

// B12 acceptance: the renderer API boundary (windowInvoke) must throw a typed
// IpcRequestError carrying code / existing_draft_id / next_action /
// requestCorrelationId from the IPC envelope's structured-failure fields, so
// renderer callers branch on `error.code` instead of parsing the leading
// [code] bracket out of `error.message`.
//
// We mock the transport seam (getIpcTransport) so windowInvoke runs for real
// against a controlled envelope — exercising the actual toIpcRequestError
// mapping, not a mocked throw.

const fakeInvoke = vi.fn<(channel: string, data?: unknown) => Promise<unknown>>();

vi.mock("@/views/utils/ipcTransport", () => ({
  // windowInvoke only needs .invoke; the other methods are not on this path.
  getIpcTransport: () => ({
    source: "electron-preload",
    invoke: fakeInvoke,
    invokeBinary: vi.fn(),
    send: vi.fn(),
    sendBinary: vi.fn(),
    receive: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  }),
}));

import { windowInvoke, IpcRequestError } from "@/views/utils/apirequest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("B12: windowInvoke throws IpcRequestError carrying structured fields", () => {
  it("preserves code/existing_draft_id/next_action/requestCorrelationId from a policy refusal envelope", async () => {
    fakeInvoke.mockResolvedValueOnce({
      status: false,
      msg: "[needs_human_review] Generation failed validation twice",
      data: null,
      code: "needs_human_review",
      next_action: "await_human_review",
      requestCorrelationId: "erx-req-abc-1",
    });

    let caught: unknown;
    try {
      await windowInvoke("EMAIL_REPLY_DRAFT_CREATE", { messageId: 1 });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(IpcRequestError);
    const err = caught as IpcRequestError;
    // Legacy .message still carries the human-readable text (unchanged
    // contract for the hundreds of existing catch sites that read e.message).
    expect(err.message).toContain("needs_human_review");
    // Typed fields preserved off the envelope.
    expect(err.code).toBe("needs_human_review");
    expect(err.next_action).toBe("await_human_review");
    expect(err.requestCorrelationId).toBe("erx-req-abc-1");
    expect(err.existing_draft_id).toBeUndefined();
  });

  it("preserves existing_draft_id (no code) from a reuse-audit persistence failure envelope", async () => {
    fakeInvoke.mockResolvedValueOnce({
      status: false,
      msg: "Reuse audit persistence failed",
      data: null,
      existing_draft_id: 77,
      next_action: "await_human_review",
      requestCorrelationId: "erx-req-abc-2",
    });

    let caught: unknown;
    try {
      await windowInvoke("EMAIL_REPLY_DRAFT_CREATE", { messageId: 1 });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(IpcRequestError);
    const err = caught as IpcRequestError;
    expect(err.message).toBe("Reuse audit persistence failed");
    // No typed code (audit-persistence is not a policy refusal), but the
    // existing draft id + correlation id survive so the renderer can route
    // the user to the existing draft.
    expect(err.code).toBeUndefined();
    expect(err.existing_draft_id).toBe(77);
    expect(err.next_action).toBe("await_human_review");
    expect(err.requestCorrelationId).toBe("erx-req-abc-2");
  });

  it("preserves the typed code from a pre-send SendPolicyRejection envelope", async () => {
    fakeInvoke.mockResolvedValueOnce({
      status: false,
      msg: "Send rejected by policy: Message already has a sent reply",
      data: null,
      code: "already_replied",
      next_action: "no_action",
    });

    let caught: unknown;
    try {
      await windowInvoke("EMAIL_REPLY_SEND", { draftId: 10 });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(IpcRequestError);
    const err = caught as IpcRequestError;
    expect(err.message).toContain("already has a sent reply");
    expect(err.code).toBe("already_replied");
    expect(err.next_action).toBe("no_action");
  });

  it("yields a plain IpcRequestError with NO typed fields on a generic internal-failure envelope", async () => {
    // B12 acceptance: an unexpected internal exception surfaces as a safe
    // envelope with status:false + msg, but carries no typed code. The
    // thrown IpcRequestError must NOT invent a code — callers can distinguish
    // a genuine policy refusal from a generic failure.
    fakeInvoke.mockResolvedValueOnce({
      status: false,
      msg: "Unexpected internal error",
      data: null,
    });

    let caught: unknown;
    try {
      await windowInvoke("EMAIL_REPLY_DRAFT_CREATE", { messageId: 1 });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(IpcRequestError);
    const err = caught as IpcRequestError;
    expect(err.message).toBe("Unexpected internal error");
    expect(err.code).toBeUndefined();
    expect(err.existing_draft_id).toBeUndefined();
    expect(err.next_action).toBeUndefined();
    expect(err.requestCorrelationId).toBeUndefined();
  });

  it("does NOT recover a code by parsing the [bracket] out of msg when no code field is present", async () => {
    // The legacy msg carries a [needs_human_review] bracket, but the envelope
    // has no typed `code` field. B12 forbids parsing English to recover one —
    // the thrown error must carry no code.
    fakeInvoke.mockResolvedValueOnce({
      status: false,
      msg: "Reuse audit persistence failed: [needs_human_review] unrelated text",
      data: null,
    });

    let caught: unknown;
    try {
      await windowInvoke("EMAIL_REPLY_DRAFT_CREATE", { messageId: 1 });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(IpcRequestError);
    const err = caught as IpcRequestError;
    expect(err.message).toContain("[needs_human_review]");
    // CRITICAL: the bracket is in the message text, but no typed code surfaces.
    expect(err.code).toBeUndefined();
    expect(err.next_action).toBeUndefined();
  });

  it("returns data unchanged on a status:true envelope (success path)", async () => {
    fakeInvoke.mockResolvedValueOnce({
      status: true,
      msg: "ok",
      data: { draftId: 42, subject: "Re: Hi" },
    });

    const result = await windowInvoke("EMAIL_REPLY_DRAFT_CREATE", {
      messageId: 1,
    });
    expect(result).toEqual({ draftId: 42, subject: "Re: Hi" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock windowInvoke so we can assert the channel + payload without IPC.
vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

import { windowInvoke } from "@/views/utils/apirequest";
import { checkEmailReplied } from "@/views/api/emailreply";
import { EMAIL_REPLY_CHECK_REPLIED } from "@/config/channellist";
import type { CheckEmailRepliedResult } from "@/service/emailReceive/EmailReplyDetectionTypes";

/**
 * T06 step 13 (FR-032): the renderer API wrapper for the diagnostic
 * reply-check. It must invoke the AI-gated `EMAIL_REPLY_CHECK_REPLIED` channel
 * with a `{ messageId }` payload and surface the typed three-state DTO the
 * handler returns. Read-only — no confirmation, no mailbox mutation.
 */
describe("checkEmailReplied renderer API (T06 step 13)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes EMAIL_REPLY_CHECK_REPLIED with { messageId }", async () => {
    const dto: CheckEmailRepliedResult = {
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
    };
    vi.mocked(windowInvoke).mockResolvedValueOnce(dto);

    const result = await checkEmailReplied(42);

    expect(windowInvoke).toHaveBeenCalledWith(EMAIL_REPLY_CHECK_REPLIED, {
      messageId: 42,
    });
    expect(result).toEqual(dto);
  });

  it("surfaces the unknown-state DTO unchanged (replied=null)", async () => {
    const dto: CheckEmailRepliedResult = {
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
    };
    vi.mocked(windowInvoke).mockResolvedValueOnce(dto);

    const result = await checkEmailReplied(43);

    expect(result.state).toBe("unknown");
    expect(result.replied).toBeNull();
    expect(result.reason_code).toBe("sent_folder_unavailable");
  });

  it("surfaces the not_replied-state DTO unchanged (replied=false)", async () => {
    const dto: CheckEmailRepliedResult = {
      success: true,
      message_id: 44,
      state: "not_replied",
      replied: false,
      source: "sent_search",
      reason_code: "no_reply_observed",
      matched_message_id: null,
      checked_at: "2026-10-05T00:00:00.000Z",
      from_cache: false,
      coverage: "configured_imap",
    };
    vi.mocked(windowInvoke).mockResolvedValueOnce(dto);

    const result = await checkEmailReplied(44);

    expect(result.state).toBe("not_replied");
    expect(result.replied).toBe(false);
    expect(result.reason_code).toBe("no_reply_observed");
  });

  it("propagates the channel name verbatim (no transformation)", async () => {
    // The channel constant is the single source of truth — the wrapper must
    // not invent or remap the channel string.
    vi.mocked(windowInvoke).mockResolvedValueOnce({
      success: true,
      message_id: 1,
      state: "replied",
      replied: true,
      source: "local_state",
      reason_code: "already_replied",
      matched_message_id: null,
      checked_at: null,
      from_cache: true,
      coverage: "local_only",
    });
    await checkEmailReplied(1);
    const [channel] = vi.mocked(windowInvoke).mock.calls[0];
    expect(channel).toBe("email:reply:check:replied");
  });
});

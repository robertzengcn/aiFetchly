/**
 * Unit tests for the FakeOpenAI deferral-retry detection
 * (test/e2e/scenarios/deferredToolRetry.ts).
 *
 * The app's deferred tool catalog answers a call to an undiscovered deferred
 * tool with a tool message whose content is the JSON produced by
 * serializeToolResultContent (src/service/AIChatQueryLoop.ts). The fake
 * server must recognize that round and re-emit the call like a real model,
 * otherwise tools behind the deferred catalog can never execute in E2E.
 * These tests pin the detection against the exact production content shape.
 */
import { describe, it, expect } from "vitest";
import { isDeferralRetryRequest } from "../../../e2e/scenarios/deferredToolRetry";

/** Exact error string the production loop serializes on deferral. */
const PRODUCTION_DEFERRAL_CONTENT = JSON.stringify({
  success: false,
  error:
    'Tool "draft_outbound_email_batch" was deferred and has now been loaded. Retry the call with valid arguments.',
});

/** A normal executed-tool result fed back to the model. */
const REAL_TOOL_RESULT_CONTENT = JSON.stringify({
  success: true,
  batchId: 7,
  draftCount: 1,
  batchHash: "abc",
});

function chatBody(toolMessages: string[]): string {
  return JSON.stringify({
    model: "m",
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      { role: "assistant", content: "", tool_calls: [] },
      ...toolMessages.map((content, i) => ({
        role: "tool",
        tool_call_id: `call_${i}`,
        content,
      })),
    ],
    stream: true,
  });
}

describe("isDeferralRetryRequest", () => {
  it("detects the production deferral-retry tool message", () => {
    expect(isDeferralRetryRequest(chatBody([PRODUCTION_DEFERRAL_CONTENT]))).toBe(
      true
    );
  });

  it("is true only when the LAST tool message is the deferral marker", () => {
    // First the deferral marker, then the real result of the retried call:
    // the follow-up round after execution must NOT be classified as a retry.
    expect(
      isDeferralRetryRequest(
        chatBody([PRODUCTION_DEFERRAL_CONTENT, REAL_TOOL_RESULT_CONTENT])
      )
    ).toBe(false);
  });

  it("rejects a normal executed-tool continuation", () => {
    expect(isDeferralRetryRequest(chatBody([REAL_TOOL_RESULT_CONTENT]))).toBe(
      false
    );
  });

  it("rejects bodies with no tool messages", () => {
    expect(
      isDeferralRetryRequest(
        JSON.stringify({
          messages: [
            { role: "system", content: "s" },
            { role: "user", content: "u" },
          ],
        })
      )
    ).toBe(false);
  });

  it("rejects invalid JSON and non-string tool content", () => {
    expect(isDeferralRetryRequest("not json")).toBe(false);
    expect(
      isDeferralRetryRequest(
        JSON.stringify({
          messages: [{ role: "tool", tool_call_id: "c", content: 42 }],
        })
      )
    ).toBe(false);
  });

  it("does not match a similar-but-different error string", () => {
    expect(
      isDeferralRetryRequest(
        chatBody([
          JSON.stringify({
            success: false,
            error: "use attach_local_images instead",
          }),
        ])
      )
    ).toBe(false);
  });
});

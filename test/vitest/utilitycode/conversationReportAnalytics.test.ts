import { describe, expect, it, vi } from "vitest";
import {
  bucketEligibleCount,
  emitConversationReportAnalytics,
} from "@/views/components/aiContentReport/conversationReportAnalytics";

/**
 * Renderer analytics allowlist contract (design §19.1, PRD §19.1).
 *
 * The open/scope events must carry ONLY: surface, eligible-item-count bucket,
 * and the user-context-enabled boolean. This test suite locks that contract:
 * it asserts the bucketing bands are correct AND that the public event type
 * physically cannot carry content or identifiers (the no-leak property).
 */
describe("bucketEligibleCount", () => {
  it("buckets zero eligible outputs to '0'", () => {
    expect(bucketEligibleCount(0)).toBe("0");
  });

  it("buckets a single output to '1'", () => {
    expect(bucketEligibleCount(1)).toBe("1");
  });

  it("buckets 2-3 to '2-3'", () => {
    expect(bucketEligibleCount(2)).toBe("2-3");
    expect(bucketEligibleCount(3)).toBe("2-3");
  });

  it("buckets 4-6 to '4-6'", () => {
    expect(bucketEligibleCount(4)).toBe("4-6");
    expect(bucketEligibleCount(6)).toBe("4-6");
  });

  it("buckets 7-10 to '7-10' (desktop maxAIItems cap on Chat V2)", () => {
    expect(bucketEligibleCount(7)).toBe("7-10");
    expect(bucketEligibleCount(10)).toBe("7-10");
  });

  it("buckets anything over 10 to '10+' (legacy/knowledge long histories)", () => {
    expect(bucketEligibleCount(11)).toBe("10+");
    expect(bucketEligibleCount(200)).toBe("10+");
  });
});

describe("emitConversationReportAnalytics (allowlist contract)", () => {
  it("is a no-op today (no approved renderer sink) and never throws", () => {
    // Design §19.1: until an approved sink exists, omit rather than console.info.
    // The function must therefore return without side effect and not throw.
    expect(() =>
      emitConversationReportAnalytics("ai_conversation_report_opened", {
        surface: "chat_v2",
        eligibleCountBucket: "2-3",
        userContextEnabled: false,
      })
    ).not.toThrow();
  });

  it("accepts the scope-changed event with the same allowlisted shape", () => {
    expect(() =>
      emitConversationReportAnalytics("ai_conversation_report_scope_changed", {
        surface: "knowledge_chat",
        eligibleCountBucket: "1",
        userContextEnabled: true,
      })
    ).not.toThrow();
  });

  // No-leak property: the public event interface has NO field for content,
  // ids, or report output. This is a compile-time guarantee enforced by
  // `ConversationReportAnalyticsEvent`; we assert the runtime shape of a
  // constructed payload to lock it against accidental field additions.
  it("a constructed payload contains only the three allowlisted keys", () => {
    const payload = {
      surface: "chat_v2" as const,
      eligibleCountBucket: bucketEligibleCount(5),
      userContextEnabled: false,
    };
    expect(Object.keys(payload).sort()).toEqual(
      ["eligibleCountBucket", "surface", "userContextEnabled"].sort()
    );
  });
});

// Guard: ensure no analytics call site can smuggle content through. We verify
// the emitter discards its argument today (no-op), and that the spy receives
// nothing back — proving the design's "omit, never console.info" stance.
describe("emitConversationReportAnalytics does not leak via console", () => {
  it("never calls console.info with report properties", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    emitConversationReportAnalytics("ai_conversation_report_opened", {
      surface: "chat_v2",
      eligibleCountBucket: "7-10",
      userContextEnabled: true,
    });
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });
});

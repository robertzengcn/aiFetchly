import { describe, expect, it } from "vitest";

import {
  BrowserChatNoticePublisher,
  sanitizeNoticeArgs,
} from "@/service/BrowserChatNoticePublisher";
import type {
  BrowserChatNoticeType,
  SafeBrowserChatNotice,
} from "@/entityTypes/managedBrowserTypes";

type PublishedNotice = SafeBrowserChatNotice & {
  messageArgs: Readonly<Record<string, string | number | boolean>>;
};

function makePublisher(): {
  publisher: BrowserChatNoticePublisher;
  notices: PublishedNotice[];
} {
  const notices: PublishedNotice[] = [];
  return {
    publisher: new BrowserChatNoticePublisher((notice) =>
      notices.push(notice)
    ),
    notices,
  };
}

const baseInput = {
  sessionId: "mb_session0000001",
  conversationId: "conv-1",
  type: "login_required" as BrowserChatNoticeType,
  transitionNonce: "login-start",
  requiresUserAction: true,
};

describe("BrowserChatNoticePublisher", () => {
  it("publishes a safe notice with mapped severity and message key", () => {
    const { publisher, notices } = makePublisher();
    const notice = publisher.publish({
      ...baseInput,
      messageArgs: { accountLabel: "My Channel", platformLabel: "YouTube" },
    });
    expect(notice).not.toBeNull();
    expect(notices).toHaveLength(1);
    expect(notices[0].type).toBe("login_required");
    expect(notices[0].severity).toBe("warning");
    expect(notices[0].messageKey).toBe(
      "managedBrowser.notice.login_required"
    );
    expect(notices[0].requiresUserAction).toBe(true);
    expect(notices[0].messageArgs).toEqual({
      accountLabel: "My Channel",
      platformLabel: "YouTube",
    });
    expect(notices[0].eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(Number.isNaN(Date.parse(notices[0].createdAt))).toBe(false);
  });

  it("deduplicates an identical transition (FR-HANDOFF-005)", () => {
    const { publisher, notices } = makePublisher();
    const first = publisher.publish(baseInput);
    const second = publisher.publish(baseInput);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(notices).toHaveLength(1);
  });

  it("publishes when the nonce differs (new transition)", () => {
    const { publisher, notices } = makePublisher();
    publisher.publish(baseInput);
    publisher.publish({ ...baseInput, transitionNonce: "login-start-2" });
    expect(notices).toHaveLength(2);
  });

  it("publishes when the type differs for the same transition", () => {
    const { publisher, notices } = makePublisher();
    publisher.publish(baseInput);
    publisher.publish({
      ...baseInput,
      type: "login_verifying",
    });
    expect(notices).toHaveLength(2);
  });

  it("clears the dedup window after 500 keys and republishes", () => {
    const { publisher, notices } = makePublisher();
    for (let i = 0; i < 500; i += 1) {
      publisher.publish({ ...baseInput, transitionNonce: `n-${i}` });
    }
    expect(notices).toHaveLength(500);
    // Window cleared — the very first key publishes again.
    const again = publisher.publish(baseInput);
    expect(again).not.toBeNull();
    expect(notices).toHaveLength(501);
  });

  it("forces requiresUserAction for action-required types", () => {
    const { publisher, notices } = makePublisher();
    publisher.publish({
      ...baseInput,
      type: "login_verification_failed",
      requiresUserAction: false,
    });
    expect(notices[0].requiresUserAction).toBe(true);
  });

  it("keeps an explicit requiresUserAction=true on info types", () => {
    const { publisher, notices } = makePublisher();
    publisher.publish({
      ...baseInput,
      type: "task_resuming",
      requiresUserAction: true,
    });
    expect(notices[0].requiresUserAction).toBe(true);
  });

  it("maps every notice type to a severity", () => {
    const { publisher, notices } = makePublisher();
    const types: BrowserChatNoticeType[] = [
      "login_required",
      "login_verifying",
      "login_verified",
      "login_verification_failed",
      "session_persistence_failed",
      "challenge_detected",
      "challenge_provider_started",
      "challenge_resolved",
      "challenge_failed",
      "challenge_manual_action_required",
      "task_resuming",
      "browser_crashed",
      "cache_clear_deferred",
      "cache_clear_completed",
      "cache_clear_failed",
    ];
    for (const type of types) {
      publisher.publish({ ...baseInput, type, transitionNonce: `t-${type}` });
    }
    expect(notices).toHaveLength(types.length);
    const byType = new Map(notices.map((n) => [n.type, n.severity]));
    expect(byType.get("login_verified")).toBe("success");
    expect(byType.get("login_verifying")).toBe("info");
    expect(byType.get("challenge_failed")).toBe("error");
    expect(byType.get("browser_crashed")).toBe("error");
    expect(byType.get("cache_clear_completed")).toBe("success");
    expect(byType.get("cache_clear_deferred")).toBe("info");
    for (const severity of byType.values()) {
      expect(["info", "success", "warning", "error"]).toContain(severity);
    }
  });
});

describe("sanitizeNoticeArgs", () => {
  it("keeps allow-listed scalar args", () => {
    expect(
      sanitizeNoticeArgs({
        accountLabel: "My Channel",
        platformLabel: "YouTube",
        cookieCount: 2,
        sessionSaved: true,
        reasonCode: "worker_exited",
        minutes: 5,
      })
    ).toEqual({
      accountLabel: "My Channel",
      platformLabel: "YouTube",
      cookieCount: 2,
      sessionSaved: true,
      reasonCode: "worker_exited",
      minutes: 5,
    });
  });

  it("drops untrusted keys (page text, URLs, cookie values)", () => {
    expect(
      sanitizeNoticeArgs({
        accountLabel: "ok",
        pageText: "Sign in to continue",
        currentUrl: "https://evil.example/",
        cookieValue: "SID=secret",
        oauthState: "abc",
      } as Record<string, string>)
    ).toEqual({ accountLabel: "ok" });
  });

  it("returns an empty object for undefined args", () => {
    expect(sanitizeNoticeArgs(undefined)).toEqual({});
  });
});

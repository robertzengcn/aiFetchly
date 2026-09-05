import { describe, expect, it } from "vitest";

import {
  BrowserActionRiskClassifier,
} from "@/service/BrowserActionRiskClassifier";

/**
 * Deterministic risk classification (design §15.4, §17): read/reversible
 * stay session-level; consequential writes ALWAYS require approval;
 * credential/security flows ALWAYS hand off; model assertions can only
 * RAISE a classification, never lower it.
 */

const classifier = new BrowserActionRiskClassifier();

function classify(
  context: Parameters<BrowserActionRiskClassifier["classify"]>[0]
): ReturnType<BrowserActionRiskClassifier["classify"]> {
  return classifier.classify(context);
}

describe("BrowserActionRiskClassifier matrix", () => {
  it("classifies reads as auto", () => {
    for (const actionType of [
      "observe",
      "extract",
      "screenshot",
      "wait_for",
      "scroll",
      "press_key",
      "get_status",
    ]) {
      const result = classify({ actionType });
      expect(result.riskClass, actionType).toBe("read");
      expect(result.requiresApproval).toBe(false);
      expect(result.routing).toBe("auto");
    }
  });

  it("classifies plain navigation as read and login URLs as handoff", () => {
    expect(classify({ actionType: "navigate", url: "https://www.youtube.com/watch?v=1" }).routing).toBe("auto");
    expect(
      classify({ actionType: "navigate", url: "https://accounts.google.com/login" })
    ).toMatchObject({
      riskClass: "credential_or_security",
      routing: "handoff",
      requiresApproval: true,
    });
    expect(
      classify({ actionType: "navigate", url: "https://x.com/signin" }).routing
    ).toBe("handoff");
    expect(
      classify({ actionType: "navigate", url: "https://x.com/settings/password" })
        .routing
    ).toBe("handoff");
  });

  it("classifies ordinary form interactions as reversible writes (session-level)", () => {
    expect(
      classify({ actionType: "fill", targetName: "Search", targetRole: "textbox" })
    ).toMatchObject({ riskClass: "reversible_write", routing: "auto" });
    expect(
      classify({ actionType: "click", targetName: "Next", targetRole: "button" })
    ).toMatchObject({ riskClass: "reversible_write", routing: "auto" });
    expect(
      classify({ actionType: "select", targetName: "Language", targetRole: "combobox" })
        .routing
    ).toBe("auto");
  });

  it("classifies credential fields as handoff regardless of phrasing", () => {
    expect(
      classify({ actionType: "fill", targetName: "Password", targetRole: "textbox" })
    ).toMatchObject({ riskClass: "credential_or_security", routing: "handoff" });
    expect(
      classify({ actionType: "fill", targetName: "Comment", targetRole: "password" })
        .routing
    ).toBe("handoff");
    expect(
      classify({ actionType: "fill", targetName: "One-time code", targetRole: "textbox" })
        .routing
    ).toBe("handoff");
  });

  it("classifies consequential descriptors as always-approve", () => {
    for (const name of [
      "Publish video",
      "Send message",
      "Delete comment",
      "Follow user",
      "Upload file",
      "Submit order",
      "Post reply",
      "Subscribe",
    ]) {
      expect(classify({ actionType: "click", targetName: name }), name).toMatchObject(
        {
          riskClass: "consequential_write",
          routing: "approval",
          requiresApproval: true,
        }
      );
    }
    expect(
      classify({ actionType: "fill", targetName: "Post title" }).routing
    ).toBe("approval");
  });

  it("classifies cache clears as local data deletion (approval)", () => {
    expect(classify({ actionType: "clear_cache" })).toMatchObject({
      riskClass: "local_data_delete",
      routing: "approval",
      requiresApproval: true,
    });
  });

  it("model assertions can RAISE but never LOWER the class", () => {
    // Raise: model says a plain click is consequential — honored.
    expect(
      classify({
        actionType: "click",
        targetName: "Next",
        modelAssertedRiskClass: "consequential_write",
      })
    ).toMatchObject({ riskClass: "consequential_write", routing: "approval" });

    // Lower attempt: model says Publish is just reversible — REFUSED.
    expect(
      classify({
        actionType: "click",
        targetName: "Publish video",
        modelAssertedRiskClass: "reversible_write",
      })
    ).toMatchObject({ riskClass: "consequential_write", routing: "approval" });

    // Lower attempt on a credential URL — REFUSED.
    expect(
      classify({
        actionType: "navigate",
        url: "https://accounts.google.com/login",
        modelAssertedRiskClass: "read",
      })
    ).toMatchObject({ riskClass: "credential_or_security", routing: "handoff" });
  });

  it("never assigns privileged_script on its own but honors a model raise to it", () => {
    expect(classify({ actionType: "click", targetName: "Anything" }).riskClass).not.toBe(
      "privileged_script"
    );
    expect(
      classify({
        actionType: "click",
        targetName: "Anything",
        modelAssertedRiskClass: "privileged_script",
      }).riskClass
    ).toBe("privileged_script");
  });
});

describe("classifyProgram", () => {
  it("aggregates to the most severe step", () => {
    const result = classifier.classifyProgram([
      { type: "navigate", url: "https://www.youtube.com/upload" },
      { type: "fill", targetName: "Title" },
      { type: "click", targetName: "Publish" },
    ]);
    expect(result).toMatchObject({
      riskClass: "consequential_write",
      routing: "approval",
      requiresApproval: true,
    });
  });

  it("stays session-level for an ordinary program", () => {
    const result = classifier.classifyProgram([
      { type: "navigate", url: "https://www.youtube.com/results?search_query=cats" },
      { type: "extract" },
      { type: "scroll" },
    ]);
    expect(result.routing).toBe("auto");
    expect(result.requiresApproval).toBe(false);
  });

  it("a credential step anywhere forces the whole program to handoff", () => {
    const result = classifier.classifyProgram([
      { type: "navigate", url: "https://www.youtube.com/feed" },
      { type: "fill", targetName: "Password" },
    ]);
    expect(result.routing).toBe("handoff");
    expect(result.riskClass).toBe("credential_or_security");
  });
});

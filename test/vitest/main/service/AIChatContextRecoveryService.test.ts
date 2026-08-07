import { describe, expect, it } from "vitest";
import {
  AIChatContextRecoveryService,
  DEFAULT_CONTEXT_BUDGET_POLICY,
  type AIChatContextBudgetPolicy,
} from "@/service/AIChatContextRecoveryService";
import { createRecoveryAttemptState } from "@/service/AIChatRecoveryTypes";
import type { OpenAIChatMessage } from "@/api/aiChatApi";

function user(text: string): OpenAIChatMessage {
  return { role: "user", content: text };
}
function assistant(text: string): OpenAIChatMessage {
  return { role: "assistant", content: text };
}
function assistantToolCall(id: string, name: string): OpenAIChatMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      { id, type: "function", function: { name, arguments: "{}" } },
    ],
  };
}
function toolResult(id: string, content: string): OpenAIChatMessage {
  return { role: "tool", tool_call_id: id, content };
}

function makeMessages(count: number): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(user(`message ${i} ${"x".repeat(200)}`));
  }
  return out;
}

describe("AIChatContextRecoveryService", () => {
  const service = new AIChatContextRecoveryService();

  describe("recoverOverflow", () => {
    it("tries drain first when not yet attempted", () => {
      const state = createRecoveryAttemptState("m");
      const msgs = [
        assistantToolCall("c1", "tool"),
        toolResult("c1", "result"),
        ...makeMessages(5),
      ];
      const policy: AIChatContextBudgetPolicy = {
        ...DEFAULT_CONTEXT_BUDGET_POLICY,
        contextWindowTokens: 1000,
        softThresholdRatio: 0.9,
        hardThresholdRatio: 0.95,
        reserveOutputTokens: 50,
      };
      const result = service.recoverOverflow({
        conversationId: "c",
        messages: msgs,
        state,
        policy,
        currentTokens: 950,
      });
      expect(result.action.type).toBe("drain");
      expect(result.updatedState.contextDrainAttempted).toBe(true);
    });

    it("falls through to compact when drain already attempted", () => {
      const state = {
        ...createRecoveryAttemptState("m"),
        contextDrainAttempted: true,
      };
      const policy = DEFAULT_CONTEXT_BUDGET_POLICY;
      const result = service.recoverOverflow({
        conversationId: "c",
        messages: makeMessages(10),
        state,
        policy,
        currentTokens: 999_999,
      });
      expect(result.action.type).toBe("compact");
      expect(result.updatedState.reactiveCompactAttempted).toBe(true);
    });

    it("fails when drain and compact are both attempted", () => {
      const state = {
        ...createRecoveryAttemptState("m"),
        contextDrainAttempted: true,
        reactiveCompactAttempted: true,
      };
      const result = service.recoverOverflow({
        conversationId: "c",
        messages: makeMessages(10),
        state,
        policy: DEFAULT_CONTEXT_BUDGET_POLICY,
        currentTokens: 999_999,
      });
      expect(result.action.type).toBe("fail");
      if (result.action.type === "fail") {
        expect(result.action.reason).toBe("context_overflow");
      }
    });
  });

  describe("drainTo - tool group atomicity", () => {
    it("drops an entire assistant tool_call + tool result group together", () => {
      const msgs: OpenAIChatMessage[] = [
        assistantToolCall("c1", "tool"),
        toolResult("c1", "result"),
        user("latest"),
      ];
      const policy: AIChatContextBudgetPolicy = {
        contextWindowTokens: 1000,
        softThresholdRatio: 0.1,
        hardThresholdRatio: 0.2,
        reserveOutputTokens: 0,
      };
      // Target is so small that we need to drop the tool group.
      const result = service.drainTo(msgs, 10, policy);
      expect(result.some((m) => m.role === "tool")).toBe(false);
      expect(result.some((m) => "tool_calls" in m && m.tool_calls)).toBe(
        false
      );
    });

    it("preserves the latest group even if still over target", () => {
      const msgs: OpenAIChatMessage[] = [
        assistantToolCall("c1", "tool"),
        toolResult("c1", "result"),
        user("the latest message that should always be preserved"),
      ];
      const policy: AIChatContextBudgetPolicy = {
        contextWindowTokens: 1000,
        softThresholdRatio: 0.01,
        hardThresholdRatio: 0.02,
        reserveOutputTokens: 0,
      };
      const result = service.drainTo(msgs, 5, policy);
      expect(result.length).toBeGreaterThan(0);
      const last = result[result.length - 1];
      expect(last?.role).toBe("user");
    });
  });

  describe("drainTo - no mutation", () => {
    it("does not mutate the input array", () => {
      const msgs: OpenAIChatMessage[] = [
        assistantToolCall("c1", "tool"),
        toolResult("c1", "result"),
        ...makeMessages(3),
      ];
      const snapshot = msgs.slice();
      const policy: AIChatContextBudgetPolicy = {
        contextWindowTokens: 1000,
        softThresholdRatio: 0.1,
        hardThresholdRatio: 0.2,
        reserveOutputTokens: 0,
      };
      service.drainTo(msgs, 10, policy);
      expect(msgs).toEqual(snapshot);
    });
  });

  describe("threshold helpers", () => {
    it("computes soft and hard thresholds", () => {
      const policy: AIChatContextBudgetPolicy = {
        contextWindowTokens: 1000,
        softThresholdRatio: 0.9,
        hardThresholdRatio: 0.95,
        reserveOutputTokens: 100,
      };
      expect(service.softThreshold(policy)).toBe(900);
      expect(service.hardThreshold(policy)).toBe(950);
    });
  });
});

/**
 * Unit tests for the AI Task Completion Policy V1 rollout flag
 * (PRD §12 slice 1; technical-design §17 rollout/rollback).
 *
 * The flag is DEFAULT OFF and FAIL CLOSED: a broken Token store must never
 * silently enable the completion-policy enrollment path. Follows the same
 * pattern as AIChatRecoverableFeatureFlags.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const flagStore: Record<string, string> = {};
// When true, Token.getValue throws to simulate an unreadable encrypted store.
let storeUnreadable = false;

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string): string {
      if (storeUnreadable) {
        throw new Error("encrypted store unreadable");
      }
      return flagStore[name] ?? "";
    }
    setValue(name: string, value: string): void {
      flagStore[name] = value;
    }
  },
}));

import {
  AI_TASK_COMPLETION_POLICY_V1_FLAG,
  isAiTaskCompletionPolicyV1Enabled,
} from "@/config/featureFlags";

beforeEach(() => {
  for (const key of Object.keys(flagStore)) delete flagStore[key];
  storeUnreadable = false;
});

afterEach(() => {
  for (const key of Object.keys(flagStore)) delete flagStore[key];
  storeUnreadable = false;
});

describe("aiTaskCompletionPolicyV1 feature gate", () => {
  it("defaults OFF when the Token store is empty", () => {
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(false);
  });

  it("is ON only when the Token value is exactly 'true'", () => {
    flagStore[AI_TASK_COMPLETION_POLICY_V1_FLAG] = "true";
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(true);
  });

  it("stays OFF for any non-'true' value (fail-closed)", () => {
    flagStore[AI_TASK_COMPLETION_POLICY_V1_FLAG] = "false";
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(false);
    flagStore[AI_TASK_COMPLETION_POLICY_V1_FLAG] = "1";
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(false);
  });

  it("fails CLOSED when the Token store throws (storage hiccup)", () => {
    storeUnreadable = true;
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(false);
  });
});

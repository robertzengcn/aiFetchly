import { describe, expect, it } from "vitest";

import { SkillRegistry } from "@/config/skillsRegistry";

/**
 * Registry-level contract for the managed-browser tools (design §15/§17):
 * all ten tools registered, automation permission category, confirmation
 * flags per risk, and async routing for long action programs.
 */

const MANAGED_BROWSER_TOOLS = [
  "browser_start_session",
  "browser_get_status",
  "browser_observe",
  "browser_navigate",
  "browser_run_actions",
  "browser_capture_screenshot",
  "browser_request_handoff",
  "browser_resume_after_handoff",
  "browser_stop_session",
  "browser_clear_cache",
] as const;

function getTool(name: string) {
  const tool = SkillRegistry.getSkill
    ? SkillRegistry.getSkill(name)
    : (SkillRegistry as unknown as { tools?: Map<string, unknown> }).tools?.get(
        name
      );
  return tool as
    | {
        name: string;
        requiresConfirmation: boolean;
        permissionCategory: string;
        resolveTimeoutClass?: (args: Record<string, unknown>) => string;
        resolveAsync?: (args: Record<string, unknown>) => boolean;
        execute: (args: Record<string, unknown>, context: unknown) => Promise<{
          success: boolean;
          result: Record<string, unknown>;
        }>;
      }
    | undefined;
}

describe("managed-browser tool registration", () => {
  it("registers all ten tools with the automation permission category", () => {
    for (const name of MANAGED_BROWSER_TOOLS) {
      const tool = getTool(name);
      expect(tool, name).toBeDefined();
      expect(tool?.permissionCategory, name).toBe("automation");
    }
  });

  it("requires confirmation for session start, action programs, and cache clears", () => {
    expect(getTool("browser_start_session")?.requiresConfirmation).toBe(true);
    expect(getTool("browser_run_actions")?.requiresConfirmation).toBe(true);
    expect(getTool("browser_clear_cache")?.requiresConfirmation).toBe(true);
    for (const name of [
      "browser_get_status",
      "browser_observe",
      "browser_navigate",
      "browser_capture_screenshot",
      "browser_request_handoff",
      "browser_resume_after_handoff",
      "browser_stop_session",
    ]) {
      expect(getTool(name)?.requiresConfirmation, name).toBe(false);
    }
  });

  it("routes long action programs to the async job path", () => {
    const tool = getTool("browser_run_actions");
    expect(tool?.resolveTimeoutClass).toBeDefined();
    const actions = (n: number): { actions: unknown[] } => ({
      actions: Array.from({ length: n }, () => ({ type: "scroll" })),
    });
    expect(tool?.resolveTimeoutClass?.({ program: actions(7) })).toBe("browser");
    expect(tool?.resolveTimeoutClass?.({ program: actions(8) })).toBe("async");
    expect(tool?.resolveAsync?.({ program: actions(8) })).toBe(true);
    expect(tool?.resolveAsync?.({ program: actions(3) })).toBe(false);
  });

  it("executors surface the safe ai_disabled code when AI is off", async () => {
    // The wrapper catches ManagedBrowserAiToolError and flattens it into
    // { success:false, result:{ error } } — the loop never sees a throw.
    const tool = getTool("browser_get_status");
    // The service singleton's default gate reads the real Token; in the test
    // environment the store is absent, so isAiEnabled fails closed.
    const outcome = await tool?.execute(
      { session_id: "mb_test000000001" },
      { conversationId: "conv-1", toolCallId: "call-1" }
    );
    expect(outcome?.success).toBe(false);
    expect(outcome?.result.error).toBe("ai_disabled");
  });
});

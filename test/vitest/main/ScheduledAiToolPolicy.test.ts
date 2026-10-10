import { describe, expect, it } from "vitest";

/**
 * Regression tests for the scheduled-loop tool policy tier membership of the
 * three outreach / lead-discovery tools:
 *   - scrape_urls_from_search_engine
 *   - read_url_content
 *   - extract_contact_info
 *
 * These tools are registered built-ins (`source: "built-in"`) but were absent
 * from all three curated scheduled tiers (read-only / high-impact /
 * automation). Under any non-`full_access` approval mode they fell to the
 * uncategorized-built-in fallback in `canAutoApproveScheduledTool`, which
 * returned `{ allowed: false, requiresInteractivePermission: true }`. Because
 * the scheduled `toolFilter` (`AIChatQueryEngineFactory.isToolAllowed`) checks
 * only `.allowed`, the tools were filtered out of the advertised catalog
 * BEFORE the deferred catalog was built — so even `tool_catalog_search`
 * could not surface them, while `BuiltInToolCapabilitiesPromptSection`
 * advertised them in the system prompt. The model searched, found nothing,
 * and reported the tools "not available in this session".
 *
 * Fix: promote the three outreach tools into `SCHEDULED_LOOP_AUTOMATION_TOOLS`
 * (network/side-effect tools that are schedulable with explicit per-tool
 * allowlisting). They now behave like `proxy_check`: schedulable in the UI
 * catalog, auto-approvable when allowlisted in the task policy, and pausing
 * for an interactive permission card (not fail-closed) when called without
 * allowlist membership.
 */
import {
  SCHEDULED_LOOP_AUTOMATION_TOOLS,
  canAutoApproveScheduledTool,
  describeBuiltInToolForSchedule,
  isHighImpactSchedulableTool,
  isScheduledAutomationTool,
  isScheduledReadOnlyTool,
  isSchedulableBuiltInTool,
} from "@/service/ScheduledAiToolPolicy";
import type { SkillDefinition } from "@/entityTypes/skillTypes";
import type {
  AiMessageTaskToolPolicy,
  ScheduledToolDecision,
} from "@/entityTypes/aiMessageTaskTypes";

const OUTREACH_TOOL_NAMES = [
  "scrape_urls_from_search_engine",
  "read_url_content",
  "extract_contact_info",
] as const;

/** Minimal built-in SkillDefinition fixture for one outreach tool. */
function outreachSkill(name: string): SkillDefinition {
  const permissionCategory =
    name === "extract_contact_info" ? "automation" : "network";
  return {
    name,
    description: `outreach tool ${name}`,
    parameters: { type: "object" },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory,
    source: "built-in",
    execute: async () => ({ success: true, result: {} }),
  };
}

/** Baseline task policy: autoApprove on, the named tool allowlisted. */
function policyWith(
  allowedTools: readonly string[],
  overrides: Partial<AiMessageTaskToolPolicy> = {}
): AiMessageTaskToolPolicy {
  return {
    allowedTools,
    autoApproveTools: true,
    allowSkills: false,
    allowMcp: false,
    allowSubagents: false,
    maxToolCalls: 10,
    maxRuntimeMs: 300_000,
    maxContinueCalls: 10,
    ...overrides,
  };
}

describe("ScheduledAiToolPolicy — outreach tools in the automation tier", () => {
  describe("tier membership", () => {
    for (const name of OUTREACH_TOOL_NAMES) {
      it(`${name} is in SCHEDULED_LOOP_AUTOMATION_TOOLS`, () => {
        expect(SCHEDULED_LOOP_AUTOMATION_TOOLS.has(name)).toBe(true);
      });

      it(`${name} passes isScheduledAutomationTool`, () => {
        expect(isScheduledAutomationTool(name)).toBe(true);
      });

      it(`${name} is schedulable via isSchedulableBuiltInTool`, () => {
        expect(isSchedulableBuiltInTool(name)).toBe(true);
      });

      it(`${name} is NOT misclassified as read-only or high-impact`, () => {
        expect(isScheduledReadOnlyTool(name)).toBe(false);
        expect(isHighImpactSchedulableTool(name)).toBe(false);
      });
    }
  });

  describe("describeBuiltInToolForSchedule (UI catalog)", () => {
    for (const name of OUTREACH_TOOL_NAMES) {
      it(`${name} is marked schedulable + autoApproveAllowed + medium risk`, () => {
        const summary = describeBuiltInToolForSchedule(outreachSkill(name));
        expect(summary.schedulable).toBe(true);
        expect(summary.autoApproveAllowed).toBe(true);
        expect(summary.riskLevel).toBe("medium");
        expect(summary.source).toBe("built-in");
        // No blocked reason for a schedulable tool.
        expect(summary.blockedReason).toBeUndefined();
      });
    }
  });

  describe("canAutoApproveScheduledTool — runtime decision", () => {
    for (const name of OUTREACH_TOOL_NAMES) {
      it(`${name} auto-approves when allowlisted + autoApproveTools on (non-full_access mode)`, () => {
        const decision = canAutoApproveScheduledTool({
          skill: outreachSkill(name),
          taskPolicy: policyWith([name]),
          toolName: name,
          // ask_for_approval: the path that previously filtered the tools out.
          approvalMode: "ask_for_approval",
        });
        const expected: Partial<ScheduledToolDecision> = {
          allowed: true,
          riskLevel: "low",
        };
        expect(decision).toMatchObject(expected);
        expect(decision.requiresInteractivePermission).toBeFalsy();
      });

      it(`${name} pauses for permission (not fail-closed) when NOT allowlisted`, () => {
        // The tool is in the automation tier but not in the task's allowedTools.
        // It must NOT be silently dropped — it pauses for an interactive card
        // (1h auto-deny backstop) so the user can grant it at runtime.
        const decision = canAutoApproveScheduledTool({
          skill: outreachSkill(name),
          taskPolicy: policyWith([]),
          toolName: name,
          approvalMode: "ask_for_approval",
        });
        expect(decision.allowed).toBe(false);
        expect(decision.requiresInteractivePermission).toBe(true);
        expect(decision.riskLevel).toBe("high");
      });

      it(`${name} still fast-paths under full_access regardless of allowlist`, () => {
        const decision = canAutoApproveScheduledTool({
          skill: outreachSkill(name),
          taskPolicy: policyWith([]),
          toolName: name,
          approvalMode: "full_access",
        });
        expect(decision.allowed).toBe(true);
      });
    }
  });
});

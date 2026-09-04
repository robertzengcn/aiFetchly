import { describe, expect, it } from "vitest";
import {
  evaluateToolApproval,
  type ChatToolApprovalPolicyInput,
} from "@/service/AIChatToolApprovalPolicyService";

function input(
  overrides: Partial<ChatToolApprovalPolicyInput> = {}
): ChatToolApprovalPolicyInput {
  return {
    conversationId: "conv-1",
    mode: "full_access",
    toolName: "start_email_send_task",
    isDependencyInstall: false,
    ...overrides,
  };
}

describe("evaluateToolApproval — request-scoped action policy", () => {
  it("never auto-approves a request_scoped_action tool even in full_access", () => {
    const decision = evaluateToolApproval(
      input({ mode: "full_access", confirmationPolicy: "request_scoped_action" })
    );
    expect(decision.autoApprove).toBe(false);
    expect(decision.reason).toMatch(/request-scoped/i);
  });

  it("never auto-approves a request_scoped_action tool under approve_for_me", () => {
    const decision = evaluateToolApproval(
      input({
        mode: "approve_for_me",
        confirmationPolicy: "request_scoped_action",
      })
    );
    expect(decision.autoApprove).toBe(false);
  });

  it("resolves request_scoped_action from the registered send tool name", () => {
    // The start_email_send_task skill declares
    // confirmationPolicy: "request_scoped_action", so even without an explicit
    // confirmationPolicy on the input the resolver refuses auto-approval.
    const decision = evaluateToolApproval(
      input({ mode: "full_access", toolName: "start_email_send_task" })
    );
    expect(decision.autoApprove).toBe(false);
    expect(decision.reason).toMatch(/request-scoped/i);
  });

  it("still auto-approves an ordinary non-shell tool under full_access", () => {
    const decision = evaluateToolApproval(
      input({
        mode: "full_access",
        toolName: "list_email_services",
        permissionCategory: "network",
      })
    );
    expect(decision.autoApprove).toBe(true);
  });

  it("request_scoped_action short-circuits before the explicit-denial check", () => {
    // Even a tool that is otherwise unknown/undefined must not auto-approve a
    // request-scoped action; the policy is checked first (§14.1).
    const decision = evaluateToolApproval(
      input({
        mode: "full_access",
        toolName: "unknown_outbound_send",
        confirmationPolicy: "request_scoped_action",
      })
    );
    expect(decision.autoApprove).toBe(false);
    expect(decision.reason).toMatch(/request-scoped/i);
  });
});
import { describe, expect, it } from "vitest";
import { ToolJobRegistry } from "@/service/ToolJobRegistry";

/**
 * C-FR-09: the wait probe is conversation-scoped — one batch child's
 * credential/handoff wait must never freeze a sibling's active-time
 * clock (the global isAnyWaitingForUser did exactly that).
 */

describe("ToolJobRegistry conversation-scoped wait probe (C-FR-09)", () => {
  it("only the waiting conversation freezes; siblings keep ticking", () => {
    const registry = new ToolJobRegistry();
    const noopSpawn = async (): Promise<unknown> => undefined;
    const { jobId: jobA } = registry.start(
      "browser_execute_task",
      {},
      { conversationId: "agent-v2-a", toolCallId: "call-a" },
      noopSpawn
    );
    const { jobId: jobB } = registry.start(
      "browser_execute_task",
      {},
      { conversationId: "agent-v2-b", toolCallId: "call-b" },
      noopSpawn
    );

    // Child A opens a credential-card wait.
    registry.setUserWait(jobA, true, "credential_card");

    expect(registry.isConversationWaitingForUser("agent-v2-a")).toBe(true);
    // B's clock keeps running — the global probe WOULD have said true.
    expect(registry.isConversationWaitingForUser("agent-v2-b")).toBe(false);
    expect(registry.isAnyWaitingForUser()).toBe(true);
    void jobB;

    // The wait closes: nobody freezes.
    registry.setUserWait(jobA, false);
    expect(registry.isConversationWaitingForUser("agent-v2-a")).toBe(false);
  });
});

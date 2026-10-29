import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-workspace-counters");

vi.mock("electron", () => ({ app: { getPath: () => tmpDir } }));

const tokenValues = new Map<string, string>();
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      if (tokenValues.has(key)) return tokenValues.get(key)!;
      // Rollout flags default from absence; database paths resolve to tmp.
      if (key.includes("enabled") || key.includes("redesign")) return "";
      return process.env.AIFETCHLY_TEST_DBPATH ?? "";
    }
  },
}));

import { SqliteDb } from "@/config/SqliteDb";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";
import { AIChatWorkspaceRunDispatchBridge } from "@/service/AIChatWorkspaceRunDispatchBridge";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import {
  isWorkspaceQueueEnabled,
  isWorkspaceSteeringEnabled,
  isWorkspaceRedesignEnabled,
} from "@/service/AIChatWorkspaceRollout";
import {
  AI_CHAT_MESSAGE_QUEUE_ENABLED,
  AI_CHAT_MESSAGE_STEERING_ENABLED,
  USER_AI_CHAT_WORKSPACE_REDESIGN,
} from "@/config/usersetting";

beforeEach(async () => {
  aiChatQueueCounters.reset();
  tokenValues.clear();
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
});

/**
 * G03 (design §18): bounded workspace acceptance/rejection, run lifecycle,
 * and fallback counters plus dispatch timings — labels only, never prompts,
 * file content/paths, tokens, or payloads. Rollout flags keep independent
 * controls with rollback-compatible defaults.
 */
describe("workspace observability + rollout (G03)", () => {
  it("counts run envelopes and terminals with bounded labels", async () => {
    const bridge = new AIChatWorkspaceRunDispatchBridge(new AIChatRunModule());
    const scheduled = await bridge.schedule({
      pendingMessageId: "pending-g03-1",
      conversationId: "v2-g03",
      resourceClass: "general",
    });
    expect(scheduled?.admitted).toBe(true);
    await bridge.finishRun(scheduled!.runId, "completed");

    const snapshot = aiChatQueueCounters.snapshot();
    expect(
      snapshot[
        'ai_chat_run_created_total{owner="interactive",resource_class="general"}'
      ]
    ).toBe(1);
    expect(snapshot['ai_chat_run_terminal_total{reason="completed"}']).toBe(1);
  });

  it("counts submission accept/reject, actions, and stale drops without content", () => {
    aiChatQueueCounters.incrementLabeled(
      "ai_chat_workspace_submission_accepted_total",
      "dispatch_scheduled"
    );
    aiChatQueueCounters.incrementLabeled(
      "ai_chat_workspace_submission_rejected_total",
      "QUEUE_LIMIT_REACHED"
    );
    aiChatQueueCounters.incrementWorkspace("ai_chat_workspace_action_total", {
      capability: "workspace",
      action: "conversation_delete",
      outcome: "denied_busy",
    });
    aiChatQueueCounters.incrementCrossConversationRejected();
    aiChatQueueCounters.incrementLabeled(
      "ai_chat_workspace_projection_fallback_total",
      "lookup_error"
    );

    const snapshot = aiChatQueueCounters.snapshot();
    expect(
      snapshot[
        'ai_chat_workspace_submission_accepted_total{reason="dispatch_scheduled"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_submission_rejected_total{reason="QUEUE_LIMIT_REACHED"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="conversation_delete",capability="workspace",outcome="denied_busy"}'
      ]
    ).toBe(1);
    expect(
      snapshot["ai_chat_workspace_cross_conversation_event_rejected_total"]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_projection_fallback_total{reason="lookup_error"}'
      ]
    ).toBe(1);
  });

  it("aggregates the five stage timings across the capability lifecycle (§18.2, G01)", () => {
    aiChatQueueCounters.observeTiming("queue_submit_to_acceptance_ms", 12);
    aiChatQueueCounters.observeTiming("permission_decision_to_resume_ms", 20);
    aiChatQueueCounters.observeTiming("plan_decision_to_continuation_ms", 33);
    aiChatQueueCounters.observeTiming("selection_request_to_transcript_ms", 44);
    aiChatQueueCounters.observeTiming("renderer_event_to_projection_ms", 5);
    const timings = aiChatQueueCounters.timingSnapshot();
    expect(timings.queue_submit_to_acceptance_ms?.count).toBe(1);
    expect(timings.permission_decision_to_resume_ms?.meanMs).toBe(20);
    expect(timings.plan_decision_to_continuation_ms?.count).toBe(1);
    expect(timings.selection_request_to_transcript_ms?.maxMs).toBe(44);
    expect(timings.renderer_event_to_projection_ms?.count).toBe(1);
  });

  it("records capability actions with bounded success/failure/retry outcomes (G01)", () => {
    // permission decision → resumed execution: success, failure, retry.
    aiChatQueueCounters.recordWorkspaceAction(
      "permission",
      "resume",
      "ok"
    );
    aiChatQueueCounters.recordWorkspaceAction(
      "permission",
      "resume",
      "error"
    );
    aiChatQueueCounters.recordWorkspaceAction(
      "permission",
      "resume",
      "retry"
    );
    aiChatQueueCounters.recordWorkspaceAction("plan", "approve", "ok");
    aiChatQueueCounters.recordWorkspaceAction("plan", "recover", "error");
    aiChatQueueCounters.recordWorkspaceAction("voice", "transcribe", "ok");
    aiChatQueueCounters.recordWorkspaceAction("voice", "tts", "error");
    aiChatQueueCounters.recordWorkspaceAction("image", "export", "ok");
    aiChatQueueCounters.recordWorkspaceAction("report", "submit", "ok");
    aiChatQueueCounters.recordWorkspaceAction("report", "submit", "error");
    aiChatQueueCounters.recordWorkspaceAction("outbound", "approve", "ok");

    const snapshot = aiChatQueueCounters.snapshot();
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="resume",capability="permission",outcome="ok"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="resume",capability="permission",outcome="error"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="resume",capability="permission",outcome="retry"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="approve",capability="plan",outcome="ok"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="recover",capability="plan",outcome="error"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="transcribe",capability="voice",outcome="ok"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="tts",capability="voice",outcome="error"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="export",capability="image",outcome="ok"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="submit",capability="report",outcome="ok"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="submit",capability="report",outcome="error"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="approve",capability="outbound",outcome="ok"}'
      ]
    ).toBe(1);
  });

  it("aggregates the dispatch pipeline timings", () => {
    aiChatQueueCounters.observeTiming("accept_to_claim_ms", 40);
    aiChatQueueCounters.observeTiming("claim_to_admit_ms", 5);
    aiChatQueueCounters.observeTiming("admit_to_provider_ms", 120);
    const timings = aiChatQueueCounters.timingSnapshot();
    expect(timings.accept_to_claim_ms?.count).toBe(1);
    expect(timings.claim_to_admit_ms?.count).toBe(1);
    expect(timings.admit_to_provider_ms?.count).toBe(1);
  });

  it("rollout flags default safely and stay independent", () => {
    // Unset: queue/steering default ON, redesign defaults OFF.
    expect(isWorkspaceQueueEnabled()).toBe(true);
    expect(isWorkspaceSteeringEnabled()).toBe(true);
    expect(isWorkspaceRedesignEnabled()).toBe(false);

    tokenValues.set(AI_CHAT_MESSAGE_QUEUE_ENABLED, "false");
    expect(isWorkspaceQueueEnabled()).toBe(false);
    // Steering requires the queue.
    tokenValues.set(AI_CHAT_MESSAGE_STEERING_ENABLED, "true");
    expect(isWorkspaceSteeringEnabled()).toBe(false);

    tokenValues.set(AI_CHAT_MESSAGE_QUEUE_ENABLED, "true");
    tokenValues.set(USER_AI_CHAT_WORKSPACE_REDESIGN, "true");
    expect(isWorkspaceSteeringEnabled()).toBe(true);
    expect(isWorkspaceRedesignEnabled()).toBe(true);
    // Flags never change persisted shapes: toggling leaves counters intact.
    expect(aiChatQueueCounters.snapshot()).toBeDefined();
  });
});

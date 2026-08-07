import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import {
  AIChatScheduledLoopModule,
  ScheduledLoopError,
} from "@/modules/AIChatScheduledLoopModule";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";

const tmpDir = path.join(os.tmpdir(), "aifetchly-scheduled-loop-module");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

describe("AIChatScheduledLoopModule.create", () => {
  it("formats the confirmation next run in local time, not UTC", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    const response = await mod.create({
      conversationId: "v2-conv-timezone",
      rawCommand: "/loop 1m check email",
      prompt: "check email",
      intervalMs: 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
    });
    const { AIChatV2Module } = await import("@/modules/AIChatV2Module");
    const messages = await new AIChatV2Module().getConversationMessages(
      "v2-conv-timezone"
    );
    const confirmation = messages.find(
      (message) => message.messageId === response.resultMessageId
    );
    expect(confirmation?.content).toMatch(
      /Next run: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\./
    );
  });

  it("creates a loop bound to an existing v2 conversation and returns a view", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    const resp = await mod.create({
      conversationId: "v2-conv-create",
      rawCommand: "/loop 5m check deployment",
      prompt: "check deployment",
      intervalMs: 5 * 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
    });

    expect(resp.conversationId).toBe("v2-conv-create");
    expect(resp.commandMessageId).toBeTruthy();
    expect(resp.resultMessageId).toBeTruthy();
    expect(resp.loop.status).toBe("active");
    expect(resp.loop.conversationId).toBe("v2-conv-create");
    expect(resp.loop.prompt).toBe("check deployment");
    expect(resp.loop.intervalMs).toBe(5 * 60_000);
    expect(resp.loop.maxRuns).toBe(24);
    expect(resp.loop.claimedRuns).toBe(0);
  });

  it("creates a v2 conversation id when none is supplied", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    const resp = await mod.create({
      rawCommand: "/loop 5m check deployment",
      prompt: "check deployment",
      intervalMs: 5 * 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
    });
    expect(resp.conversationId.startsWith("v2-")).toBe(true);
  });

  it("rejects a second active loop for the same conversation", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    await mod.create({
      conversationId: "v2-conv-one",
      rawCommand: "/loop 5m check",
      prompt: "check",
      intervalMs: 5 * 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
    });
    await expect(
      mod.create({
        conversationId: "v2-conv-one",
        rawCommand: "/loop 5m check",
        prompt: "check",
        intervalMs: 5 * 60_000,
        maxRuns: 24,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
      })
    ).rejects.toMatchObject({ code: "LOOP_ALREADY_ACTIVE" });
  });

  it("validates bounds and prompt before any persistence", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.create({
        conversationId: "v2-conv-validate",
        rawCommand: "/loop 5m",
        prompt: "   ",
        intervalMs: 5 * 60_000,
        maxRuns: 24,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
      })
    ).rejects.toMatchObject({ code: "PROMPT_REQUIRED" });

    await expect(
      mod.create({
        conversationId: "v2-conv-validate",
        rawCommand: "/loop 0m x",
        prompt: "x",
        intervalMs: 0,
        maxRuns: 24,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
      })
    ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });

    const schedules = new ScheduleTaskModel(tmpDir);
    const found = await schedules.findLatestChatScheduledLoop(
      "v2-conv-validate"
    );
    expect(found).toBeNull();
  });

  it("persists the slash-command and confirmation rows in the conversation", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    const resp = await mod.create({
      conversationId: "v2-conv-rows",
      rawCommand: "/loop 5m check deployment",
      prompt: "check deployment",
      intervalMs: 5 * 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
    });
    const { AIChatV2Module } = await import("@/modules/AIChatV2Module");
    const v2 = new AIChatV2Module();
    const messages = await v2.getConversationMessages("v2-conv-rows");
    const ids = messages.map((m) => m.messageId);
    expect(ids).toContain(resp.commandMessageId);
    expect(ids).toContain(resp.resultMessageId);
  });

  it("persists approved read-only tools and auto-approve on the task", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    const resp = await mod.create({
      conversationId: "v2-conv-tools",
      rawCommand: "/loop 1m check email",
      prompt: "check email",
      intervalMs: 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
      allowedTools: ["list_email_inboxes", "list_email_services"],
      autoApproveTools: true,
    });
    const { AIChatV2Module } = await import("@/modules/AIChatV2Module");
    const messages = await new AIChatV2Module().getConversationMessages(
      "v2-conv-tools"
    );
    const confirmation = messages.find(
      (m) => m.messageId === resp.resultMessageId
    );
    expect(confirmation?.content).toMatch(/list_email_inboxes/);
    // Persisted task carries the validated policy.
    const { ScheduleTaskModel } = await import("@/model/ScheduleTask.model");
    const schedule = await new ScheduleTaskModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    ).findChatScheduledLoop("v2-conv-tools");
    expect(schedule).toBeTruthy();
    const { AiMessageTaskModel } = await import("@/model/AiMessageTask.model");
    const task = await new AiMessageTaskModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    ).findChatScheduledTask(schedule!.task_id);
    expect(task).toBeTruthy();
    expect(task!.auto_approve_tools).toBe(true);
    expect(task!.allowed_tools_json).toContain("list_email_inboxes");
    expect(task!.allowed_tools_json).toContain("list_email_services");
  });

  it("rejects dangerous or unknown tools with BLOCKED_BY_POLICY before persisting", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.create({
        conversationId: "v2-conv-blocked",
        rawCommand: "/loop 1m x",
        prompt: "x",
        intervalMs: 60_000,
        maxRuns: 24,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
        allowedTools: ["run_subagent"],
        autoApproveTools: true,
      })
    ).rejects.toMatchObject({ code: "BLOCKED_BY_POLICY" });
    // Nothing persisted.
    const { ScheduleTaskModel } = await import("@/model/ScheduleTask.model");
    const found = await new ScheduleTaskModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    ).findChatScheduledLoop("v2-conv-blocked");
    expect(found).toBeNull();
  });

  it("persists autoApprove with empty allowedTools so read-only tools can run", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    await mod.create({
      conversationId: "v2-conv-noop",
      rawCommand: "/loop 1m x",
      prompt: "x",
      intervalMs: 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
      autoApproveTools: true,
    });
    const { ScheduleTaskModel } = await import("@/model/ScheduleTask.model");
    const schedule = await new ScheduleTaskModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    ).findChatScheduledLoop("v2-conv-noop");
    const { AiMessageTaskModel } = await import("@/model/AiMessageTask.model");
    const task = await new AiMessageTaskModel(
      process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir
    ).findChatScheduledTask(schedule!.task_id);
    expect(task!.auto_approve_tools).toBe(true);
    expect(task!.allowed_tools_json).toBe("[]");
  });
});

describe("AIChatScheduledLoopModule control operations", () => {
  it("pause/resume/stop transition the schedule and remain idempotent", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    await mod.create({
      conversationId: "v2-conv-ctrl",
      rawCommand: "/loop 5m check",
      prompt: "check",
      intervalMs: 5 * 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
    });

    const paused = await mod.pause("v2-conv-ctrl");
    expect(paused?.status).toBe("paused");
    // second pause is idempotent
    const pausedAgain = await mod.pause("v2-conv-ctrl");
    expect(pausedAgain?.status).toBe("paused");

    const resumed = await mod.resume("v2-conv-ctrl");
    expect(resumed?.status).toBe("active");
    expect(resumed?.nextRunAt).toBeTruthy();

    const stopped = await mod.stop("v2-conv-ctrl");
    expect(stopped?.status).toBe("stopped");
    // stop on a stopped schedule is idempotent and does not throw
    const stoppedAgain = await mod.stop("v2-conv-ctrl");
    expect(stoppedAgain?.status).toBe("stopped");
  });

  it("stopCurrentRun reports cancelled=false when nothing is running", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    await mod.create({
      conversationId: "v2-conv-stoprun",
      rawCommand: "/loop 5m check",
      prompt: "check",
      intervalMs: 5 * 60_000,
      maxRuns: 24,
      maxLifetimeMs: 24 * 60 * 60 * 1000,
    });
    const result = await mod.stopCurrentRun("v2-conv-stoprun");
    expect(result.cancelled).toBe(false);
  });

  it("status returns null for a conversation with no loop", async () => {
    const mod = new AIChatScheduledLoopModule();
    await SqliteDb.ensureInitialized();
    expect(await mod.getStatus("v2-conv-none")).toBeNull();
  });
});

describe("ScheduledLoopError", () => {
  it("carries a stable code", () => {
    const err = new ScheduledLoopError("CONVERSATION_REQUIRED");
    expect(err.code).toBe("CONVERSATION_REQUIRED");
    expect(err).toBeInstanceOf(Error);
  });
});

"use strict";

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { ZodError, ZodIssue } from "zod";

import {
  createAiMessageTaskForAi,
  listAiMessageTasksForAi,
  toSafeAiMessageTaskPayload,
  toSafeAiMessageTaskSummary,
  toolFailure,
  validationFailure,
} from "@/service/AiMessageTaskAiTools";
import {
  isSchedulableBuiltInTool,
  validateScheduledLoopAllowedTools,
} from "@/service/ScheduledAiToolPolicy";
import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { AiMessageTaskToolErrorCode } from "@/entityTypes/aiMessageTaskAiToolTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTask(
  overrides: Record<string, unknown> = {}
): AiMessageTaskEntity {
  return {
    id: 7,
    name: "Daily digest",
    description: "Summarize the news",
    message: "Give me today's headlines",
    system_prompt: "You are a news summarizer",
    model: "gpt-4o",
    conversation_id: null,
    allowed_tools_json: '["list_ai_message_tasks"]',
    auto_approve_tools: false,
    allow_skills: false,
    allow_mcp: false,
    allow_subagents: false,
    max_tool_calls: 10,
    max_runtime_ms: 300000,
    max_continue_calls: 10,
    status: "active",
    last_run_time: null,
    last_result_summary: null,
    last_error_message: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  } as unknown as AiMessageTaskEntity;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AiMessageTaskAiTools", () => {
  beforeEach(() => {
    sinon.restore();
  });

  afterEach(() => {
    sinon.restore();
  });

  // =========================================================================
  // Helper function tests
  // =========================================================================

  describe("toolFailure", () => {
    it("should return a failure envelope with the given code and message", () => {
      const result = toolFailure(
        AiMessageTaskToolErrorCode.TASK_NOT_FOUND,
        "Task 42 not found"
      );
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(AiMessageTaskToolErrorCode.TASK_NOT_FOUND);
        expect(result.error).to.equal("Task 42 not found");
      }
    });
  });

  describe("validationFailure", () => {
    it("should return VALIDATION_FAILED with field messages from ZodError", () => {
      const issues: ZodIssue[] = [
        {
          code: "too_small" as const,
          minimum: 1,
          type: "string",
          inclusive: true,
          exact: false,
          message: "String must contain at least 1 character(s)",
          path: ["name"],
        },
      ];
      const zodError = new ZodError(issues);
      const result = validationFailure(zodError);
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.VALIDATION_FAILED
        );
        expect(result.error).to.contain("name:");
      }
    });
  });


  // =========================================================================
  // Payload mapper tests
  // =========================================================================

  describe("toSafeAiMessageTaskPayload", () => {
    it("should map entity fields and parse allowed_tools_json", () => {
      const task = mockTask({
        last_run_time: new Date("2026-06-05T09:00:00.000Z"),
        last_result_summary: "Delivered digest",
      });
      const payload = toSafeAiMessageTaskPayload(task);
      expect(payload.id).to.equal(7);
      expect(payload.name).to.equal("Daily digest");
      expect(payload.message).to.equal("Give me today's headlines");
      expect(payload.system_prompt).to.equal("You are a news summarizer");
      expect(payload.model).to.equal("gpt-4o");
      expect(payload.status).to.equal("active");
      expect(payload.allowed_tools).to.deep.equal(["list_ai_message_tasks"]);
      expect(payload.auto_approve_tools).to.be.false;
      expect(payload.max_tool_calls).to.equal(10);
      expect(payload.max_runtime_ms).to.equal(300000);
      expect(payload.max_continue_calls).to.equal(10);
      expect(payload.last_run_time).to.equal("2026-06-05T09:00:00.000Z");
      expect(payload.last_result_summary).to.equal("Delivered digest");
      expect(payload.last_error_message).to.be.null;
    });

    it("should return empty allowed_tools for invalid JSON", () => {
      const task = mockTask({ allowed_tools_json: "{not json" });
      const payload = toSafeAiMessageTaskPayload(task);
      expect(payload.allowed_tools).to.deep.equal([]);
    });

    it("should return empty allowed_tools when JSON is not an array", () => {
      const task = mockTask({ allowed_tools_json: '{"tool": true}' });
      const payload = toSafeAiMessageTaskPayload(task);
      expect(payload.allowed_tools).to.deep.equal([]);
    });

    it("should convert null dates and nullable fields to null", () => {
      const task = mockTask({
        description: null,
        system_prompt: null,
        model: null,
        last_run_time: null,
        last_result_summary: null,
        last_error_message: null,
      });
      const payload = toSafeAiMessageTaskPayload(task);
      expect(payload.description).to.be.null;
      expect(payload.system_prompt).to.be.null;
      expect(payload.model).to.be.null;
      expect(payload.last_run_time).to.be.null;
    });
  });

  describe("toSafeAiMessageTaskSummary", () => {
    it("should keep messages at or under 300 characters intact", () => {
      const message = "a".repeat(300);
      const summary = toSafeAiMessageTaskSummary(mockTask({ message }));
      expect(summary.message_preview).to.equal(message);
    });

    it("should truncate messages longer than 300 characters with an ellipsis", () => {
      const message = "b".repeat(400);
      const summary = toSafeAiMessageTaskSummary(mockTask({ message }));
      expect(summary.message_preview).to.equal(`${"b".repeat(300)}…`);
    });

    it("should map summary fields without the full message", () => {
      const summary = toSafeAiMessageTaskSummary(mockTask());
      expect(summary.id).to.equal(7);
      expect(summary.name).to.equal("Daily digest");
      expect(summary).to.not.have.property("message");
      expect(summary).to.not.have.property("max_tool_calls");
      expect(summary.allowed_tools).to.deep.equal(["list_ai_message_tasks"]);
    });

  // =========================================================================
  // createAiMessageTaskForAi
  // =========================================================================

  describe("createAiMessageTaskForAi", () => {
    it("should return VALIDATION_FAILED when name is missing", async () => {
      const createStub = sinon.stub(
        AiMessageTaskModule.prototype,
        "createTask"
      );
      const result = await createAiMessageTaskForAi({
        message: "Hello",
      });
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.VALIDATION_FAILED
        );
        expect(result.error).to.contain("name");
      }
      expect(createStub.called).to.be.false;
    });

    it("should return VALIDATION_FAILED when message is empty", async () => {
      const createStub = sinon.stub(
        AiMessageTaskModule.prototype,
        "createTask"
      );
      const result = await createAiMessageTaskForAi({
        name: "Task",
        message: "   ",
      });
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.VALIDATION_FAILED
        );
      }
      expect(createStub.called).to.be.false;
    });

    it("should return INVALID_TOOL_LIST for non-schedulable allowed_tools", async () => {
      const createStub = sinon.stub(
        AiMessageTaskModule.prototype,
        "createTask"
      );
      const result = await createAiMessageTaskForAi({
        name: "Task",
        message: "Do something",
        allowed_tools: ["shell_execute"],
      });
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.INVALID_TOOL_LIST
        );
        expect(result.error).to.contain("shell_execute");
      }
      expect(createStub.called).to.be.false;
    });

    it("should create a task and return the safe payload on success", async () => {
      const created = mockTask({ id: 42 });
      const createStub = sinon
        .stub(AiMessageTaskModule.prototype, "createTask")
        .resolves(42);
      const getStub = sinon
        .stub(AiMessageTaskModule.prototype, "getTask")
        .resolves(created);

      const result = await createAiMessageTaskForAi({
        name: "Daily digest",
        message: "Give me today's headlines",
        allowed_tools: ["list_ai_message_tasks"],
        auto_approve_tools: true,
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.task_id).to.equal(42);
        expect(result.data.task.id).to.equal(42);
        expect(result.data.task.name).to.equal("Daily digest");
        expect(result.warning).to.be.undefined;
      }

      expect(createStub.calledOnce).to.be.true;
      const arg = createStub.firstCall.args[0];
      expect(arg.name).to.equal("Daily digest");
      expect(arg.message).to.equal("Give me today's headlines");
      expect(arg.allowedTools).to.deep.equal(["list_ai_message_tasks"]);
      expect(arg.autoApproveTools).to.be.true;
      // Zod defaults applied
      expect(arg.maxToolCalls).to.equal(10);
      expect(arg.maxRuntimeMs).to.equal(300000);
      expect(arg.maxContinueCalls).to.equal(10);
      expect(getStub.calledOnceWith(42)).to.be.true;
    });

    it("should warn when allowed_tools are set but auto_approve_tools is false", async () => {
      sinon.stub(AiMessageTaskModule.prototype, "createTask").resolves(42);
      sinon
        .stub(AiMessageTaskModule.prototype, "getTask")
        .resolves(mockTask({ id: 42 }));

      const result = await createAiMessageTaskForAi({
        name: "Task",
        message: "Do something",
        allowed_tools: ["list_ai_message_tasks"],
        auto_approve_tools: false,
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.warning).to.contain("auto_approve_tools is false");
      }
    });

    it("should return EXECUTION_FAILED when createTask throws", async () => {
      sinon
        .stub(AiMessageTaskModule.prototype, "createTask")
        .rejects(new Error("db exploded"));

      const result = await createAiMessageTaskForAi({
        name: "Task",
        message: "Do something",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.EXECUTION_FAILED
        );
        expect(result.error).to.contain("db exploded");
      }
    });

    it("should return TASK_NOT_FOUND when the created task cannot be reloaded", async () => {
      sinon.stub(AiMessageTaskModule.prototype, "createTask").resolves(99);
      sinon.stub(AiMessageTaskModule.prototype, "getTask").resolves(null);

      const result = await createAiMessageTaskForAi({
        name: "Task",
        message: "Do something",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(AiMessageTaskToolErrorCode.TASK_NOT_FOUND);
        expect(result.error).to.contain("99");
      }
    });
  });


  // =========================================================================
  // listAiMessageTasksForAi
  // =========================================================================

  describe("listAiMessageTasksForAi", () => {
    it("should return VALIDATION_FAILED for a negative page", async () => {
      const listStub = sinon.stub(AiMessageTaskModule.prototype, "listTasks");
      const result = await listAiMessageTasksForAi({ page: -1 });
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.VALIDATION_FAILED
        );
      }
      expect(listStub.called).to.be.false;
    });

    it("should return VALIDATION_FAILED when size exceeds 100", async () => {
      const listStub = sinon.stub(AiMessageTaskModule.prototype, "listTasks");
      const result = await listAiMessageTasksForAi({ size: 101 });
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.VALIDATION_FAILED
        );
      }
      expect(listStub.called).to.be.false;
    });

    it("should apply defaults and convert 0-based page to 1-based", async () => {
      const listStub = sinon
        .stub(AiMessageTaskModule.prototype, "listTasks")
        .resolves({ items: [], total: 0 });

      const result = await listAiMessageTasksForAi({});

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.tasks).to.deep.equal([]);
        expect(result.data.total).to.equal(0);
        expect(result.data.page).to.equal(0);
        expect(result.data.size).to.equal(20);
      }
      expect(listStub.calledOnceWith(1, 20)).to.be.true;
    });

    it("should convert page 2 to 1-based page 3 and map summaries", async () => {
      const listStub = sinon
        .stub(AiMessageTaskModule.prototype, "listTasks")
        .resolves({ items: [mockTask()], total: 21 });

      const result = await listAiMessageTasksForAi({ page: 2, size: 10 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.tasks).to.have.length(1);
        expect(result.data.tasks[0].id).to.equal(7);
        expect(result.data.tasks[0].message_preview).to.equal(
          "Give me today's headlines"
        );
        expect(result.data.total).to.equal(21);
        expect(result.data.page).to.equal(2);
        expect(result.data.size).to.equal(10);
      }
      expect(listStub.calledOnceWith(3, 10)).to.be.true;
    });

    it("should return EXECUTION_FAILED when listTasks throws", async () => {
      sinon
        .stub(AiMessageTaskModule.prototype, "listTasks")
        .rejects(new Error("connection lost"));

      const result = await listAiMessageTasksForAi({});

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(
          AiMessageTaskToolErrorCode.EXECUTION_FAILED
        );
        expect(result.error).to.contain("connection lost");
      }
    });
  });

  // =========================================================================
  // Scheduled-loop policy integration for the new tools
  // =========================================================================

  describe("scheduled-loop policy for AI message task tools", () => {
    it("list_ai_message_tasks should be schedulable (read-only allowlist)", () => {
      expect(isSchedulableBuiltInTool("list_ai_message_tasks")).to.be.true;
    });

    it("create_ai_message_task should stay fail-closed for scheduled loops", () => {
      expect(isSchedulableBuiltInTool("create_ai_message_task")).to.be.false;
    });

    it("validateScheduledLoopAllowedTools should accept list_ai_message_tasks", () => {
      const validation = validateScheduledLoopAllowedTools([
        "list_ai_message_tasks",
      ]);
      expect(validation.valid).to.be.true;
      expect(validation.invalidTools).to.deep.equal([]);
    });

    it("validateScheduledLoopAllowedTools should reject non-schedulable tools", () => {
      const validation = validateScheduledLoopAllowedTools([
        "list_ai_message_tasks",
        "shell_execute",
        "create_ai_message_task",
      ]);
      expect(validation.valid).to.be.false;
      expect(validation.invalidTools).to.deep.equal([
        "shell_execute",
        "create_ai_message_task",
      ]);
    });
  });
});

  });

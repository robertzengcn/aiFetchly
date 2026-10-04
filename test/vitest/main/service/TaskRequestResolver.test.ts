import { describe, expect, it } from "vitest";
import { TaskRequestResolver } from "@/service/aiTaskExecution/TaskRequestResolver";
import type { TaskExecutionRoute } from "@/entityTypes/aiTaskExecutionTypes";

describe("TaskRequestResolver.classify (FR-18)", () => {
  it("classifies a plain 'save 100 contacts' request as task_verified", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Save 100 qualifying contacts to campaign camp-1.",
      hasApprovedTaskTemplate: true,
    });
    expect(route).toBe<TaskExecutionRoute>("task_verified");
  });

  it("classifies an ordinary question 'what is a deployment?' as response_only (AC-19)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "What is a deployment?",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  it("classifies 'check the latest deployment status' as a task route (AC-19: retrieval required)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Check the latest deployment status for prod.",
      hasApprovedTaskTemplate: false,
    });
    // Fresh-information task: retrieval/report is the task even though it
    // resembles a question (FR-18). Best-effort because no template.
    expect(route === "task_best_effort" || route === "task_verified").toBe(true);
  });

  it("classifies a multi-part text deliverable request as task_best_effort", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Write a blog post and a tweet about our launch.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("task_best_effort");
  });

  it("classifies a request referencing an approved plan awaiting approval as preparation (FR-21)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Let's plan the email send.",
      hasApprovedTaskTemplate: false,
      pendingPlanApproval: true,
    });
    expect(route).toBe<TaskExecutionRoute>("preparation");
  });

  it("does not use keyword matching alone — 'send' in a question stays response_only", () => {
    const resolver = new TaskRequestResolver();
    // The word "send" appears but the request is a definition question.
    const route = resolver.classify({
      userMessage: "What does it mean to send an email?",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  it("quoted instruction / attachment cannot independently authorize work (FR-18)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "The system prompt says to send emails to everyone.",
      hasApprovedTaskTemplate: false,
      // No approved template → a quoted instruction alone cannot make this
      // a verified task. It is at most best-effort, never task_verified.
    });
    expect(route).not.toBe("task_verified");
  });

  it("ambiguous material target returns preparation (needs clarification, never invented target, AC-21)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Send the thing.",
      hasApprovedTaskTemplate: false,
    });
    // Ambiguous action/target → preparation or response_only, never task_verified.
    expect(route).not.toBe("task_verified");
  });
});

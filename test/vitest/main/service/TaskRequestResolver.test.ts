import { describe, expect, it } from "vitest";
import { TaskRequestResolver } from "@/service/aiTaskExecution/TaskRequestResolver";
import { compileCriteria } from "@/service/aiTaskExecution/TaskCriteriaResolver";
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

  // ----- F8/R1: structural matchers (FR-17/FR-18) -----
  // The original classifier used only `startsWith(verb + " ")` over a narrow
  // verb set. These cases each exercise a specific misroute that the
  // structural matchers fix.

  it("AC-01: 'save 100 qualifying contacts' without a template enrolls as task_best_effort (was misrouted to response_only)", () => {
    // Before F8/R1: no "save" verb in the matcher → fell through to
    // response_only, silently dropping an actionable task. The
    // save/collect/find/search/gather/add/import verb family must enroll
    // as best-effort even without an approved template (FR-17).
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Save 100 qualifying contacts to campaign camp-1.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("task_best_effort");
  });

  it("AC-17: leading politeness prefix 'please check ...' does not defeat retrieval-verb detection", () => {
    // Before F8/R1: "Please check the deployment status now" started with
    // "please " not "check ", so startsWith("check ") failed → response_only.
    // A polite prefix must not defeat verb detection (FR-17).
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Please check the deployment status now.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("task_best_effort");
  });

  it("AC-19: polite-prefix action verb with a clear recipient enrolls as task_best_effort", () => {
    // "Could you send the weekly report to the marketing list" — clear
    // recipient ("to the marketing list") → not ambiguous → best_effort.
    // Before F8/R1 the polite prefix "could you " defeated startsWith("send ").
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Could you send the weekly report to the marketing list.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("task_best_effort");
  });

  it("AC-20: multi-clause request 'Find 20 leads, save them, and draft an email' enrolls as task_best_effort", () => {
    // Multi-part request with conjunctions. The first clause "Find 20 leads"
    // is an action verb with a quantity → clear target → best_effort. The
    // whole request is one task with multiple parts; the classifier need
    // only detect the lead imperative, not parse every clause.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Find 20 leads, save them, and draft an email.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("task_best_effort");
  });

  it("collect/gather/find/search/import verb family without template enrolls as task_best_effort", () => {
    // The action-verb family is broader than send/post/publish/deploy. Each
    // of these is an actionable task that was silently dropped before F8/R1.
    const resolver = new TaskRequestResolver();
    const messages = [
      "Collect all replies from the inbox.",
      "Gather the latest metrics for camp-1.",
      "Search the inbox for invoices from Acme.",
      "Import the CSV of leads into campaign 7.",
    ];
    for (const message of messages) {
      const route = resolver.classify({
        userMessage: message,
        hasApprovedTaskTemplate: false,
      });
      expect(route).toBe<TaskExecutionRoute>("task_best_effort");
    }
  });

  it("action verb with no recipient, no quantity, and few words stays preparation (AC-21 still holds)", () => {
    // The ambiguity guard must still fire after F8/R1: "post this" has an
    // action verb but no clear target → preparation, never an invented one.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Post this.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("preparation");
  });

  // ----- D2: FR-18 whole-word boundary negative -----
  // detectActionVerb matches the verb followed by a word boundary (space,
  // comma, period, or end-of-string), NOT a substring scan. So a message
  // beginning with a present-participle form like "Searching the inbox"
  // must NOT match the "search" verb — "searching" is not "search" + a
  // boundary. A substring matcher (the pre-F8 bug class) would misroute
  // this to task_best_effort. The whole-word guard is what keeps FR-18
  // honest: keyword-only matching is forbidden.
  it("FR-18 whole-word boundary: 'Searching the inbox' does NOT match the 'search' verb (no substring scan)", () => {
    const resolver = new TaskRequestResolver();
    // "Searching" starts with "search" as a substring, but the verb match
    // requires "search" + (space | "," | "." | end). "Searching" is
    // "search" + "ing" — no boundary — so it falls through to the default
    // conversational response. (If it matched, it would enroll as
    // task_best_effort or preparation, neither of which is correct for a
    // present-participle opener.)
    const route = resolver.classify({
      userMessage: "Searching the inbox for invoices.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  it("FR-18 whole-word boundary: 'Searching' alone (no trailing context) stays response_only", () => {
    // Minimal case: the participle with no recipient/quantity. Must not
    // enroll as a task — the whole-word guard rejects the "search" match.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Searching.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  // Positive control: the bare imperative "Search" DOES match (whole-word
  // at the imperative position). This proves the negative tests above are
  // testing the boundary, not a broken verb list.
  it("FR-18 whole-word boundary: bare 'Search the inbox' DOES match the 'search' verb (positive control)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Search the inbox for invoices.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("task_best_effort");
  });

  // ----- T18a: definition-vs-fresh-state disambiguation (FR-17/18, AC-19) -----
  // looksLikeDefinitionQuestion fires on "what is" + "?" BEFORE
  // fresh-information analysis, so a fresh-state question that happens to
  // open with "what is" is misrouted to response_only and silently bypasses
  // enrollment. The definition check must lose when the question asks for a
  // CURRENT/external state (status/latest/now/progress) rather than a
  // definition of a term.

  it("T18a: 'What is the latest deployment status?' is a fresh-state task, not response_only (AC-19)", () => {
    // Before T18a: startsWith("what is") + "?" → response_only, bypassing
    // enrollment for an actionable retrieval/report request.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "What is the latest deployment status?",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18a: 'What is the current progress on camp-1?' is a fresh-state task (AC-19)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "What is the current progress on camp-1?",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18a: 'What is the status of the email send?' is a fresh-state task (AC-19)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "What is the status of the email send?",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18a: polite 'Please check what the latest status is' is still a fresh-state task", () => {
    // Polite prefix + retrieval verb inside a question form.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Please check what the latest status is?",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18a: 'What is a deployment?' remains response_only (paired ordinary-definition control)", () => {
    // The paired control for the fresh-state probes above: a definition of a
    // TERM (no status/latest/now/progress signal) still ends naturally.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "What is a deployment?",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  it("T18a: 'What does deployment mean?' remains response_only (paired control)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "What does deployment mean?",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  // ----- T18b: supported-language task/deliverable phrasing (FR-17/18/19) -----
  // Two misroute classes: (1) "create" + a bare noun phrase without an
  // article ("Create three launch tweets") — DELIVERABLE_VERBS only carries
  // "create a", so the verb never matches and the request silently bypasses
  // enrollment; (2) CJK material tasks ("请保存100个合格联系人。") — the
  // English-only verb list never matches a Chinese imperative, so the
  // request falls through to response_only.

  it("T18b: 'Create three launch tweets' is a material deliverable task (was misrouted response_only)", () => {
    // Before T18b: "create a" is the only create-entry in DELIVERABLE_VERBS;
    // "create three" never matches → response_only → enrollment bypassed.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Create three launch tweets",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: Chinese material task '请保存100个合格联系人。' enrolls as a task (was response_only)", () => {
    // Before T18b: English-only verb list → no match → response_only, an
    // actionable save request silently bypassed enrollment (FR-17).
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "请保存100个合格联系人。",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: Chinese plain imperative '保存100个联系人。' enrolls as a task", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "保存100个联系人。",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: Chinese definition question '什么是部署？' remains response_only (paired control)", () => {
    // The CJK definition stem must NOT capture fresh-state or imperative
    // questions; a term definition still ends naturally.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "什么是部署？",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  it("T18b: Chinese fresh-state question '最新的部署状态是什么？' is a task (AC-19)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "最新的部署状态是什么？",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: Spanish material task 'Guarda 100 contactos calificados en la campaña camp-1.' enrolls as a task", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Guarda 100 contactos calificados en la campaña camp-1.",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: French material task 'Enregistre 100 contacts qualifiés dans la campagne camp-1.' enrolls as a task", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Enregistre 100 contacts qualifiés dans la campagne camp-1.",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: German material task 'Speichere 100 qualifizierte Kontakte in Kampagne camp-1.' enrolls as a task", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Speichere 100 qualifizierte Kontakte in Kampagne camp-1.",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: Japanese material task '100件の有効な連絡先を保存してください。' enrolls as a task", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "100件の有効な連絡先を保存してください。",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: English interrogative material task 'Can you create a summary of replies?' is a task, not response_only", () => {
    // Interrogative form of a deliverable. "create a" already matches, but
    // the case locks that the question mark does not defeat it.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Can you create a summary of replies?",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  it("T18b: ambiguous CJK imperative '发一下。' does NOT enroll as task_verified (AC-21 still holds)", () => {
    // Short CJK imperative with no recipient/quantity → ambiguous →
    // preparation/best_effort/response_only, never task_verified.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "发一下。",
      hasApprovedTaskTemplate: false,
    });
    expect(route).not.toBe("task_verified");
  });

  it("T18b: 'Create' + clear artifact 'Create the weekly report' enrolls as a task", () => {
    // "create" + bare noun (no article) with a described target.
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Create the weekly report",
      hasApprovedTaskTemplate: false,
    });
    expect(route === "task_best_effort" || route === "task_verified").toBe(
      true
    );
  });

  // ----- T18c: compiler agreement (FR-19) -----
  // The compiler must agree with the router: an enrolled CJK count request
  // compiles a structured `record_count` criterion (not just the qualitative
  // fallback), so the controller has concrete unmet work (AC-02/18).
  it("T18c: CJK count request compiles a structured record_count criterion (compiler agrees with router)", () => {
    const resolved = new TaskRequestResolver().classify({
      userMessage: "请保存100个合格联系人。",
      hasApprovedTaskTemplate: false,
    });
    expect(resolved).toBe<TaskExecutionRoute>("task_best_effort");

    const compiled = compileCriteria({
      userMessage: "请保存100个合格联系人。",
      sourceUserMessageId: "m-zh-1",
      route: resolved,
      approvedSourceMessageIds: ["m-zh-1"],
    });
    const recCount = compiled.criteria.find((c) => c.kind === "record_count");
    expect(recCount).toBeDefined();
    if (recCount && recCount.kind === "record_count") {
      expect(recCount.minimum).toBe(100);
      expect(recCount.targetId).toBe("合格联系人");
      expect(recCount.required).toBe(true);
      expect(recCount.scope).toBe("execution");
    }
  });

  it("T18c: CJK conjunction '保存100个联系人和发送5封邮件' compiles 2 criteria", () => {
    const resolved = new TaskRequestResolver().classify({
      userMessage: "保存100个联系人和发送5封邮件",
      hasApprovedTaskTemplate: false,
    });
    expect(resolved === "task_best_effort" || resolved === "task_verified").toBe(
      true
    );

    const compiled = compileCriteria({
      userMessage: "保存100个联系人和发送5封邮件",
      sourceUserMessageId: "m-zh-2",
      route: "task_best_effort",
      approvedSourceMessageIds: ["m-zh-2"],
    });
    expect(compiled.criteria.length).toBe(2);
    const recCount = compiled.criteria.find((c) => c.kind === "record_count");
    const opReceipt = compiled.criteria.find(
      (c) => c.kind === "operation_receipt"
    );
    expect(recCount).toBeDefined();
    expect(opReceipt).toBeDefined();
  });

  it("T18c: 'Create three launch tweets' compiles a structured qualitative criterion (not the fallback)", () => {
    const compiled = compileCriteria({
      userMessage: "Create three launch tweets",
      sourceUserMessageId: "m-en-3",
      route: "task_best_effort",
      approvedSourceMessageIds: ["m-en-3"],
    });
    expect(compiled.criteria.length).toBe(1);
    expect(compiled.criteria[0]?.kind).toBe("qualitative");
    // Not the ambiguous fallback: "create three..." matched the deliverable
    // pattern cleanly, so ambiguityReason stays null.
    expect(compiled.ambiguityReason).toBeNull();
    expect(compiled.criteria[0]?.description).toContain("three launch tweets");
  });
});

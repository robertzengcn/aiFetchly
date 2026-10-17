import { describe, expect, it } from "vitest";
import {
  useChatCommandRouting,
  type ChatCommandRoutingPorts,
} from "@/views/composables/aiChatWorkspace/useChatCommandRouting";

/**
 * Capability-parity PRD FR-CMD-001..009 + FR-SKL-005: the workspace routes
 * slash/goal/loop/skill commands through the SAME decision logic Chat V2
 * uses (AiChatV2.onSend's command section), extracted into a typed
 * renderer-safe router with injected ports. Every case here mirrors a
 * behavior asserted by (or inherited from) the Chat V2 reference surface.
 */

interface PortState {
  ensureCalls: number;
  localExchanges: Array<{ user: string; assistant: string }>;
  errors: Array<string | null>;
  goalCreates: Array<{ objective: string; replace: boolean }>;
  goalLoopStarts: Array<{ goalId: string; maxIterations: number }>;
  skillInvokes: Array<{ skill: string; args?: string }>;
  slashDispatches: Array<string>;
  expandedPrompts: Array<{ prompt: string; pastedContents?: Record<string, string> }>;
  clears: number;
  scheduledCreates: Array<{ rawCommand: string }>;
  loopControls: Array<"pause" | "resume" | "stop">;
  statusRefreshes: number;
  errorOrigins: Array<string | null>;
}

function makePorts(overrides: Partial<ChatCommandRoutingPorts> = {}): {
  ports: ChatCommandRoutingPorts;
  state: PortState;
} {
  const state: PortState = {
    ensureCalls: 0,
    localExchanges: [],
    errorOrigins: [] as Array<string | null>,
    errors: [],
    goalCreates: [],
    goalLoopStarts: [],
    skillInvokes: [],
    slashDispatches: [],
    expandedPrompts: [],
    clears: 0,
    scheduledCreates: [],
    loopControls: [],
    statusRefreshes: 0,
  };
  const ports: ChatCommandRoutingPorts = {
    isBusy: () => false,
    ensureConversationId: async () => {
      state.ensureCalls += 1;
      return "v2-cmd-test";
    },
    activeGoal: () => ({ goalId: "goal-1" }),
    appendLocalExchange: (user, assistant) => {
      state.localExchanges.push({ user, assistant });
    },
    setError: (message, origin) => {
      state.errors.push(message);
      state.errorOrigins.push(origin ?? null);
    },
    translate: (key, fallback, vars) =>
      vars && "name" in vars ? `T(${key}:${vars.name})` : `T(${key}:${fallback})`,
    createGoal: async (input) => {
      state.goalCreates.push({ objective: input.objective, replace: input.replace });
      return { planPrompt: "Plan mode prompt for the objective" };
    },
    startGoalLoop: async (input) => {
      state.goalLoopStarts.push({
        goalId: input.goalId,
        maxIterations: input.maxIterations,
      });
      return true;
    },
    invokePromptSkill: async (input) => {
      state.skillInvokes.push({ skill: input.skill, args: input.arguments });
      return true;
    },
    createScheduledLoop: async (input) => {
      state.scheduledCreates.push({ rawCommand: input.rawCommand });
      return { conversationId: "v2-cmd-test" };
    },
    controlScheduledLoop: async (_id, op) => {
      state.loopControls.push(op);
      return {};
    },
    getScheduledLoopStatus: async () => {
      state.statusRefreshes += 1;
      return null;
    },
    dispatchSlashCommand: async (input) => {
      state.slashDispatches.push(input.rawInput);
      return {
        status: true as const,
        action: "show_result" as const,
        content: "command result body",
        commandId: "plugin:echo",
      };
    },
    onSlashPromptExpand: async (prompt, pastedContents): Promise<boolean> => {
      state.expandedPrompts.push({ prompt, pastedContents });
      return true;
    },
    onClearConversation: async (): Promise<boolean> => {
      state.clears += 1;
      return true;
    },
    ...overrides,
  };
  return { ports, state };
}

describe("useChatCommandRouting.routeCommand", () => {
  it("returns not_command for plain text", async () => {
    const { ports } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("hello world", {});
    expect(result).toEqual({ kind: "not_command" });
  });

  it("rejects command-like input while a turn is busy with a clear explanation (FR-SUB-009)", async () => {
    const { ports } = makePorts({ isBusy: () => true });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/review Acme", {});
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("command_busy");
      expect(result.message).toContain("T(workspaceChat.command.busy");
    }
  });

  it("still stages a scheduled loop while another conversation runs (staging needs no interactive stream)", async () => {
    // chatIsRunning in the V2 reference is the ACTIVE conversation's state —
    // a busy OTHER conversation must not block staging here.
    const { ports } = makePorts({ isBusy: () => false });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 5m check the inbox", {});
    expect(result.kind).toBe("needs_scheduled_approval");
  });

  it("blocks scheduled-loop staging too while the selected conversation is busy (V2 parity)", async () => {
    const { ports, state } = makePorts({ isBusy: () => true });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 5m check the inbox", {});
    expect(result.kind).toBe("rejected");
    expect(state.scheduledCreates).toHaveLength(0);
  });

  it("routes /goal to goal creation and returns the plan-mode prompt (FR-CMD-005)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/goal grow the newsletter", {});
    expect(result).toEqual({
      kind: "submit_prompt",
      prompt: "Plan mode prompt for the objective",
      mode: "plan",
    });
    expect(state.goalCreates).toEqual([
      { objective: "grow the newsletter", replace: true },
    ]);
    // /goal is create-or-replace (retry after failed stream must not hit the
    // "active goal exists" guard).
  });

  it("rejects /goal without an objective (FR-CMD-004)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/goal", {});
    expect(result.kind).toBe("rejected");
    expect(state.goalCreates).toHaveLength(0);
  });

  it("renders a local exchange when goal creation fails", async () => {
    const { ports, state } = makePorts({
      createGoal: async () => null,
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/goal impossible", {});
    expect(result.kind).toBe("rejected");
    expect(state.localExchanges).toHaveLength(1);
    expect(state.localExchanges[0].user).toBe("/goal impossible");
  });

  it("starts the goal loop for /loop <count> with an active goal (FR-CMD-006)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 4", {});
    expect(result.kind).toBe("completed");
    expect(state.goalLoopStarts).toEqual([
      { goalId: "goal-1", maxIterations: 4 },
    ]);
  });

  it("renders a local exchange for /loop without an active goal", async () => {
    const { ports, state } = makePorts({ activeGoal: () => null });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 4", {});
    expect(result.kind).toBe("completed");
    expect(state.goalLoopStarts).toHaveLength(0);
    expect(state.localExchanges).toHaveLength(1);
  });

  it("renders a local exchange for /loop without a count", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop", {});
    expect(result.kind).toBe("completed");
    expect(state.localExchanges[0].assistant).toContain("countRequired");
  });

  it("rejects an out-of-range iteration count before any IPC", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 99", {});
    expect(result.kind).toBe("completed");
    expect(state.localExchanges[0].assistant).toContain("countRange");
    expect(state.goalLoopStarts).toHaveLength(0);
  });

  it("stages /loop <interval> <prompt> for approval before persistence (FR-CMD-007)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 10m summarize emails", {});
    expect(result.kind).toBe("needs_scheduled_approval");
    if (result.kind === "needs_scheduled_approval") {
      expect(result.action.intervalMs).toBe(600_000);
      expect(result.action.prompt).toBe("summarize emails");
      expect(result.rawCommand).toBe("/loop 10m summarize emails");
    }
    // Nothing persisted yet — approval comes first.
    expect(state.scheduledCreates).toHaveLength(0);
  });

  it("persists the staged scheduled loop only after explicit confirmation", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/loop 10m summarize emails", {});
    await router.confirmScheduledLoop({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
    });
    expect(state.scheduledCreates).toHaveLength(1);
    expect(state.scheduledCreates[0].rawCommand).toBe("/loop 10m summarize emails");
  });

  it("discards the staged scheduled loop on cancel", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/loop 10m summarize emails", {});
    router.cancelScheduledLoop();
    await router.confirmScheduledLoop({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
    });
    expect(state.scheduledCreates).toHaveLength(0);
  });

  it("runs /loop pause|resume|stop against the selected conversation only (FR-CMD-008)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    expect((await router.routeCommand("/loop pause", {})).kind).toBe("completed");
    expect((await router.routeCommand("/loop resume", {})).kind).toBe("completed");
    expect((await router.routeCommand("/loop stop", {})).kind).toBe("completed");
    expect(state.loopControls).toEqual(["pause", "resume", "stop"]);
  });

  it("refreshes status for /loop status", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop status", {});
    expect(result.kind).toBe("completed");
    expect(state.statusRefreshes).toBe(1);
  });

  it("rejects malformed scheduled-loop syntax with the localized parser error", async () => {
    const { ports } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 0m nope", {});
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("INVALID_INTERVAL");
    }
  });

  it("invokes the prompt-skill service for /skill and submits the task once (FR-SKL-005)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/skill pdf-extract parse the q3 report", {});
    expect(result).toEqual({
      kind: "submit_prompt",
      prompt: "parse the q3 report",
      mode: "chat",
    });
    expect(state.skillInvokes).toEqual([
      { skill: "pdf-extract", args: "parse the q3 report" },
    ]);
  });

  it("falls back to the default skill task when /skill has no task text", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/skill pdf-extract", {});
    expect(result.kind).toBe("submit_prompt");
    if (result.kind === "submit_prompt") {
      expect(result.prompt.length).toBeGreaterThan(0);
      expect(result.prompt).not.toBe("pdf-extract");
    }
    expect(state.skillInvokes).toEqual([{ skill: "pdf-extract" }]);
  });

  it("never falls through to the model when the skill lookup fails (FR-SKL-005)", async () => {
    const { ports, state } = makePorts({
      invokePromptSkill: async (input): Promise<boolean> => {
        state.skillInvokes.push({ skill: input.skill, args: input.arguments });
        return false;
      },
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/skill missing-skill do things", {});
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("skill_not_found");
      expect(result.message).toContain("T(aiChatV2.skillSlash.notFound:missing-skill)");
    }
    expect(state.skillInvokes).toHaveLength(1);
  });

  it("dispatches generic slash commands through the registry (FR-CMD-001/002)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/review Acme", {});
    expect(result.kind).toBe("completed");
    expect(state.slashDispatches).toEqual(["/review Acme"]);
    expect(state.localExchanges).toEqual([
      { user: "/review Acme", assistant: "command result body" },
    ]);
  });

  it("expands a submit_prompt command exactly once and never re-dispatches it (FR-CMD-003)", async () => {
    const { ports, state } = makePorts({
      dispatchSlashCommand: async (input) => {
        state.slashDispatches.push(input.rawInput);
        return {
          status: true as const,
          action: "submit_prompt" as const,
          prompt: "/expanded body that starts with a slash",
          commandId: "plugin:x",
        };
      },
    });
    const router = useChatCommandRouting(ports);
    const pasted = { "1": "pasted body" };
    const result = await router.routeCommand("/x", { pastedContents: pasted });
    expect(result.kind).toBe("completed");
    expect(state.expandedPrompts).toEqual([
      { prompt: "/expanded body that starts with a slash", pastedContents: pasted },
    ]);
    // The expansion is submitted through the port exactly once — the caller
    // marks it isExpandedPrompt so it is NOT dispatched as a command again.
    expect(state.slashDispatches).toHaveLength(1);
  });

  it("runs the built-in clear command", async () => {
    const { ports, state } = makePorts({
      dispatchSlashCommand: async () => ({
        status: true as const,
        action: "show_result" as const,
        content: "",
        commandId: "built-in:command:clear",
      }),
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/clear", {});
    expect(result.kind).toBe("completed");
    expect(state.clears).toBe(1);
  });

  it("renders a local failure exchange when the dispatcher throws (FR-CMD-004)", async () => {
    const { ports, state } = makePorts({
      dispatchSlashCommand: async () => {
        throw new Error("registry offline");
      },
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/anything", {});
    expect(result.kind).toBe("completed");
    expect(state.localExchanges[0].assistant).toContain("registry offline");
  });

  it("B11: generic slash + files expands with files preserved (exact payload, acceptance honored)", async () => {
    const seen: Array<{ prompt: string; files?: readonly unknown[] }> = [];
    const { ports, state } = makePorts({
      dispatchSlashCommand: async (input) => {
        state.slashDispatches.push(input.rawInput);
        return {
          status: true as const,
          action: "submit_prompt" as const,
          prompt: "expanded prompt",
          commandId: "plugin:x",
        };
      },
      onSlashPromptExpand: async (prompt, _pasted, _conv, _accepted, files) => {
        seen.push({ prompt, files });
        return true;
      },
    });
    const router = useChatCommandRouting(ports);
    const file = new File(["x"], "a.png", { type: "image/png" });
    // Dispatcher owns the input (raw text never reaches the model as chat).
    const result = await router.routeCommand("/review Acme", {
      hasFiles: true,
      files: [file],
    });
    expect(state.slashDispatches).toEqual(["/review Acme"]);
    expect(result).toEqual({ kind: "completed", acceptedSend: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].prompt).toBe("expanded prompt");
    expect(seen[0].files).toHaveLength(1);
  });

  it("B11: generic receipt/clear + files rejects explicitly with the draft retained", async () => {
    const { ports } = makePorts({
      dispatchSlashCommand: async () => ({
        status: true as const,
        action: "show_result" as const,
        content: "receipt body",
        commandId: "plugin:echo",
      }),
    });
    const router = useChatCommandRouting(ports);
    const file = new File(["x"], "a.png", { type: "image/png" });
    const result = await router.routeCommand("/echo hi", {
      hasFiles: true,
      files: [file],
    });
    // Handled-but-rejected: nothing silently dropped, draft retained.
    expect(result.kind).toBe("rejected");
    expect(result).toMatchObject({ code: "command_files_not_supported" });
  });

  it("B11: /goal and /skill route with files (preserved through their submit_prompt sends)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const file = new File(["x"], "a.png", { type: "image/png" });
    const goalResult = await router.routeCommand("/goal ship it", {
      hasFiles: true,
      files: [file],
    });
    expect(goalResult.kind).toBe("submit_prompt");
    // The registry is bypassed for goal commands (no double dispatch).
    expect(state.slashDispatches).toHaveLength(0);

    const skillResult = await router.routeCommand("/skill review do it", {
      hasFiles: true,
      files: [file],
    });
    expect(skillResult.kind).toBe("submit_prompt");
  });

  it("reports acceptedSend=false when the expanded prompt send is rejected (FR-SUB-002)", async () => {
    const { ports, state } = makePorts({
      dispatchSlashCommand: async (input) => {
        state.slashDispatches.push(input.rawInput);
        return {
          status: true as const,
          action: "submit_prompt" as const,
          prompt: "expanded prompt",
          commandId: "plugin:x",
        };
      },
      onSlashPromptExpand: async (): Promise<boolean> => false,
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/x", {});
    expect(result).toEqual({ kind: "completed", acceptedSend: false });
  });

  it("reports acceptedSend=false with an error when no conversation can be ensured", async () => {
    const { ports, state } = makePorts({
      ensureConversationId: async () => null,
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/anything", {});
    expect(result).toEqual({ kind: "completed", acceptedSend: false });
    // The silent-vanish fix: a visible error, never nothing.
    expect(state.errors.at(-1)).toContain("noConversation");
  });

  it("does not double-dispatch /goal through the generic registry", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/goal grow", {});
    expect(state.slashDispatches).toHaveLength(0);
  });

  it("B07: a command transport failure is handled-but-rejected (draft retained, origin-scoped receipt)", async () => {
    const seenExchanges: Array<{ user: string; assistant: string; origin?: string }> = [];
    const { ports, state } = makePorts({
      dispatchSlashCommand: async (input) => {
        state.slashDispatches.push(input.rawInput);
        throw new Error("transport down");
      },
      appendLocalExchange: (user, assistant, origin) => {
        seenExchanges.push({ user, assistant, origin });
      },
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/help", {});
    // Handled-but-rejected: acceptedSend false so the caller retains the
    // draft (it was never accepted for execution).
    expect(result).toEqual({ kind: "completed", acceptedSend: false });
    expect(seenExchanges).toHaveLength(1);
    expect(seenExchanges[0].origin).toBe("v2-cmd-test");
  });
});

describe("useChatCommandRouting resetConversationState", () => {
  it("discards a staged scheduled loop when the selection changes", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/loop 10m work", {});
    router.resetConversationState();
    await router.confirmScheduledLoop({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
    });
    expect(state.scheduledCreates).toHaveLength(0);
  });
});

describe("useChatCommandRouting slash suggestions scope", () => {
  it("uses the ensured conversation and workspace scope for dispatch (FR-CMD-009)", async () => {
    const seen: Array<{ conversationId: string }> = [];
    const { ports } = makePorts({
      dispatchSlashCommand: async (input) => {
        seen.push({ conversationId: input.conversationId });
        return {
          status: false as const,
          msg: "unknown command",
        };
      },
    });
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/whatever", {});
    expect(seen).toEqual([{ conversationId: "v2-cmd-test" }]);
  });
});

/**
 * R09 (audit 2026-10-17): loop commands have no attachment channel and
 * control failures must surface as failures — never silently "completed".
 */
describe("loop command attachment + control-failure handling (R09)", () => {
  it("rejects a scheduled loop staged with file attachments instead of dropping them", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 10m summarize emails", {
      files: [new File(["x"], "a.png", { type: "image/png" })],
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("loop_attachments_not_supported");
    }
    // Nothing was staged — the approval dialog must not open for a payload
    // that could never carry the attachments.
    expect(state.scheduledCreates).toHaveLength(0);
  });

  it("rejects a loop command carrying pasted blocks", async () => {
    const { ports } = makePorts();
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 5m check the logs", {
      pastedContents: { "paste-1": "log body" },
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("loop_attachments_not_supported");
    }
  });

  it("reports a failed control (transport throw) as rejected with a localized error", async () => {
    const { ports, state } = makePorts({
      controlScheduledLoop: async () => {
        throw new Error("ipc down");
      },
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop stop", {});
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("loop_control_failed");
    }
    expect(state.errors).toHaveLength(1);
  });

  it("reports a no-op control (null view) as rejected instead of completed", async () => {
    const { ports, state } = makePorts({
      controlScheduledLoop: async () => null,
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop pause", {});
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("loop_control_failed");
    }
    expect(state.errors).toHaveLength(1);
  });

  /**
   * R09-1: confirmScheduledLoop reports DURABLE persistence so the surface
   * can fire the composer acceptance exactly once (cancel/failed-create
   * retain, success consumes the draft exactly once).
   */
  it("confirm resolves TRUE exactly when the create is durable (R09-1)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/loop 10m summarize emails", {});
    const persisted = await router.confirmScheduledLoop({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
    });
    expect(persisted).toBe(true);
    expect(state.scheduledCreates).toHaveLength(1);
    // No error surfaced on success.
    expect(state.errors).toHaveLength(0);
  });

  it("confirm resolves FALSE when the create envelope is null (R09-1)", async () => {
    const { ports, state } = makePorts({
      createScheduledLoop: async (input) => {
        state.scheduledCreates.push({ rawCommand: input.rawCommand });
        return null;
      },
    });
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/loop 10m summarize emails", {});
    const persisted = await router.confirmScheduledLoop({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
    });
    expect(persisted).toBe(false);
    expect(state.errors).toHaveLength(1);
  });

  it("confirm resolves FALSE when the create transport throws (R09-1)", async () => {
    const { ports, state } = makePorts({
      createScheduledLoop: async (input) => {
        state.scheduledCreates.push({ rawCommand: input.rawCommand });
        throw new Error("ipc down");
      },
    });
    const router = useChatCommandRouting(ports);
    await router.routeCommand("/loop 10m summarize emails", {});
    const persisted = await router.confirmScheduledLoop({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
    });
    expect(persisted).toBe(false);
    expect(state.errors).toHaveLength(1);
    expect(state.statusRefreshes).toBe(0);
  });

  it("confirm resolves FALSE when nothing was staged (R09-1)", async () => {
    const { ports, state } = makePorts();
    const router = useChatCommandRouting(ports);
    const persisted = await router.confirmScheduledLoop({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
    });
    expect(persisted).toBe(false);
    expect(state.scheduledCreates).toHaveLength(0);
  });
});


/**
 * R10 (audit 2026-10-17): the /clear outcome propagates (a stale/denied/
 * failed clear never accepts the command) and async command failures are
 * scoped to the conversation that owns the command.
 */
describe("command ownership after awaits (R10)", () => {
  const clearDispatch = () => ({
    status: true as const,
    action: "show_result" as const,
    content: "",
    commandId: "built-in:command:clear",
  });

  it("keeps the draft when /clear was stale-aborted or failed (port returns false)", async () => {
    const { ports, state } = makePorts({
      dispatchSlashCommand: async () => clearDispatch(),
      onClearConversation: async (): Promise<boolean> => {
        state.clears += 1;
        return false;
      },
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/clear", {});
    expect(result).toMatchObject({ kind: "completed", acceptedSend: false });
    expect(state.clears).toBe(1);
  });

  it("accepts the clear when the port ran it", async () => {
    const { ports } = makePorts({
      dispatchSlashCommand: async () => clearDispatch(),
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/clear", {});
    expect(result).toMatchObject({ kind: "completed", acceptedSend: true });
  });

  it("scopes a goal-loop start failure to the owning conversation", async () => {
    const { ports, state } = makePorts({
      activeGoal: () => ({ goalId: "g-1" }),
      startGoalLoop: async () => false,
    });
    const router = useChatCommandRouting(ports);
    const result = await router.routeCommand("/loop 3", {});
    expect(result.kind).toBe("rejected");
    expect(state.errorOrigins[0]).toBe("v2-cmd-test");
  });
});

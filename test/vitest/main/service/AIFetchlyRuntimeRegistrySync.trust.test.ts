/**
 * AIFetchlyRuntimeRegistrySync — TRS-01 trust-filter tests.
 *
 * Verifies that applyWorkspaceSnapshot(snapshot, trust) drops untrusted
 * instructions + commands BEFORE delegating to applySnapshot (research
 * §Pitfall 8 — the blind-apply gap). The global ~/.aifetchly path still
 * calls applySnapshot directly (always trusted — regression guard).
 *
 * Per the plan: real CommandRegistry + AIFetchlyContextStore +
 * AIFetchlyRuntimeRegistrySync instances — NO mocks for the 3-method
 * collaborator. The sync layer is pure in-memory; no tmpdir needed.
 *
 * TRS-01 cases (research §Validation Architecture):
 *   (a) untrusted:        all-false trust            → 0 workspace cmds, 0 instr
 *   (b) instr-only:       instructions=true, rest F  → instr registered, cmds dropped
 *   (c) fully-trusted:    Phase 14 approved          → both registered
 *   (d) regression:       global applySnapshot path  → user commands still register
 */
import { describe, expect, it } from "vitest";
import type {
  AIFetchlyConfigSnapshot,
  AIFetchlyInstructionBlock,
  AIFetchlySourceTrust,
} from "@/entityTypes/aifetchlyConfigTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import { AIFetchlyContextStore } from "@/service/aifetchlyConfig/AIFetchlyContextStore";
import { AIFetchlyRuntimeRegistrySync } from "@/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync";
import type { WorkspaceAgentDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";

// --- Fixtures ----------------------------------------------------------------

const ALL_FALSE: AIFetchlySourceTrust = {
  instructions: false,
  commands: false,
  agents: false,
  hooks: false,
  skills: false,
};

function makeWorkspaceInstruction(
  workspaceId: string
): AIFetchlyInstructionBlock {
  return {
    id: `workspace:${workspaceId}:instructions:.aifetchly/AGENTS.md`,
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    label: "",
    relativePath: ".aifetchly/AGENTS.md",
    content: "Be terse.",
    contentHash: "h-instr-" + workspaceId,
    trusted: false,
  };
}

function makeWorkspaceCommand(
  workspaceId: string,
  name: string
): SlashCommandDefinition {
  return {
    id: `workspace:${workspaceId}:command:${name}`,
    name,
    description: `${name} command`,
    aliases: [],
    type: "prompt",
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    sourceLabel: "Workspace",
    requiresTrust: true,
    enabled: true,
    body: `body for ${name}`,
  };
}

function makeWorkspaceAgentDraft(
  workspaceId: string,
  name: string
): WorkspaceAgentDraft {
  return {
    id: `workspace:${workspaceId}:agent:${name}`,
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    relativePath: `.aifetchly/agents/${name}.md`,
    frontmatter: {
      name,
      description: `${name} workspace agent`,
    },
    body: `You are ${name}.`,
    contentHash: "h-agent-" + name,
  };
}

function makeWorkspaceSnapshot(
  workspaceId: string,
  instructions: readonly AIFetchlyInstructionBlock[],
  commands: readonly SlashCommandDefinition[],
  agents: readonly WorkspaceAgentDraft[] = []
): AIFetchlyConfigSnapshot {
  return {
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    rootPath: `/tmp/ws-${workspaceId}`,
    workspaceId,
    version: 1,
    files: [],
    instructions,
    commands,
    agents,
    hooks: [],
    skills: [],
    diagnostics: [],
  };
}

interface SyncStack {
  readonly registry: CommandRegistry;
  readonly agentRegistry: AgentDefinitionRegistryImpl;
  readonly store: AIFetchlyContextStore;
  readonly sync: AIFetchlyRuntimeRegistrySync;
}

function makeSync(): SyncStack {
  const registry = new CommandRegistry();
  const agentRegistry = new AgentDefinitionRegistryImpl();
  const store = new AIFetchlyContextStore();
  const sync = new AIFetchlyRuntimeRegistrySync(registry, store, agentRegistry);
  return { registry, agentRegistry, store, sync };
}

// --- Tests -------------------------------------------------------------------

describe("AIFetchlyRuntimeRegistrySync — TRS-01 applyWorkspaceSnapshot trust filter", () => {
  it("(a) untrusted workspace: instructions + commands dropped BEFORE apply", () => {
    const { registry, store, sync } = makeSync();
    const ws = "w1";
    const snap = makeWorkspaceSnapshot(
      ws,
      [makeWorkspaceInstruction(ws)],
      [makeWorkspaceCommand(ws, "review")]
    );

    sync.applyWorkspaceSnapshot(snap, ALL_FALSE);

    // TRS-01: registry never sees the workspace command.
    expect(
      registry.list().filter((c) => c.source === "workspace")
    ).toHaveLength(0);
    // TRS-01 / CTX-02: instruction cache never sees the workspace block.
    expect(store.getWorkspaceInstructions(ws)).toHaveLength(0);
  });

  it("(b) trusted-for-instructions-only: instructions registered, commands dropped", () => {
    const { registry, store, sync } = makeSync();
    const ws = "w2";
    const snap = makeWorkspaceSnapshot(
      ws,
      [makeWorkspaceInstruction(ws)],
      [makeWorkspaceCommand(ws, "review")]
    );

    sync.applyWorkspaceSnapshot(snap, { ...ALL_FALSE, instructions: true });

    expect(store.getWorkspaceInstructions(ws)).toHaveLength(1);
    expect(
      registry.list().filter((c) => c.source === "workspace")
    ).toHaveLength(0);
  });

  it("(c) fully-trusted (Phase 14 approved): both instructions and commands registered", () => {
    const { registry, store, sync } = makeSync();
    const ws = "w3";
    const snap = makeWorkspaceSnapshot(
      ws,
      [makeWorkspaceInstruction(ws)],
      [makeWorkspaceCommand(ws, "review")]
    );

    sync.applyWorkspaceSnapshot(snap, {
      ...ALL_FALSE,
      instructions: true,
      commands: true,
    });

    expect(store.getWorkspaceInstructions(ws)).toHaveLength(1);
    const workspaceCmds = registry
      .list()
      .filter((c) => c.source === "workspace");
    expect(workspaceCmds).toHaveLength(1);
    expect(workspaceCmds[0]?.name).toBe("review");
  });

  it("(d) regression: existing applySnapshot (global ~/.aifetchly path) still registers commands", () => {
    // The global user-owned path must remain unchanged — it calls applySnapshot
    // directly with every flag implicitly true. This test guards against
    // accidentally routing the global path through the trust filter.
    const { registry, sync } = makeSync();
    const cmd: SlashCommandDefinition = {
      id: "user:command:review",
      name: "review",
      description: "global review",
      aliases: [],
      type: "prompt",
      source: "user",
      sourceId: "user",
      sourceLabel: "User",
      requiresTrust: false,
      enabled: true,
      body: "global body",
    };
    const globalSnap: AIFetchlyConfigSnapshot = {
      source: "user",
      sourceId: "user",
      rootPath: "/home/user/.aifetchly",
      version: 1,
      files: [],
      instructions: [],
      commands: [cmd],
      agents: [],
      hooks: [],
      skills: [],
      diagnostics: [],
    };

    sync.applySnapshot(globalSnap);

    expect(registry.list().filter((c) => c.source === "user")).toHaveLength(1);
  });
});

describe("AIFetchlyRuntimeRegistrySync — TRS-01 agent trust filter (AGT-02)", () => {
  it("(e) trust.agents=true routes workspace agent drafts into the agent registry", () => {
    const { agentRegistry, sync } = makeSync();
    const ws = "wa1";
    const snap = makeWorkspaceSnapshot(
      ws,
      [],
      [],
      [makeWorkspaceAgentDraft(ws, "researcher")]
    );

    sync.applyWorkspaceSnapshot(snap, {
      ...ALL_FALSE,
      agents: true,
    });

    // The raw draft was converted + registered under the workspace source.
    const workspaceAgents = agentRegistry
      .list()
      .filter((a) => a.id.startsWith("workspace:wa1:agent:"));
    expect(workspaceAgents).toHaveLength(1);
    expect(workspaceAgents[0].id).toBe("workspace:wa1:agent:researcher");
  });

  it("(f) trust.agents=false drops workspace agents BEFORE registry mutation (TRS-01)", () => {
    const { agentRegistry, sync } = makeSync();
    const ws = "wa2";
    const snap = makeWorkspaceSnapshot(
      ws,
      [],
      [],
      [makeWorkspaceAgentDraft(ws, "researcher")]
    );

    sync.applyWorkspaceSnapshot(snap, ALL_FALSE);

    // TRS-01: NO workspace agent reaches the registry.
    const workspaceAgents = agentRegistry
      .list()
      .filter((a) => a.id.startsWith("workspace:wa2:agent:"));
    expect(workspaceAgents).toHaveLength(0);
  });

  it("(g) trust.agents=false but commands=true: agents dropped, commands unaffected", () => {
    const { agentRegistry, registry, sync } = makeSync();
    const ws = "wa3";
    const snap = makeWorkspaceSnapshot(
      ws,
      [],
      [makeWorkspaceCommand(ws, "review")],
      [makeWorkspaceAgentDraft(ws, "researcher")]
    );

    sync.applyWorkspaceSnapshot(snap, {
      ...ALL_FALSE,
      commands: true,
    });

    // Command IS registered (its flag is independent).
    const workspaceCmds = registry
      .list()
      .filter((c) => c.source === "workspace");
    expect(workspaceCmds).toHaveLength(1);
    // Agent is NOT registered (dropped by the agents=false filter).
    const workspaceAgents = agentRegistry
      .list()
      .filter((a) => a.id.startsWith("workspace:wa3:agent:"));
    expect(workspaceAgents).toHaveLength(0);
  });

  it("(h) rescan reconciles: a second trusted snapshot replaces the first atomically", () => {
    const { agentRegistry, sync } = makeSync();
    const ws = "wa4";
    const first = makeWorkspaceSnapshot(
      ws,
      [],
      [],
      [makeWorkspaceAgentDraft(ws, "researcher")]
    );
    sync.applyWorkspaceSnapshot(first, { ...ALL_FALSE, agents: true });
    expect(
      agentRegistry
        .list()
        .filter((a) => a.id.startsWith("workspace:wa4:agent:"))
    ).toHaveLength(1);

    // Rescan: drop "researcher", add "writer". replaceSource reconciles.
    const second = makeWorkspaceSnapshot(
      ws,
      [],
      [],
      [makeWorkspaceAgentDraft(ws, "writer")]
    );
    sync.applyWorkspaceSnapshot(second, { ...ALL_FALSE, agents: true });

    const ids = agentRegistry
      .list()
      .filter((a) => a.id.startsWith("workspace:wa4:agent:"))
      .map((a) => a.id);
    expect(ids).toEqual(["workspace:wa4:agent:writer"]);
  });
});

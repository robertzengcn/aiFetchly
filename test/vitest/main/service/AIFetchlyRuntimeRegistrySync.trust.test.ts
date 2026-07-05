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
import { AIFetchlyContextStore } from "@/service/aifetchlyConfig/AIFetchlyContextStore";
import { AIFetchlyRuntimeRegistrySync } from "@/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync";

// --- Fixtures ----------------------------------------------------------------

const ALL_FALSE: AIFetchlySourceTrust = {
  instructions: false,
  commands: false,
  agents: false,
  hooks: false,
  skills: false,
};

function makeWorkspaceInstruction(workspaceId: string): AIFetchlyInstructionBlock {
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

function makeWorkspaceSnapshot(
  workspaceId: string,
  instructions: readonly AIFetchlyInstructionBlock[],
  commands: readonly SlashCommandDefinition[]
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
    agents: [],
    hooks: [],
    skills: [],
    diagnostics: [],
  };
}

interface SyncStack {
  readonly registry: CommandRegistry;
  readonly store: AIFetchlyContextStore;
  readonly sync: AIFetchlyRuntimeRegistrySync;
}

function makeSync(): SyncStack {
  const registry = new CommandRegistry();
  const store = new AIFetchlyContextStore();
  const sync = new AIFetchlyRuntimeRegistrySync(registry, store);
  return { registry, store, sync };
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
    const workspaceCmds = registry.list().filter((c) => c.source === "workspace");
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

/**
 * AIFetchlyRuntimeRegistrySync — HOK-01 hooks-wiring tests (Phase 17 / Plan 02 Task 2a).
 *
 * Verifies that:
 *   - applyWorkspaceSnapshot applies the `hooks: trust.hooks ? snapshot.hooks : []`
 *     trust filter (untrusted workspace hooks dropped BEFORE mutation).
 *   - applySnapshot reconciles hooks via hookRegistry.replaceSource for both
 *     the global (source 'user') path and the workspace (raw draft → converted)
 *     path.
 *   - removeSource clears the source's hooks.
 *   - a rescan with a changed hook set calls replaceSource with the full new
 *     set (SC1 atomic-replace path; the reconcile itself is proven in
 *     HookRegistry.test.ts).
 *
 * A recording HookRegistryApi mock captures replaceSource calls so the sync's
 * wiring is asserted without depending on the HookRegistry singleton.
 */
import { describe, expect, it } from "vitest";
import type {
  AIFetchlyConfigSnapshot,
  AIFetchlySourceTrust,
} from "@/entityTypes/aifetchlyConfigTypes";
import type {
  CommandHookDefinition,
  HookDefinition,
} from "@/entityTypes/hookTypes";
import type { HookRegistryApi } from "@/service/hooks/HookRegistry";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import { AIFetchlyContextStore } from "@/service/aifetchlyConfig/AIFetchlyContextStore";
import { AIFetchlyRuntimeRegistrySync } from "@/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync";
import type { WorkspaceHookDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";

const ALL_FALSE: AIFetchlySourceTrust = {
  instructions: false,
  commands: false,
  agents: false,
  hooks: false,
  skills: false,
};
const HOOKS_TRUE: AIFetchlySourceTrust = { ...ALL_FALSE, hooks: true };

interface RecordedCall {
  sourceId: string;
  ids: string[];
}

/** A recording HookRegistryApi mock that captures replaceSource/unregisterSource calls. */
function makeRecordingHookRegistry(): HookRegistryApi & {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const reg: HookRegistryApi = {
    registerBuiltinHook() {
      /* no-op */
    },
    registerSessionHook() {
      /* no-op */
    },
    clearSessionHooks() {
      /* no-op */
    },
    replaceSource(sourceId: string, hooks: readonly HookDefinition[]) {
      calls.push({ sourceId, ids: hooks.map((h) => h.id) });
    },
    unregisterSource(sourceId: string) {
      calls.push({ sourceId, ids: [] });
    },
    getMatchingHooks() {
      return [];
    },
    resetForTests() {
      /* no-op */
    },
  };
  return Object.assign(reg, { calls });
}

function wsHookDraft(workspaceId: string, entries: unknown[]): WorkspaceHookDraft {
  return {
    id: `workspace:${workspaceId}:hooks`,
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    relativePath: ".aifetchly/hooks/hooks.json",
    raw: entries,
    contentHash: "h-hooks-" + workspaceId,
  };
}

function userHook(id: string): CommandHookDefinition {
  return {
    id,
    eventName: "SessionStart",
    source: "user",
    enabled: true,
    trusted: true,
    type: "command",
    command: `echo ${id}`,
    failureMode: "warn",
  };
}

function wsSnapshot(
  workspaceId: string,
  hooks: WorkspaceHookDraft[]
): AIFetchlyConfigSnapshot {
  return {
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    rootPath: `/tmp/ws-${workspaceId}`,
    workspaceId,
    version: 1,
    files: [],
    instructions: [],
    commands: [],
    agents: [],
    hooks,
    skills: [],
    diagnostics: [],
  };
}

function userSnapshot(hooks: CommandHookDefinition[]): AIFetchlyConfigSnapshot {
  return {
    source: "user",
    sourceId: "user",
    rootPath: "/tmp/user",
    version: 1,
    files: [],
    instructions: [],
    commands: [],
    agents: [],
    hooks,
    skills: [],
    diagnostics: [],
  };
}

describe("AIFetchlyRuntimeRegistrySync hooks wiring (HOK-01 / SC1)", () => {
  function makeSync(hookRegistry: HookRegistryApi) {
    const registry = new CommandRegistry();
    const agentRegistry = new AgentDefinitionRegistryImpl();
    const store = new AIFetchlyContextStore();
    const sync = new AIFetchlyRuntimeRegistrySync(
      registry,
      store,
      agentRegistry,
      hookRegistry
    );
    return sync;
  }

  it("trust.hooks=false drops workspace hooks before mutation (replaceSource called with [])", () => {
    const hookRegistry = makeRecordingHookRegistry();
    const sync = makeSync(hookRegistry);
    sync.applyWorkspaceSnapshot(
      wsSnapshot("42", [
        wsHookDraft("42", [{ event: "SessionStart", command: "echo hi" }]),
      ]),
      ALL_FALSE
    );

    const call = hookRegistry.calls.find((c) => c.sourceId === "workspace:42");
    expect(
      call,
      "hookRegistry.replaceSource was called for workspace:42"
    ).toBeDefined();
    expect(call!.ids).toEqual([]);
  });

  it("trust.hooks=true passes workspace hooks through (converted → replaceSource with scoped ids)", () => {
    const hookRegistry = makeRecordingHookRegistry();
    const sync = makeSync(hookRegistry);
    sync.applyWorkspaceSnapshot(
      wsSnapshot("42", [
        wsHookDraft("42", [
          { event: "SessionStart", command: "echo hi" },
          { event: "Stop", command: "echo bye" },
        ]),
      ]),
      HOOKS_TRUE
    );

    const call = hookRegistry.calls.find((c) => c.sourceId === "workspace:42");
    expect(call).toBeDefined();
    expect(call!.ids).toEqual(["workspace:42:hook:0", "workspace:42:hook:1"]);
  });

  it("applySnapshot reconciles global hooks via hookRegistry.replaceSource('user', ...)", () => {
    const hookRegistry = makeRecordingHookRegistry();
    const sync = makeSync(hookRegistry);
    sync.applySnapshot(
      userSnapshot([userHook("user:hook:0"), userHook("user:hook:1")])
    );

    const call = hookRegistry.calls.find((c) => c.sourceId === "user");
    expect(call).toBeDefined();
    expect(call!.ids).toEqual(["user:hook:0", "user:hook:1"]);
  });

  it("removeSource clears the source's hooks (replaceSource(sourceId, []))", () => {
    const hookRegistry = makeRecordingHookRegistry();
    const sync = makeSync(hookRegistry);
    sync.removeSource("workspace:42");

    const call = hookRegistry.calls.find((c) => c.sourceId === "workspace:42");
    expect(call).toBeDefined();
    expect(call!.ids).toEqual([]);
  });

  it("re-scan with a changed hook set calls replaceSource with the full new set (SC1)", () => {
    const hookRegistry = makeRecordingHookRegistry();
    const sync = makeSync(hookRegistry);
    // First scan: one SessionStart hook.
    sync.applyWorkspaceSnapshot(
      wsSnapshot("42", [
        wsHookDraft("42", [{ event: "SessionStart", command: "echo first" }]),
      ]),
      HOOKS_TRUE
    );
    // Second scan: a different hook (Stop). The sync must pass the full new set
    // so replaceSource atomically reconciles (old id gone) — proven in
    // HookRegistry.test.ts.
    sync.applyWorkspaceSnapshot(
      wsSnapshot("42", [
        wsHookDraft("42", [{ event: "Stop", command: "echo second" }]),
      ]),
      HOOKS_TRUE
    );

    const wsCalls = hookRegistry.calls.filter(
      (c) => c.sourceId === "workspace:42"
    );
    expect(wsCalls.length).toBe(2);
    // The last call carries exactly the new single-hook set.
    expect(wsCalls[1].ids).toEqual(["workspace:42:hook:0"]);
  });
});

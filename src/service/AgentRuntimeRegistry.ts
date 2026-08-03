// src/service/AgentRuntimeRegistry.ts
import { AgentRuntime } from "@/service/AgentRuntime";
import type { AgentRuntimeDeps } from "@/service/AgentRuntime";
import {
  getSharedAutoDreamService,
  getSharedWorkspaceAutoDreamService,
} from "@/service/AIAutoDreamFactory";

let runtime: AgentRuntime | null = null;

/** Production deps for AgentRuntime.runSync — wires the shared auto-dream
 * singletons so completed agent tasks trigger both user-memory and
 * workspace-memory consolidation. */
export function getDefaultAgentRuntimeDeps(): AgentRuntimeDeps {
  return {
    autoDreamService: getSharedAutoDreamService(),
    workspaceAutoDreamService: getSharedWorkspaceAutoDreamService(),
  };
}

export const AgentRuntimeRegistry = {
  getRuntime(): AgentRuntime {
    if (!runtime) runtime = new AgentRuntime();
    return runtime;
  },
  /** Test-only: inject a mock runtime. */
  setRuntime(r: AgentRuntime): void {
    runtime = r;
  },
} as const;

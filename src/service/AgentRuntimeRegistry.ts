// src/service/AgentRuntimeRegistry.ts
import { AgentRuntime } from "@/service/AgentRuntime";
import type { AgentRuntimeDeps } from "@/service/AgentRuntime";
import { getSharedAutoDreamService } from "@/service/AIAutoDreamFactory";

let runtime: AgentRuntime | null = null;

/** Production deps for AgentRuntime.runSync — wires the shared auto-dream
 * singleton so completed agent tasks trigger consolidation. */
export function getDefaultAgentRuntimeDeps(): AgentRuntimeDeps {
  return { autoDreamService: getSharedAutoDreamService() };
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

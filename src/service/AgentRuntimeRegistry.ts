// src/service/AgentRuntimeRegistry.ts
import { AgentRuntime } from "@/service/AgentRuntime";

let runtime: AgentRuntime | null = null;

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

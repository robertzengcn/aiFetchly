// src/service/AIChatLightweightProfiles.ts
//
// Frozen, exhaustive per-workload defaults for lightweight routing. The map
// is the single source of truth for temperature, output-token limits,
// criticality, and fallback policy. TypeScript fails compilation if a new
// workload ID in {@link AIChatLightweightWorkload} has no profile here.
import type { AIChatLightweightProfile } from "@/service/AIChatLightweightTypes";

/**
 * Exhaustive profile map. Adding a workload ID to
 * {@link AIChatLightweightWorkload} without adding it here is a compile error,
 * so a workload cannot silently ship without a routing policy.
 */
export const LIGHTWEIGHT_PROFILES: Readonly<
  Record<AIChatLightweightProfile["workload"], AIChatLightweightProfile>
> = Object.freeze({
  user_auto_dream: {
    workload: "user_auto_dream",
    temperature: 0.1,
    maxOutputTokens: 4000,
    criticality: "optional_background",
    fallback: "never",
    requiresDiscoveredSmallContext: false,
  },
  workspace_auto_dream: {
    workload: "workspace_auto_dream",
    temperature: 0.1,
    maxOutputTokens: 4000,
    criticality: "optional_background",
    fallback: "never",
    requiresDiscoveredSmallContext: false,
  },
  session_memory_summary: {
    workload: "session_memory_summary",
    temperature: 0.2,
    maxOutputTokens: 2000,
    criticality: "optional_background",
    fallback: "never",
    requiresDiscoveredSmallContext: false,
  },
  conversation_compact: {
    workload: "conversation_compact",
    temperature: 0.2,
    maxOutputTokens: 4000,
    criticality: "conversation_protection",
    fallback: "normal_once",
    requiresDiscoveredSmallContext: true,
  },
});

/** Look up a profile by workload ID. Throws if missing (should be impossible). */
export function getLightweightProfile(
  workload: AIChatLightweightProfile["workload"]
): AIChatLightweightProfile {
  const profile = LIGHTWEIGHT_PROFILES[workload];
  if (!profile) {
    throw new Error(
      `No lightweight profile registered for workload "${workload}".`
    );
  }
  return profile;
}

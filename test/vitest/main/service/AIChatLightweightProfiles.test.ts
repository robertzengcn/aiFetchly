import { describe, it, expect } from "vitest";
import {
  LIGHTWEIGHT_PROFILES,
  getLightweightProfile,
} from "@/service/AIChatLightweightProfiles";
import type { AIChatLightweightWorkload } from "@/service/AIChatLightweightTypes";

const ALL_WORKLOADS: AIChatLightweightWorkload[] = [
  "user_auto_dream",
  "workspace_auto_dream",
  "session_memory_summary",
  "conversation_compact",
];

describe("LIGHTWEIGHT_PROFILES", () => {
  it("is exhaustive — every workload ID has a profile", () => {
    for (const w of ALL_WORKLOADS) {
      expect(LIGHTWEIGHT_PROFILES[w]).toBeDefined();
      expect(LIGHTWEIGHT_PROFILES[w]!.workload).toBe(w);
    }
  });

  it("matches the PRD §8.3 numeric defaults exactly", () => {
    expect(LIGHTWEIGHT_PROFILES.user_auto_dream).toMatchObject({
      temperature: 0.1,
      maxOutputTokens: 4000,
      criticality: "optional_background",
      fallback: "never",
      requiresDiscoveredSmallContext: false,
    });
    expect(LIGHTWEIGHT_PROFILES.workspace_auto_dream).toMatchObject({
      temperature: 0.1,
      maxOutputTokens: 4000,
      criticality: "optional_background",
      fallback: "never",
      requiresDiscoveredSmallContext: false,
    });
    expect(LIGHTWEIGHT_PROFILES.session_memory_summary).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 2000,
      criticality: "optional_background",
      fallback: "never",
      requiresDiscoveredSmallContext: false,
    });
    expect(LIGHTWEIGHT_PROFILES.conversation_compact).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 4000,
      criticality: "conversation_protection",
      fallback: "normal_once",
      requiresDiscoveredSmallContext: true,
    });
  });

  it("only conversation_compact may fall back to the normal model", () => {
    for (const w of ALL_WORKLOADS) {
      const fallback = LIGHTWEIGHT_PROFILES[w]!.fallback;
      if (w === "conversation_compact") {
        expect(fallback).toBe("normal_once");
      } else {
        expect(fallback).toBe("never");
      }
    }
  });

  it("getLightweightProfile returns the registered profile", () => {
    expect(getLightweightProfile("user_auto_dream")).toBe(
      LIGHTWEIGHT_PROFILES.user_auto_dream
    );
  });
});

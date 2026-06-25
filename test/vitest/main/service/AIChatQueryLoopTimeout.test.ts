import { describe, it, expect } from "vitest";
import {
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("executeToolWithTimeout policy integration", () => {
  // The loop reads the policy via inferTimeoutClassByName when no skill
  // resolver is present. Verify the lookup behavior the loop depends on.

  it("uses browser ceiling for search_maps_businesses", () => {
    const cls = inferTimeoutClassByName("search_maps_businesses");
    expect(cls).to.equal("browser");
    expect(resolveTimeoutMs(cls)).to.equal(240_000);
  });

  it("uses fast ceiling for file_read", () => {
    const cls = inferTimeoutClassByName("file_read");
    expect(resolveTimeoutMs(cls)).to.equal(30_000);
  });

  it("uses network ceiling for analyze_website", () => {
    const cls = inferTimeoutClassByName("analyze_website");
    expect(resolveTimeoutMs(cls)).to.equal(90_000);
  });

  it("resolveTimeoutMs(async) returns null so loop dispatches to async path", () => {
    expect(resolveTimeoutMs("async")).to.equal(null);
  });
});

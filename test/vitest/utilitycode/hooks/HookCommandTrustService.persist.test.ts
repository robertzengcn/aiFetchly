import { describe, it, expect, beforeEach } from "vitest";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";

describe("HookCommandTrustService persistence hooks", () => {
  beforeEach(() => {
    HookCommandTrustService.resetForTests();
  });

  it("hydrateFromTrustedMap seeds the in-memory set", () => {
    HookCommandTrustService.hydrateFromTrustedMap(new Set(["a", "b"]));
    expect(HookCommandTrustService.isTrusted("a")).toBe(true);
    expect(HookCommandTrustService.isTrusted("b")).toBe(true);
    expect(HookCommandTrustService.isTrusted("c")).toBe(false);
  });

  it("hydrateFromTrustedMap replaces, not merges", () => {
    HookCommandTrustService.setTrusted("old", true);
    HookCommandTrustService.hydrateFromTrustedMap(new Set(["new"]));
    expect(HookCommandTrustService.isTrusted("old")).toBe(false);
    expect(HookCommandTrustService.isTrusted("new")).toBe(true);
  });

  it("snapshotTrusted returns the current trusted set", () => {
    HookCommandTrustService.setTrusted("x", true);
    HookCommandTrustService.setTrusted("y", true);
    const snap = HookCommandTrustService.snapshotTrusted();
    expect(snap.has("x")).toBe(true);
    expect(snap.has("y")).toBe(true);
    expect(snap.size).toBe(2);
  });
});

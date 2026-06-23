import { describe, it, expect, beforeEach } from "vitest";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";

describe("HookCommandTrustService", () => {
  beforeEach(() => {
    HookCommandTrustService.resetForTests();
  });

  it("reports untrusted by default", () => {
    expect(HookCommandTrustService.isTrusted("h1")).toBe(false);
  });

  it("records and reports trust", () => {
    HookCommandTrustService.setTrusted("h1", true);
    expect(HookCommandTrustService.isTrusted("h1")).toBe(true);
  });

  it("removes trust when set to false", () => {
    HookCommandTrustService.setTrusted("h1", true);
    HookCommandTrustService.setTrusted("h1", false);
    expect(HookCommandTrustService.isTrusted("h1")).toBe(false);
  });

  it("rejects empty hookId", () => {
    expect(() => HookCommandTrustService.setTrusted("", true)).toThrow();
  });

  it("resetForTests wipes all grants", () => {
    HookCommandTrustService.setTrusted("h1", true);
    HookCommandTrustService.setTrusted("h2", true);
    HookCommandTrustService.resetForTests();
    expect(HookCommandTrustService.isTrusted("h1")).toBe(false);
    expect(HookCommandTrustService.isTrusted("h2")).toBe(false);
  });
});

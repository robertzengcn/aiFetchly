import { describe, it, expect } from "vitest";
import { parsePluginIdentifier } from "@/service/pluginMarketplaces/parsePluginIdentifier";

describe("parsePluginIdentifier", () => {
  it("parses a bare plugin name", () => {
    const r = parsePluginIdentifier("lead-tools");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: "lead-tools" });
  });

  it("parses name@marketplace", () => {
    const r = parsePluginIdentifier("lead-tools@anthropics");
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value).toEqual({
        name: "lead-tools",
        marketplace: "anthropics",
      });
  });

  it("rejects empty input and returns the typed error shape", () => {
    const r = parsePluginIdentifier("");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("plugin-identifier-invalid");
      expect(r.error.recoverable).toBe(false);
      expect(r.error.message).toContain("empty");
    }
  });

  it("rejects multiple @ separators", () => {
    expect(parsePluginIdentifier("a@b@c").ok).toBe(false);
  });

  it("rejects empty marketplace segment", () => {
    expect(parsePluginIdentifier("foo@").ok).toBe(false);
  });

  it("rejects invalid name characters", () => {
    expect(parsePluginIdentifier("Bad Name@mkt").ok).toBe(false);
    expect(parsePluginIdentifier("UPPER@mkt").ok).toBe(false);
  });

  it("rejects invalid marketplace characters", () => {
    expect(parsePluginIdentifier("foo@Bad-Name").ok).toBe(false);
    expect(parsePluginIdentifier("foo@UPPER").ok).toBe(false);
  });
});

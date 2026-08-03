import { describe, it, expect } from "vitest";
import { parsePluginIdentifier } from "@/service/pluginCompat/parsePluginIdentifier";

describe("parsePluginIdentifier", () => {
  it("parses a bare name", () => {
    const r = parsePluginIdentifier("lead-tools");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ name: "lead-tools" });
  });

  it("parses name@marketplace", () => {
    const r = parsePluginIdentifier("lead-tools@anthropics");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ name: "lead-tools", marketplace: "anthropics" });
  });

  it("fails on empty string", () => {
    expect(parsePluginIdentifier("").ok).toBe(false);
  });

  it("fails on invalid name characters", () => {
    expect(parsePluginIdentifier("Lead Tools!").ok).toBe(false);
  });

  it("fails on empty marketplace", () => {
    const r = parsePluginIdentifier("foo@");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("plugin-identifier-invalid");
  });

  it("fails on invalid marketplace characters", () => {
    expect(parsePluginIdentifier("foo@Market Place!").ok).toBe(false);
  });

  it("fails on multiple @ separators", () => {
    expect(parsePluginIdentifier("foo@bar@baz").ok).toBe(false);
  });
});

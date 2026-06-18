import { describe, it, expect } from "vitest";
import {
  NpmPluginFetcher,
  buildNpmArgs,
} from "@/service/pluginSources/NpmPluginFetcher";

describe("buildNpmArgs", () => {
  it("includes --ignore-scripts", () => {
    const args = buildNpmArgs({ pkg: "x", version: "1.0.0" });
    expect(args).toEqual(
      expect.arrayContaining(["pack", "x@1.0.0", "--ignore-scripts"])
    );
  });

  it("omits version suffix when not provided", () => {
    const args = buildNpmArgs({ pkg: "x" });
    expect(args).toContain("x");
    expect(args.some((a) => a.startsWith("x@"))).toBe(false);
  });

  it("includes --registry when provided", () => {
    const args = buildNpmArgs({
      pkg: "x",
      version: "1.0.0",
      registry: "https://npm.pkg.github.com",
    });
    expect(args).toContain("--registry=https://npm.pkg.github.com");
  });

  it("emits --json for parseable output", () => {
    const args = buildNpmArgs({ pkg: "x" });
    expect(args).toContain("--json");
  });
});

describe("NpmPluginFetcher", () => {
  it("rejects empty package name", async () => {
    const f = new NpmPluginFetcher();
    const r = await f.acquire({ kind: "npm" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("permission-denied");
    }
  });

  it("rejects package names containing shell metacharacters", async () => {
    const f = new NpmPluginFetcher();
    const r = await f.acquire({
      kind: "npm",
      npmPackage: "x; rm -rf /",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("permission-denied");
    }
  });
});

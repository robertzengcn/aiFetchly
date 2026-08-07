import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  LocalAiRuntimePathService,
  resolveContainedPath,
} from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeError } from "@/entityTypes/localAiRuntimeTypes";

const ROOT = path.join(__dirname, "__pathservice_fixture__");

describe("resolveContainedPath", () => {
  test("resolves nested segments under root", () => {
    const p = resolveContainedPath(ROOT, "voice-sherpa", "1.0.0", "manifest.json");
    expect(p.startsWith(path.resolve(ROOT))).toBe(true);
  });
  test.each([
    ["parent traversal", ["..", "secret"]],
    ["nested parent traversal", ["voice-sherpa", "..", "..", "secret"]],
    ["absolute escape", ["/etc/passwd"]],
  ])("throws runtime_path_outside_root for %s", (_label, segs) => {
    expect(() => resolveContainedPath(ROOT, ...segs)).toThrow(LocalAiRuntimeError);
    try {
      resolveContainedPath(ROOT, ...segs);
    } catch (error) {
      expect((error as LocalAiRuntimeError).code).toBe("runtime_path_outside_root");
    }
  });
});

describe("LocalAiRuntimePathService", () => {
  test("runtimeRoot is <userData>/local-ai-runtimes", () => {
    const svc = new LocalAiRuntimePathService(ROOT);
    expect(svc.runtimeRoot).toBe(path.join(ROOT, "local-ai-runtimes"));
  });

  test("builds per-version paths beneath runtime dir", () => {
    const svc = new LocalAiRuntimePathService(ROOT);
    const p = svc.getRuntimePaths("voice-sherpa", "1.0.0");
    expect(p.versionRoot).toBe(
      path.join(ROOT, "local-ai-runtimes", "voice-sherpa", "1.0.0"),
    );
    expect(p.activeStatePath).toBe(
      path.join(ROOT, "local-ai-runtimes", "voice-sherpa", "active.json"),
    );
    expect(p.packageManifestPath).toBe(path.join(p.versionRoot, "manifest.json"));
  });

  test("operation paths live in hidden siblings, not version dirs", () => {
    const svc = new LocalAiRuntimePathService(ROOT);
    const op = svc.createOperationPaths("11111111-2222-3333-4444-555555555555");
    expect(op.archivePath).toBe(
      path.join(ROOT, "local-ai-runtimes", ".downloads", "11111111-2222-3333-4444-555555555555.zip.part"),
    );
    expect(op.stagingRoot).toBe(
      path.join(ROOT, "local-ai-runtimes", ".staging", "11111111-2222-3333-4444-555555555555"),
    );
  });

  test("rejects unknown runtime id", () => {
    const svc = new LocalAiRuntimePathService(ROOT);
    expect(() => svc.getRuntimePaths("evil" as never, "1.0.0")).toThrow(LocalAiRuntimeError);
  });

  test("rejects invalid runtime version (path-separator / non-semver)", () => {
    const svc = new LocalAiRuntimePathService(ROOT);
    expect(() => svc.getRuntimePaths("voice-sherpa", "../../x")).toThrow(LocalAiRuntimeError);
    expect(() => svc.getRuntimePaths("voice-sherpa", "not-a-version")).toThrow(LocalAiRuntimeError);
  });

  test("rejects malformed operation id", () => {
    const svc = new LocalAiRuntimePathService(ROOT);
    expect(() => svc.createOperationPaths("not-a-uuid")).toThrow(LocalAiRuntimeError);
    expect(() => svc.createOperationPaths("../../pwn")).toThrow(LocalAiRuntimeError);
  });

  test("isBeneathRuntimeRoot detects escapes", () => {
    const svc = new LocalAiRuntimePathService(ROOT);
    expect(svc.isBeneathRuntimeRoot(svc.runtimeRoot)).toBe(true);
    expect(svc.isBeneathRuntimeRoot(path.join(svc.runtimeRoot, "x"))).toBe(true);
    expect(svc.isBeneathRuntimeRoot("/etc/passwd")).toBe(false);
  });
});

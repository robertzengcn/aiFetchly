import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("local-AI runtime workflow ownership", () => {
  it("does not rebuild downloadable runtimes inside release.yml", () => {
    const releaseYml = readFileSync(
      path.resolve(".github/workflows/release.yml"),
      "utf8"
    );
    expect(releaseYml).not.toMatch(/^\s+build-local-ai-runtimes:/m);
    expect(releaseYml).not.toMatch(/^\s+generate-runtime-catalog:/m);
    expect(releaseYml).toMatch(
      /publish-github-release:[\s\S]*?needs:\s*\[build-windows, build-macos\]/
    );
  });

  it("rebuilds runtimes from the dedicated workflow after a fingerprint check", () => {
    const runtimeYml = readFileSync(
      path.resolve(".github/workflows/local-ai-runtime-release.yml"),
      "utf8"
    );
    expect(runtimeYml).toMatch(/should-rebuild:/);
    expect(runtimeYml).toMatch(/should-rebuild-local-ai-runtime\.mjs/);
    expect(runtimeYml).toMatch(
      /needs\.should-rebuild\.outputs\.rebuild == 'true'/
    );
    expect(runtimeYml).toMatch(/runtime-fingerprint\.json/);
  });
});

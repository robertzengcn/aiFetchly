// PluginMcpRuntimeResolver unit tests (yellow-pages plugin plan TD-02).
//
// Verifies: entry confinement (lexical + realpath/symlink), atomic
// host-context file write with execute-mode fields, release cleanup, and
// discovery-mode resolution — all against a real temp directory so symlink
// behavior is exercised for real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginMcpRuntimeResolver } from "@/service/PluginMcpRuntimeResolver";

let tmpRoot: string;
let installRoot: string;
let ctxRoot: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yp-runtime-resolver-"));
  installRoot = path.join(tmpRoot, "plugins", "demo-plugin");
  ctxRoot = path.join(tmpRoot, "ctx");
  fs.mkdirSync(path.join(installRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(installRoot, "dist", "server.cjs"), "// entry\n");
  fs.mkdirSync(path.join(tmpRoot, "outside"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "outside", "evil.cjs"), "// evil\n");
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeResolver(executionId = "exec-1"): PluginMcpRuntimeResolver {
  return new PluginMcpRuntimeResolver({
    execPath: "/fake/electron",
    tmpRoot: ctxRoot,
    installRootFor: () => installRoot,
    executionIdFactory: () => executionId,
  });
}

describe("PluginMcpRuntimeResolver", () => {
  it("resolves a discovery launch with a written host-context file", () => {
    const resolver = makeResolver();
    const r = resolver.resolveForDiscovery("demo-plugin", "dist/server.cjs", "1.2.3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { launch } = r;
    expect(launch.executable).toBe("/fake/electron");
    expect(launch.entryFile).toBe(
      path.join(installRoot, "dist", "server.cjs")
    );
    expect(launch.cwd).toBe(installRoot);
    expect(launch.ownerId).toBe("plugin-mcp:demo-plugin");
    expect(launch.extraArgs[0]).toBe("--host-context-file");
    const ctxFile = launch.extraArgs[1];
    expect(typeof ctxFile).toBe("string");
    const content = JSON.parse(fs.readFileSync(ctxFile, "utf8")) as {
      version: number;
      mode: string;
      pluginName: string;
      pluginVersion: string;
      executionId: string;
    };
    expect(content).toMatchObject({
      version: 1,
      mode: "discovery",
      pluginName: "demo-plugin",
      pluginVersion: "1.2.3",
      executionId: "exec-1",
    });
    resolver.release(launch);
    expect(fs.existsSync(ctxFile)).toBe(false);
  });

  it("carries execute-mode context fields into the host-context file", () => {
    const resolver = makeResolver("exec-2");
    const r = resolver.resolveForExecute("demo-plugin", "dist/server.cjs", {
      mode: "execute",
      executionId: "exec-2",
      pluginVersion: "1.2.3",
      outputDirectory: "/out/abc",
      browser: { executablePath: "/chrome/chrome", version: "136.0.0.0" },
      deadlineEpochMs: 1234567890,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ctxFile = r.launch.hostContextFile;
    expect(ctxFile).toBeTruthy();
    const content = JSON.parse(fs.readFileSync(ctxFile!, "utf8")) as {
      mode: string;
      outputDirectory?: string;
      browser?: { executablePath: string };
      deadlineEpochMs?: number;
    };
    expect(content.mode).toBe("execute");
    expect(content.outputDirectory).toBe("/out/abc");
    expect(content.browser?.executablePath).toBe("/chrome/chrome");
    expect(content.deadlineEpochMs).toBe(1234567890);
    resolver.release(r.launch);
  });

  it("rejects a traversal entry", () => {
    const r = makeResolver().resolveForDiscovery(
      "demo-plugin",
      "../outside/evil.cjs"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("path-outside-plugin");
  });

  it("rejects an absolute entry", () => {
    const r = makeResolver().resolveForDiscovery("demo-plugin", "/etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("path-outside-plugin");
  });

  it("rejects a symlink entry escaping the install root", () => {
    const escape = path.join(installRoot, "dist", "escape.cjs");
    fs.symlinkSync(path.join(tmpRoot, "outside", "evil.cjs"), escape);
    try {
      const r = makeResolver().resolveForDiscovery("demo-plugin", "dist/escape.cjs");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("path-outside-plugin");
    } finally {
      fs.unlinkSync(escape);
    }
  });

  it("rejects a missing entry file", () => {
    const r = makeResolver().resolveForDiscovery("demo-plugin", "dist/nope.cjs");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("missing_files");
  });

  it("rejects when the install root itself is absent", () => {
    const resolver = new PluginMcpRuntimeResolver({
      execPath: "/fake/electron",
      tmpRoot: ctxRoot,
      installRootFor: () => path.join(tmpRoot, "not-installed"),
    });
    const r = resolver.resolveForDiscovery("ghost", "dist/server.cjs");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("missing_files");
  });

  it("release is idempotent after the file is gone", () => {
    const resolver = makeResolver("exec-3");
    const r = resolver.resolveForDiscovery("demo-plugin", "dist/server.cjs");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    resolver.release(r.launch);
    resolver.release(r.launch); // must not throw
  });

  it("release removes the launched map entry so repeated resolutions do not grow state (B13)", () => {
    const resolver = makeResolver("exec-1");
    const launches: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = resolver.resolveForDiscovery("demo-plugin", "dist/server.cjs");
      if (r.ok) {
        launches.push(r.launch.executionId);
        expect(fs.existsSync(r.launch.hostContextFile ?? "")).toBe(true);
      }
    }
    expect(launches).toEqual(["exec-1", "exec-1", "exec-1"]);
    for (const ctxFile of fs.readdirSync(ctxRoot)) {
      expect(path.basename(ctxFile)).not.toMatch(/\.tmp$/);
    }
    // Audit-trail map: each resolution replaces the entry; one file per id.
    expect(fs.readdirSync(ctxRoot)).toEqual(["exec-1.json"]);
    const r = resolver.resolveForDiscovery("demo-plugin", "dist/server.cjs");
    if (r.ok) {
      resolver.release(r.launch);
      expect(fs.existsSync(r.launch.hostContextFile ?? "")).toBe(false);
    }
  });

  it("failed context writes leave no .tmp residue and no released entries behind", () => {
    const resolver = makeResolver("exec-1");
    // Force the rename to fail: pretend the final path already exists as a
    // directory so rename cannot succeed.
    fs.mkdirSync(path.join(ctxRoot, "exec-1.json"), { recursive: true });
    const r = resolver.resolveForDiscovery("demo-plugin", "dist/server.cjs");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("install-io-failed");
    // No .tmp residue (B13): the failed write path removes its staging file.
    expect(fs.readdirSync(ctxRoot).some((f) => f.endsWith(".tmp"))).toBe(false);
    fs.rmSync(path.join(ctxRoot, "exec-1.json"), { recursive: true, force: true });
  });
});

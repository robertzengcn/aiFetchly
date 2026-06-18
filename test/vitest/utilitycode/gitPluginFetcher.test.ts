import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { GitPluginFetcher } from "@/service/pluginSources/GitPluginFetcher";
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";

interface FakeChild {
  on(event: string, cb: (e?: { code: number }) => void): FakeChild;
  stderr: { on(ev: string, cb: (chunk: Buffer) => void): void };
  stdout: { on(ev: string, cb: (chunk: Buffer) => void): void };
  kill(): void;
}

type SpawnResult = { code: number; stderr?: string };

function makeSpawnSpy(result: SpawnResult): {
  spawn: (
    cmd: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv }
  ) => FakeChild;
  calls: string[][];
} {
  const calls: string[][] = [];
  const spawn = (
    _cmd: string,
    args: string[],
    _opts: { cwd: string; env: NodeJS.ProcessEnv }
  ): FakeChild => {
    calls.push(args);
    // The real `git clone <uri> <target>` creates <target>. Emulate that on
    // success so the fetcher's existence check passes.
    if (result.code === 0) {
      const targetArg = args[args.length - 1];
      try {
        fs.mkdirSync(targetArg, { recursive: true });
        fs.writeFileSync(path.join(targetArg, ".gitkeep"), "");
      } catch {
        /* ignore */
      }
    }
    return {
      on(event: string, cb: (e?: { code: number }) => void): FakeChild {
        if (event === "close") {
          setTimeout(() => cb({ code: result.code }), 0);
        }
        return this as unknown as FakeChild;
      },
      stderr: {
        on(_ev: string, cb: (chunk: Buffer) => void): void {
          if (result.stderr) cb(Buffer.from(result.stderr));
        },
      },
      stdout: {
        on(): void {
          /* noop */
        },
      },
      kill(): void {
        /* noop */
      },
    };
  };
  return { spawn, calls };
}

describe("GitPluginFetcher", () => {
  const base: PluginSourceRequest = {
    kind: "git",
    uri: "https://example.com/r.git",
    ref: "main",
  };

  it("rejects http:// URIs", async () => {
    const f = new GitPluginFetcher();
    const r = await f.acquire({ ...base, uri: "http://example.com/r.git" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("permission-denied");
    }
  });

  it("rejects local paths and file://", async () => {
    const f = new GitPluginFetcher();
    for (const bad of ["/tmp/x", "./x", "file:///tmp/x", "tmp/x"]) {
      const r = await f.acquire({ ...base, uri: bad });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.errors[0]?.code).toBe("permission-denied");
      }
    }
  });

  it("builds a shallow clone argv with --branch <ref>", async () => {
    const { spawn, calls } = makeSpawnSpy({ code: 0 });
    const f = new GitPluginFetcher(spawn as never);
    // Create the target dir so the "exists" check passes; we need the
    // fetcher's tmp dir structure to actually exist. The fetcher clones into
    // <tmp>/repo, so we pre-create it via a fake "successful" clone.
    const r = await f.acquire(base);
    expect(r.success).toBe(true);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        "clone",
        "--depth",
        "1",
        "--branch",
        "main",
        "https://example.com/r.git",
      ])
    );
    if (r.success) await r.source.cleanup();
  });

  it("omits --branch when no ref given", async () => {
    const { spawn, calls } = makeSpawnSpy({ code: 0 });
    const f = new GitPluginFetcher(spawn as never);
    const r = await f.acquire({
      kind: "git",
      uri: "https://example.com/r.git",
    });
    expect(r.success).toBe(true);
    expect(calls[0]).not.toContain("--branch");
    if (r.success) await r.source.cleanup();
  });

  it("fails cleanly when git exits non-zero (stderr suppressed)", async () => {
    const { spawn } = makeSpawnSpy({
      code: 128,
      stderr: "fatal: repository not found",
    });
    const f = new GitPluginFetcher(spawn as never);
    const r = await f.acquire(base);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("install-io-failed");
      expect(r.errors[0]?.message).not.toContain("not found");
    }
  });

  it("redacts the URI in the failure message", async () => {
    const { spawn } = makeSpawnSpy({ code: 128 });
    const f = new GitPluginFetcher(spawn as never);
    const r = await f.acquire({
      kind: "git",
      uri: "https://user:secret@example.com/r.git",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.message).not.toContain("secret");
    }
  });
});

// Ensure temp dirs created during failed-path tests don't accumulate.
// The fetcher cleans up its own dirs on success/failure; this is a backstop.

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  GitMarketplaceFetcher,
  type SpawnChildLike,
  type SpawnFn,
} from "@/service/pluginMarketplaces/GitMarketplaceFetcher";
import type { PluginMarketplaceFetchRequest } from "@/service/pluginMarketplaces/marketplaceFetcherTypes";

/**
 * Security-focused unit test for GitMarketplaceFetcher.
 *
 * The git-execution layer is the last line of defense against argument
 * injection (the upstream source parser does not scan git URLs for shell
 * metacharacters). We therefore prove, via the injectable SpawnFn seam, that
 * the `uri` and `ref` only ever reach git as discrete arg-array elements —
 * never interpolated into a command string — and that the manifest-location
 * logic is correct.
 */
const FIXTURE = JSON.stringify({
  name: "team-tools",
  owner: { name: "Team" },
  plugins: [],
});

interface FakeOpts {
  /** Build the cloned target directory contents. Default: .claude-plugin/marketplace.json. */
  readonly setupTarget?: (target: string) => void;
  /** Simulated git exit code. */
  readonly code?: number;
}

interface RecordedCall {
  readonly cmd: string;
  readonly args: string[];
  readonly opts: { cwd: string; env: NodeJS.ProcessEnv };
}

function makeChild(code: number): SpawnChildLike {
  const child = {
    on(event: string, cb: (e?: { code: number }) => void): unknown {
      if (event === "close") setTimeout(() => cb({ code }), 0);
      return undefined;
    },
    stderr: { on: () => undefined },
    stdout: { on: () => undefined },
    kill: () => true,
  };
  return child as unknown as SpawnChildLike;
}

function makeSpawnSpy(fake: FakeOpts = {}): { spawn: SpawnFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const code = fake.code ?? 0;
  const spawn: SpawnFn = (cmd, args, spawnOpts) => {
    calls.push({ cmd, args, opts: spawnOpts });
    if (code === 0) {
      // The real `git clone <uri> <target>` creates <target>. Emulate that so
      // the fetcher's on-disk existence check passes, then lay down the
      // manifest fixture wherever the test wants it.
      const target = args[args.length - 1];
      fs.mkdirSync(target, { recursive: true });
      if (fake.setupTarget) {
        fake.setupTarget(target);
      } else {
        fs.mkdirSync(path.join(target, ".claude-plugin"), { recursive: true });
        fs.writeFileSync(path.join(target, ".claude-plugin", "marketplace.json"), FIXTURE);
      }
    }
    return makeChild(code);
  };
  return { spawn, calls };
}

describe("GitMarketplaceFetcher", () => {
  const base: PluginMarketplaceFetchRequest = {
    source: { kind: "git", uri: "https://example.com/repo.git", ref: "main" },
  };

  it("invokes git with an exact discrete arg array (shell:false defense) and locates the manifest", async () => {
    const { spawn, calls } = makeSpawnSpy();
    const f = new GitMarketplaceFetcher(spawn);
    const r = await f.fetch(base);

    expect(r.success).toBe(true);
    // cmd is the bare binary, never a shell string.
    expect(calls[0]?.cmd).toBe("git");
    const target = calls[0]?.args[calls[0].args.length - 1];
    // Exact array assertion: every element is a discrete token — the uri and
    // target appear as standalone elements, never concatenated/interpolated.
    expect(calls[0]?.args).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
      "https://example.com/repo.git",
      target,
    ]);
    // uri is a discrete element (not joined into one shell string).
    expect(calls[0]?.args).toContain("https://example.com/repo.git");

    if (r.success) {
      // manifestJson matches the fixture and marketplaceRoot points at the clone target.
      expect(r.marketplace.manifestJson).toBe(FIXTURE);
      expect(r.marketplace.manifestPath).toBe(
        path.join(target, ".claude-plugin", "marketplace.json")
      );
      expect(r.marketplace.marketplaceRoot).toBe(target);
      await r.marketplace.cleanup();
    }
  });

  it("omits --branch when no ref is given (still a discrete arg array)", async () => {
    const { spawn, calls } = makeSpawnSpy();
    const f = new GitMarketplaceFetcher(spawn);
    const r = await f.fetch({ source: { kind: "git", uri: "https://example.com/repo.git" } });

    expect(r.success).toBe(true);
    expect(calls[0]?.cmd).toBe("git");
    const target = calls[0]?.args[calls[0].args.length - 1];
    expect(calls[0]?.args).toEqual([
      "clone",
      "--depth",
      "1",
      "https://example.com/repo.git",
      target,
    ]);
    expect(calls[0]?.args).not.toContain("--branch");
    if (r.success) await r.marketplace.cleanup();
  });

  it("locates a root-level marketplace.json when .claude-plugin/ is absent", async () => {
    const { spawn, calls } = makeSpawnSpy({
      setupTarget: (target) => {
        fs.writeFileSync(path.join(target, "marketplace.json"), FIXTURE);
      },
    });
    const f = new GitMarketplaceFetcher(spawn);
    const r = await f.fetch(base);

    expect(r.success).toBe(true);
    const target = calls[0]?.args[calls[0].args.length - 1];
    if (r.success) {
      expect(r.marketplace.manifestPath).toBe(path.join(target, "marketplace.json"));
      expect(r.marketplace.manifestJson).toBe(FIXTURE);
      await r.marketplace.cleanup();
    }
  });

  it("returns marketplace-manifest-not-found when no marketplace.json exists", async () => {
    const { spawn } = makeSpawnSpy({
      // Clone succeeds, target exists, but no manifest laid down.
      setupTarget: () => {
        /* no manifest */
      },
    });
    const f = new GitMarketplaceFetcher(spawn);
    const r = await f.fetch(base);

    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("marketplace-manifest-not-found");
    }
  });

  it("rejects http:// uris with marketplace-source-invalid before spawning git", async () => {
    const { spawn, calls } = makeSpawnSpy();
    const f = new GitMarketplaceFetcher(spawn);
    const r = await f.fetch({ source: { kind: "git", uri: "http://example.com/repo.git" } });

    expect(r.success).toBe(false);
    expect(calls.length).toBe(0); // spawn never invoked
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("marketplace-source-invalid");
    }
  });

  it("cleanup() removes the temp clone directory", async () => {
    const { spawn, calls } = makeSpawnSpy();
    const f = new GitMarketplaceFetcher(spawn);
    const r = await f.fetch(base);
    expect(r.success).toBe(true);
    if (r.success) {
      const target = r.marketplace.marketplaceRoot;
      const tmp = path.dirname(target); // fetcher created <tmp>/repo
      expect(fs.existsSync(tmp)).toBe(true);
      await r.marketplace.cleanup();
      expect(fs.existsSync(tmp)).toBe(false);
      expect(fs.existsSync(target)).toBe(false);
    }
  });
});

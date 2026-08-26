/**
 * Tests for the skill-installation worker offload (design §15.2):
 * protocol validation both directions, the worker client with an injected
 * stub fork, inline fallback when forking is unavailable or the worker
 * dies, and identical hashes across both staging paths.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  stagePackageRequestSchema,
  stagePackageResponseSchema,
} from "@/childprocess/skill-installation/SkillInstallationWorkerProtocol";
import {
  stagePackage,
  hashTree,
} from "@/childprocess/skill-installation/stagePackage";
import {
  SkillInstallationWorkerClient,
  type WorkerHandle,
} from "@/service/SkillInstallationWorkerClient";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-worker-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSourceTree(): string {
  const src = path.join(tmpRoot, "source");
  fs.mkdirSync(path.join(src, "helpers"), { recursive: true });
  fs.writeFileSync(path.join(src, "SKILL.md"), "# Skill\n\nbody");
  fs.writeFileSync(path.join(src, "helpers", "cut.py"), "print('cut')");
  fs.mkdirSync(path.join(src, ".git"), { recursive: true });
  fs.writeFileSync(path.join(src, ".git", "HEAD"), "ref: refs/heads/main");
  return src;
}

describe("stagePackage (shared staging logic)", () => {
  it("copies bounded trees and excludes .git + ownership metadata", () => {
    const src = makeSourceTree();
    const target = path.join(tmpRoot, "staged");
    const result = stagePackage(src, target);
    expect(result.fileCount).toBe(2);
    expect(fs.existsSync(path.join(target, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, ".git"))).toBe(false);
    expect(result.contentHash).toHaveLength(64);
  });

  it("enforces the file-count limit", () => {
    const src = makeSourceTree();
    const target = path.join(tmpRoot, "staged-limited");
    expect(() =>
      stagePackage(src, target, {
        maxFiles: 1,
        maxTotalBytes: 1e9,
        maxDepth: 20,
      })
    ).toThrow(/file limit/);
  });

  it("enforces the depth limit", () => {
    const deep = path.join(tmpRoot, "deep");
    let cursor = deep;
    for (let i = 0; i < 6; i++) {
      fs.mkdirSync(cursor, { recursive: true });
      cursor = path.join(cursor, `d${i}`);
    }
    fs.mkdirSync(cursor, { recursive: true });
    fs.writeFileSync(path.join(cursor, "f.txt"), "x");
    expect(() =>
      stagePackage(deep, path.join(tmpRoot, "staged-depth"), {
        maxFiles: 100,
        maxTotalBytes: 1e9,
        maxDepth: 3,
      })
    ).toThrow(/depth/);
  });

  it("hashTree is deterministic and order-independent of insertion", () => {
    const a = path.join(tmpRoot, "hash-a");
    const b = path.join(tmpRoot, "hash-b");
    for (const dir of [a, b]) {
      fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(dir, "x.txt"), "x");
      fs.writeFileSync(path.join(dir, "sub", "y.txt"), "y");
    }
    expect(hashTree(a)).toBe(hashTree(b));
  });
});

describe("worker protocol", () => {
  it("validates a stage-package request", () => {
    const parsed = stagePackageRequestSchema.safeParse({
      type: "stage-package",
      requestId: "r1",
      sourceRoot: "/tmp/src",
      targetRoot: "/tmp/dst",
      limits: { maxFiles: 10, maxTotalBytes: 1000, maxDepth: 5 },
    });
    expect(parsed.success).toBe(true);
    expect(
      stagePackageRequestSchema.safeParse({ type: "stage-package" }).success
    ).toBe(false);
  });

  it("validates staged and error responses", () => {
    expect(
      stagePackageResponseSchema.safeParse({
        type: "staged",
        requestId: "r1",
        fileCount: 2,
        totalBytes: 10,
        contentHash: "a".repeat(64),
      }).success
    ).toBe(true);
    expect(
      stagePackageResponseSchema.safeParse({
        type: "error",
        requestId: "r1",
        code: "SOURCE_LIMIT_EXCEEDED",
        message: "too big",
      }).success
    ).toBe(true);
    expect(
      stagePackageResponseSchema.safeParse({ type: "staged" }).success
    ).toBe(false);
  });
});

describe("SkillInstallationWorkerClient", () => {
  it("falls back to inline staging when fork is unavailable", async () => {
    const src = makeSourceTree();
    const target = path.join(tmpRoot, "inline");
    const client = new SkillInstallationWorkerClient({ fork: null });
    const outcome = await client.stage(src, target, {
      maxFiles: 100,
      maxTotalBytes: 1e9,
      maxDepth: 20,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.viaWorker).toBe(false);
    expect(outcome.result.fileCount).toBe(2);
    // Inline hash equals the shared stagePackage hash.
    expect(outcome.result.contentHash).toBe(
      stagePackage(src, path.join(tmpRoot, "inline-2")).contentHash
    );
  }, 30_000);

  it("surfaces limit failures as SOURCE_LIMIT_EXCEEDED", async () => {
    const src = makeSourceTree();
    const client = new SkillInstallationWorkerClient({ fork: null });
    const outcome = await client.stage(src, path.join(tmpRoot, "limited"), {
      maxFiles: 1,
      maxTotalBytes: 1e9,
      maxDepth: 20,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("SOURCE_LIMIT_EXCEEDED");
  });

  it("correlates responses by request id through a stub fork", async () => {
    const src = makeSourceTree();
    const target = path.join(tmpRoot, "stub-fork");
    // Stub worker: replies on the next tick with a protocol-valid response
    // whose hash matches an inline stage of the same tree.
    const expectedHash = stagePackage(
      src,
      path.join(tmpRoot, "stub-ref")
    ).contentHash;
    const handles: WorkerHandle[] = [];
    const stubFork = (): WorkerHandle => {
      const listeners: ((arg: unknown) => void)[] = [];
      const handle: WorkerHandle & {
        __emit: (msg: unknown) => void;
      } = {
        postMessage: (msg: unknown) => {
          const request = msg as { requestId: string };
          setTimeout(() => {
            for (const listener of listeners) {
              listener({
                data: {
                  type: "staged",
                  requestId: request.requestId,
                  fileCount: 2,
                  totalBytes: 100,
                  contentHash: expectedHash,
                },
              });
            }
          }, 5);
        },
        on: (_event: string, cb: (arg: unknown) => void) => {
          listeners.push(cb);
        },
        kill: () => true,
        __emit: () => undefined,
      };
      handles.push(handle);
      return handle;
    };
    const client = new SkillInstallationWorkerClient({ fork: stubFork });
    const outcome = await client.stage(src, target, {
      maxFiles: 100,
      maxTotalBytes: 1e9,
      maxDepth: 20,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.viaWorker).toBe(true);
    expect(outcome.result.contentHash).toBe(expectedHash);
    client.dispose();
  }, 30_000);

  it("ignores responses with a mismatched request id", async () => {
    const src = makeSourceTree();
    // Event-routed stub (utilityProcess semantics: message handlers only
    // receive messages, exit handlers only exits).
    const messageListeners: ((arg: unknown) => void)[] = [];
    const stubFork = (): WorkerHandle => ({
      postMessage: (msg: unknown) => {
        const request = msg as { requestId: string };
        // Reply with the WRONG id first, then the right one.
        setTimeout(() => {
          for (const listener of messageListeners) {
            listener({
              data: {
                type: "staged",
                requestId: "not-mine",
                fileCount: 0,
                totalBytes: 0,
                contentHash: "0".repeat(64),
              },
            });
          }
        }, 5);
        setTimeout(() => {
          for (const listener of messageListeners) {
            listener({
              data: {
                type: "staged",
                requestId: request.requestId,
                fileCount: 1,
                totalBytes: 1,
                contentHash: "1".repeat(64),
              },
            });
          }
        }, 30);
      },
      on: (event: string, cb: (arg: unknown) => void) => {
        if (event === "message") messageListeners.push(cb);
      },
      kill: () => true,
    });
    const client = new SkillInstallationWorkerClient({ fork: stubFork });
    const outcome = await client.stage(src, path.join(tmpRoot, "mismatch"), {
      maxFiles: 100,
      maxTotalBytes: 1e9,
      maxDepth: 20,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.contentHash).toBe("1".repeat(64));
    client.dispose();
  }, 30_000);

  it("worker death mid-request falls back to inline staging", async () => {
    const src = makeSourceTree();
    const exitListeners: ((arg: unknown) => void)[] = [];
    const stubFork = (): WorkerHandle => ({
      postMessage: () => {
        // Worker dies before replying — exit only, never a message.
        setTimeout(() => {
          for (const listener of exitListeners) listener(1);
        }, 5);
      },
      on: (event: string, cb: (arg: unknown) => void) => {
        if (event === "exit") exitListeners.push(cb);
      },
      kill: () => true,
    });
    const client = new SkillInstallationWorkerClient({ fork: stubFork });
    const outcome = await client.stage(src, path.join(tmpRoot, "died"), {
      maxFiles: 100,
      maxTotalBytes: 1e9,
      maxDepth: 20,
    });
    // The stage still completes — inline fallback with identical limits.
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.viaWorker).toBe(false);
    expect(outcome.result.fileCount).toBe(2);
    client.dispose();
  }, 30_000);
});

describe("acquisition service uses the staging client", () => {
  it("acquire() stages through inline fallback in test contexts", async () => {
    const { SkillSourceAcquisitionService } = await import(
      "@/service/SkillSourceAcquisitionService"
    );
    const src = makeSourceTree();
    const service = new SkillSourceAcquisitionService(
      { maxFiles: 100, maxTotalBytes: 1e9, timeoutMs: 30_000 },
      path.join(tmpRoot, "staging")
    );
    const acquired = await service.acquire("sess-worker-1", {
      kind: "local-directory",
      canonicalUri: src,
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(acquired.source.contentHash).toHaveLength(64);
    expect(
      fs.existsSync(path.join(acquired.source.acquiredRoot, "SKILL.md"))
    ).toBe(true);
    expect(fs.existsSync(path.join(acquired.source.acquiredRoot, ".git"))).toBe(
      false
    );
  }, 60_000);

  it("acquire() maps staging limit failures to SOURCE_LIMIT_EXCEEDED", async () => {
    const { SkillSourceAcquisitionService } = await import(
      "@/service/SkillSourceAcquisitionService"
    );
    const src = makeSourceTree();
    const service = new SkillSourceAcquisitionService(
      { maxFiles: 1, maxTotalBytes: 1e9, timeoutMs: 30_000 },
      path.join(tmpRoot, "staging-limited")
    );
    const acquired = await service.acquire("sess-worker-2", {
      kind: "local-directory",
      canonicalUri: src,
    });
    expect(acquired.ok).toBe(false);
    if (acquired.ok) return;
    expect(acquired.code).toBe("SOURCE_LIMIT_EXCEEDED");
  }, 60_000);
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "";
    }
  },
}));

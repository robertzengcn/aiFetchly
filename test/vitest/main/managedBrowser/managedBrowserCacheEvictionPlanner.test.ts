import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CacheEvictionPlanner } from "@/childprocess/managed-browser-cache/CacheEvictionPlanner";

/**
 * Bounded scanning + LRU-inactive eviction planning (design §13.9): scans
 * respect entry/depth/wall-time limits and report truncation; plans exclude
 * active scopes, order least-recently-modified first, and stop as soon as
 * the projected total fits the global maximum.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const TOKEN_A = "a".repeat(24);
const TOKEN_B = "b".repeat(24);
const TOKEN_C = "c".repeat(24);
const TOKEN_D = "d".repeat(24);

let tmpRoot: string;
let managedRoot: string;
let planner: CacheEvictionPlanner;

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mb-cache-planner-"));
  managedRoot = path.join(tmpRoot, "managed-browser-cache", "v1");
  await mkdir(managedRoot, { recursive: true });
  planner = new CacheEvictionPlanner({ now: () => NOW });
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function seedScope(
  token: string,
  files: ReadonlyArray<{ name: string; bytes: number; ageDays: number }>
): Promise<string> {
  const scopePath = path.join(managedRoot, token);
  for (const file of files) {
    const filePath = path.join(scopePath, file.name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "x".repeat(file.bytes), "utf8");
    const mtime = new Date(NOW - file.ageDays * DAY_MS);
    await utimes(filePath, mtime, mtime);
  }
  return scopePath;
}

describe("scanScopeDirectory", () => {
  it("sums file sizes across nesting and reports the newest mtime", async () => {
    const scopePath = await seedScope(TOKEN_A, [
      { name: "chrome-120/linux-x64/cache-a.bin", bytes: 100, ageDays: 10 },
      { name: "chrome-120/cache-b.bin", bytes: 50, ageDays: 2 },
    ]);
    const scan = await planner.scanScopeDirectory(scopePath);
    expect(scan.approximateBytes).toBe(150);
    expect(scan.fileCount).toBe(2);
    expect(scan.lastModifiedEpochMs).toBe(NOW - 2 * DAY_MS);
    expect(scan.truncated).toBe(false);
  });

  it("truncates on the entry limit", async () => {
    const scopePath = await seedScope(TOKEN_B, [
      { name: "f1.bin", bytes: 10, ageDays: 1 },
      { name: "f2.bin", bytes: 10, ageDays: 1 },
      { name: "f3.bin", bytes: 10, ageDays: 1 },
    ]);
    const scan = await planner.scanScopeDirectory(scopePath, {
      maxEntries: 2,
      maxDepth: 12,
      maxWallTimeMs: 20_000,
    });
    expect(scan.fileCount).toBe(2);
    expect(scan.truncated).toBe(true);
  });

  it("truncates on the depth limit", async () => {
    const scopePath = await seedScope(TOKEN_C, [
      { name: "deep/a/b/c/file.bin", bytes: 10, ageDays: 1 },
    ]);
    const scan = await planner.scanScopeDirectory(scopePath, {
      maxEntries: 200_000,
      maxDepth: 1,
      maxWallTimeMs: 20_000,
    });
    expect(scan.truncated).toBe(true);
  });

  it("never follows planted symlinks", async () => {
    const scopePath = await seedScope(TOKEN_D, [
      { name: "real.bin", bytes: 20, ageDays: 1 },
    ]);
    const outside = path.join(tmpRoot, "outside-target");
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "evil.bin"), "y".repeat(1000), "utf8");
    await symlink(outside, path.join(scopePath, "link-out"));
    const scan = await planner.scanScopeDirectory(scopePath);
    expect(scan.approximateBytes).toBe(20);
    expect(scan.fileCount).toBe(1);
  });

  it("returns zeros for a missing scope", async () => {
    const scan = await planner.scanScopeDirectory(
      path.join(managedRoot, "e".repeat(24))
    );
    expect(scan.approximateBytes).toBe(0);
    expect(scan.fileCount).toBe(0);
    expect(scan.truncated).toBe(false);
  });
});

describe("scanManagedRoot", () => {
  it("returns one summary per valid scope and skips foreign entries", async () => {
    await mkdir(path.join(managedRoot, "deleting", "del-pending0001"), {
      recursive: true,
    });
    await mkdir(path.join(managedRoot, "not-a-token"), { recursive: true });
    await seedScope("f".repeat(24), [
      { name: "one.bin", bytes: 30, ageDays: 5 },
    ]);
    const { scopes, truncated } = await planner.scanManagedRoot(managedRoot);
    const tokens = scopes.map((s) => s.scopeToken);
    expect(tokens).toContain("f".repeat(24));
    expect(tokens).not.toContain("deleting");
    expect(tokens).not.toContain("not-a-token");
    expect(truncated).toBe(false);
  });
});

describe("planEviction", () => {
  const POLICY = {
    maxTotalBytes: 250,
    perScopeTargetBytes: 500,
    inactiveRetentionDays: 30,
  };

  function summary(
    token: string,
    approximateBytes: number,
    lastModifiedEpochMs: number
  ) {
    return {
      scopeToken: token,
      approximateBytes,
      fileCount: approximateBytes > 0 ? 1 : 0,
      lastModifiedEpochMs,
      truncated: false,
    };
  }

  it("plans LRU-first: empty, stale, then over-target until the total fits", () => {
    const summaries = [
      summary(TOKEN_A, 100, NOW - 40 * DAY_MS), // stale
      summary(TOKEN_B, 100, NOW - 1 * DAY_MS), // fresh, small — never a candidate
      summary(TOKEN_C, 1000, NOW - 1 * DAY_MS), // over target
      summary(TOKEN_D, 0, 0), // empty
    ];
    const plan = planner.planEviction(summaries, POLICY, [], NOW);
    // LRU order: empty (0), stale (old), over-target (newest).
    expect(plan.entries).toEqual([TOKEN_D, TOKEN_A, TOKEN_C]);
    expect(plan.plannedBytes).toBe(1100); // 1200 total − 100 retained ≤ 250
  });

  it("excludes active scopes entirely", () => {
    const summaries = [
      summary(TOKEN_A, 1000, NOW - 90 * DAY_MS),
      summary(TOKEN_B, 1000, NOW - 90 * DAY_MS),
    ];
    const plan = planner.planEviction(summaries, POLICY, [TOKEN_A], NOW);
    expect(plan.entries).toEqual([TOKEN_B]);
  });

  it("plans nothing when everything already fits", () => {
    const summaries = [
      summary(TOKEN_A, 100, NOW - 90 * DAY_MS),
      summary(TOKEN_B, 100, NOW - 90 * DAY_MS),
    ];
    const plan = planner.planEviction(summaries, POLICY, [], NOW);
    expect(plan.entries).toEqual([]);
    expect(plan.plannedBytes).toBe(0);
  });

  it("keeps fresh small scopes even under pressure", () => {
    const summaries = [
      summary(TOKEN_A, 10, NOW - 1 * DAY_MS), // fresh, small
      summary(TOKEN_B, 1000, NOW - 40 * DAY_MS), // stale
    ];
    const plan = planner.planEviction(summaries, POLICY, [], NOW);
    expect(plan.entries).toEqual([TOKEN_B]);
    expect(plan.entries).not.toContain(TOKEN_A);
  });
});

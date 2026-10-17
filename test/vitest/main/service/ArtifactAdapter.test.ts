// test/vitest/main/service/ArtifactAdapter.test.ts
//
// B21 (FR-02/03/19, NFR-02/08, AC-03/11/20/24): bounded artifact reads and
// change-vs-baseline verification.
//
// The artifact adapter must not synchronously read unbounded files on the
// main thread (a large artifact or pathological check blocks Stop/deadline
// handling), and a `changed` expectation must verify against a captured
// pre-action baseline instead of always returning unknown.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";
import { ArtifactAdapter, snapshotArtifactBaselines } from "@/service/aiTaskExecution/criteriaAdapters";
import type { TaskCriterion } from "@/entityTypes/aiTaskExecutionTypes";

const sha256 = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

function artifactCriterion(
  relativePath: string,
  expectation: "exists" | "changed",
  requiredContentChecks: string[] = []
): TaskCriterion {
  return {
    id: "crit-art-0",
    required: true,
    kind: "artifact",
    description: `artifact ${relativePath} ${expectation}`,
    relativePath,
    expectation,
    requiredContentChecks,
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
  } as TaskCriterion;
}

describe("ArtifactAdapter — bounded reads + change baseline (B21)", () => {
  let baseDir = "";
  let adapter!: ArtifactAdapter;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(os.tmpdir(), "aifetchly-artifact-b21-"));
    adapter = new ArtifactAdapter();
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("oversized file whose head contains the pattern → unknown (refuses to judge, never a bounded pass)", async () => {
    // 256 KiB of head-pattern + padding. An unbounded whole-file read would
    // pass the content check; the bounded adapter must return unknown
    // without judging content it did not fully read.
    const head = "launch codes ok\n";
    const padding = "x".repeat(256 * 1024);
    writeFileSync(path.join(baseDir, "big.txt"), head + padding);
    const result = await adapter.evaluate(
      artifactCriterion("big.txt", "exists", ["launch codes"]),
      { content: "", artifactBaseDir: baseDir }
    );
    expect(result.state).toBe("unknown");
    expect(result.summary).toMatch(/oversize|too large|bound/i);
  });

  it("changed + differs from baseline → pass", async () => {
    const filePath = path.join(baseDir, "report.txt");
    writeFileSync(filePath, "version one");
    const baseline = sha256("version one");
    writeFileSync(filePath, "version two");
    const result = await adapter.evaluate(
      artifactCriterion("report.txt", "changed"),
      { content: "", artifactBaseDir: baseDir, artifactBaselines: { "report.txt": baseline } }
    );
    expect(result.state).toBe("pass");
  });

  it("changed + identical to baseline → fail (deterministic unmet, not unknown)", async () => {
    const filePath = path.join(baseDir, "report.txt");
    writeFileSync(filePath, "version one");
    const baseline = sha256("version one");
    const result = await adapter.evaluate(
      artifactCriterion("report.txt", "changed"),
      { content: "", artifactBaseDir: baseDir, artifactBaselines: { "report.txt": baseline } }
    );
    expect(result.state).toBe("fail");
  });

  it("changed + no baseline → unknown (never a false pass)", async () => {
    writeFileSync(path.join(baseDir, "report.txt"), "version two");
    const result = await adapter.evaluate(
      artifactCriterion("report.txt", "changed"),
      { content: "", artifactBaseDir: baseDir }
    );
    expect(result.state).toBe("unknown");
  });

  it("bounded valid content (exists + substring check) → pass", async () => {
    writeFileSync(path.join(baseDir, "notes.txt"), "hello launch world");
    const result = await adapter.evaluate(
      artifactCriterion("notes.txt", "exists", ["launch"]),
      { content: "", artifactBaseDir: baseDir }
    );
    expect(result.state).toBe("pass");
  });

  it("missing content pattern → fail (deterministic)", async () => {
    writeFileSync(path.join(baseDir, "notes.txt"), "hello world");
    const result = await adapter.evaluate(
      artifactCriterion("notes.txt", "exists", ["launch"]),
      { content: "", artifactBaseDir: baseDir }
    );
    expect(result.state).toBe("fail");
  });

  it("foreign path outside the base dir → unknown (never passes)", async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "aifetchly-artifact-out-"));
    try {
      writeFileSync(path.join(outside, "secret.txt"), "launch codes");
      const result = await adapter.evaluate(
        artifactCriterion("../" + path.basename(outside) + "/secret.txt", "exists", ["launch"]),
        { content: "", artifactBaseDir: baseDir }
      );
      expect(result.state).toBe("unknown");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("nested base dir + nested artifact path → pass (legitimate nesting works)", async () => {
    mkdirSync(path.join(baseDir, "out"), { recursive: true });
    writeFileSync(path.join(baseDir, "out", "report.txt"), "launch summary");
    const result = await adapter.evaluate(
      artifactCriterion("out/report.txt", "exists", ["launch"]),
      { content: "", artifactBaseDir: baseDir }
    );
    expect(result.state).toBe("pass");
  });
});

describe("snapshotArtifactBaselines — pre-action capture (B21)", () => {
  let baseDir = "";

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(os.tmpdir(), "aifetchly-artifact-snap-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("captures hashes for readable in-cap artifacts; change is detectable", async () => {
    writeFileSync(path.join(baseDir, "report.txt"), "version one");
    const criteria = [
      artifactCriterion("report.txt", "changed"),
      artifactCriterion("missing.txt", "changed"),
    ];
    const baselines = await snapshotArtifactBaselines(baseDir, criteria);
    expect(baselines["report.txt"]).toBe(sha256("version one"));
    expect(baselines["missing.txt"]).toBeUndefined();
    // The run modifies the file; the adapter verifies the change.
    writeFileSync(path.join(baseDir, "report.txt"), "version two");
    const adapter = new ArtifactAdapter();
    const result = await adapter.evaluate(criteria[0], {
      content: "",
      artifactBaseDir: baseDir,
      artifactBaselines: baselines,
    });
    expect(result.state).toBe("pass");
  });

  it("skips oversized files (no baseline → honestly unknown)", async () => {
    writeFileSync(path.join(baseDir, "big.txt"), "y".repeat(128 * 1024));
    const baselines = await snapshotArtifactBaselines(baseDir, [
      artifactCriterion("big.txt", "changed"),
    ]);
    expect(baselines["big.txt"]).toBeUndefined();
  });

  it("never throws: missing base dir → empty map", async () => {
    const baselines = await snapshotArtifactBaselines(
      path.join(baseDir, "nope"),
      [artifactCriterion("report.txt", "changed")]
    );
    expect(baselines).toEqual({});
  });
});

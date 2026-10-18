// PluginFileArtifactService tests (TD-08 / HOST-17) — real temp filesystem so
// symlink/containment behavior is exercised for real.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  PluginFileArtifactService,
  type PluginArtifactCandidate,
} from "@/service/PluginFileArtifactService";

let root: string;
let service: PluginFileArtifactService;
let fixedNow: number;

const JSON_CANDIDATE: PluginArtifactCandidate = {
  version: 1,
  relativePath: "records.json",
  format: "json",
  recordCount: 2,
  complete: true,
};

const RECORDS = {
  schemaVersion: 1,
  records: [
    { businessName: "A", phone: "111" },
    { businessName: "B", phone: "222" },
  ],
};

beforeAll(() => {
  root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yp-artifacts-")), "store");
  fixedNow = Date.parse("2026-10-16T00:00:00Z");
  service = new PluginFileArtifactService({ root }, () => fixedNow);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function stageExecution(executionId: string): string {
  const staging = service.provisionStaging(executionId);
  fs.writeFileSync(
    path.join(staging, "records.json"),
    JSON.stringify(RECORDS)
  );
  return staging;
}

describe("PluginFileArtifactService", () => {
  it("provisions staging, validates candidates, and promotes atomically", () => {
    stageExecution("exec-ok");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-ok",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(errors).toEqual([]);
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    expect(artifact.id).toMatch(/^pa_/);
    expect(artifact.recordCount).toBe(2);
    expect(artifact.conversationId).toBe("conv-1");
    // Promoted content + host metadata exist.
    const dir = path.join(root, "artifacts", artifact.id);
    expect(fs.existsSync(path.join(dir, "content.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "metadata.json"))).toBe(true);
  });

  it("promotion is idempotent per execution + candidate", () => {
    stageExecution("exec-idem");
    const first = service.promoteCandidates({
      executionId: "exec-idem",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    const second = service.promoteCandidates({
      executionId: "exec-idem",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(second.artifacts[0].id).toBe(first.artifacts[0].id);
    const ids = fs.readdirSync(path.join(root, "artifacts"));
    expect(ids.filter((id) => id === first.artifacts[0].id)).toHaveLength(1);
  });

  it("rejects a symlink candidate escaping staging", () => {
    const staging = stageExecution("exec-symlink");
    const outside = path.join(root, "..", "outside.json");
    fs.writeFileSync(outside, JSON.stringify(RECORDS));
    fs.symlinkSync(outside, path.join(staging, "records.csv"));
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-symlink",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [
        { version: 1, relativePath: "records.csv", format: "csv", recordCount: 0, complete: true },
      ],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors[0]).toMatch(/regular file|escapes/);
    fs.unlinkSync(outside);
  });

  it("rejects a claimed record count that does not match the JSON content", () => {
    stageExecution("exec-mismatch");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-mismatch",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [{ ...JSON_CANDIDATE, recordCount: 99 }],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors[0]).toMatch(/record count mismatch/);
  });

  it("rejects disallowed candidate filenames", () => {
    stageExecution("exec-weird");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-weird",
      conversationId: "conv-1",
      pluginName: "demo-plugin",
      candidates: [
        {
          version: 1,
          relativePath: "../evil.json",
          format: "json",
          recordCount: 0,
          complete: true,
        } as unknown as PluginArtifactCandidate,
      ],
    });
    expect(artifacts).toHaveLength(0);
    expect(errors[0]).toMatch(/not allowed/);
  });

  it("drops a third candidate with an overflow notice (dead slice removed)", () => {
    const staging = stageExecution("exec-cap");
    fs.writeFileSync(staging + path.sep + "records.csv", "businessName,phone\n");
    const { artifacts, errors } = service.promoteCandidates({
      executionId: "exec-cap",
      conversationId: "conv-cap",
      pluginName: "demo-plugin",
      candidates: [
        JSON_CANDIDATE,
        { version: 1, relativePath: "records.csv", format: "csv", recordCount: 0, complete: true },
        JSON_CANDIDATE,
      ],
    });
    // Exactly the cap is promoted; the overflow candidate is never honored.
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].id).not.toBe(artifacts[1].id);
    expect(errors.some((e) => e.includes("too many candidates"))).toBe(true);
  });

  it("scopes list/preview/export/delete by conversation ownership", () => {
    stageExecution("exec-own");
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-own",
      conversationId: "conv-owner",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    const id = artifacts[0].id;

    // Owner sees it; another conversation does not.
    expect(service.listForConversation("conv-owner")).toHaveLength(1);
    expect(service.listForConversation("conv-other")).toHaveLength(0);

    const preview = service.preview("conv-owner", id);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      const rows = JSON.parse(preview.rows) as { records: unknown[] };
      expect(rows.records).toHaveLength(2);
    }
    expect(service.preview("conv-other", id).ok).toBe(false);

    const dest = path.join(root, "..", "export-test.json");
    expect(service.exportToPath("conv-owner", id, dest).ok).toBe(true);
    expect(service.exportToPath("conv-other", id, dest).ok).toBe(false);
    fs.unlinkSync(dest);

    expect(service.delete("conv-other", id).ok).toBe(false);
    expect(service.delete("conv-owner", id).ok).toBe(true);
    expect(service.listForConversation("conv-owner")).toHaveLength(0);
  });

  it("bounds the preview row count", () => {
    const staging = service.provisionStaging("exec-preview");
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify({
        records: Array.from({ length: 50 }, (_, i) => ({ i })),
      })
    );
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-preview",
      conversationId: "conv-p",
      pluginName: "demo-plugin",
      candidates: [
        { ...JSON_CANDIDATE, recordCount: 50 },
      ],
    });
    const preview = service.preview("conv-p", artifacts[0].id, 5);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      const rows = JSON.parse(preview.rows) as { records: unknown[] };
      expect(rows.records).toHaveLength(5);
    }
  });

  it("sweeps expired artifacts", () => {
    const staging = service.provisionStaging("exec-exp");
    fs.writeFileSync(
      path.join(staging, "records.json"),
      JSON.stringify(RECORDS)
    );
    const { artifacts } = service.promoteCandidates({
      executionId: "exec-exp",
      conversationId: "conv-exp",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(service.sweepExpired()).toBe(0); // not expired yet

    // A service with a later clock expires it. (Every artifact in this
    // suite shares the fixed clock, so the sweep may remove more than one —
    // the assertion is that this conversation's artifact is gone.)
    const later = new PluginFileArtifactService(
      { root },
      () => fixedNow + 31 * 24 * 60 * 60_000
    );
    expect(later.sweepExpired()).toBeGreaterThanOrEqual(1);
    expect(later.listForConversation("conv-exp")).toHaveLength(0);
  });

  it("releaseStaging removes the staging directory", () => {
    stageExecution("exec-clean");
    expect(fs.existsSync(service.stagingDir("exec-clean"))).toBe(true);
    service.releaseStaging("exec-clean");
    expect(fs.existsSync(service.stagingDir("exec-clean"))).toBe(false);
  });
});

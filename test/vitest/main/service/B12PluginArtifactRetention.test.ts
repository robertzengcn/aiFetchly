import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  PluginFileArtifactService,
  PLUGIN_ARTIFACT_LIMITS,
} from "@/service/PluginFileArtifactService";
import { PluginFileArtifactModule } from "@/modules/PluginFileArtifactModule";

/**
 * B12 — retention actually runs:
 *  1. expired metadata is rejected on read (preview/export/list)
 *  2. clean promotion releases staging immediately; partial errors retain it
 *  3. the sweep ages out quarantine (mtime) and orphaned journals
 *  4. confirmed conversation deletion removes its promoted artifacts
 */

const JSON_CANDIDATE = {
  version: 1 as const,
  relativePath: "records.json" as const,
  format: "json" as const,
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

const JAN1 = Date.parse("2026-01-01T00:00:00Z");

let root: string;

function serviceAt(ms: number): PluginFileArtifactService {
  return new PluginFileArtifactService({ root }, () => ms);
}

function stageEx(
  service: PluginFileArtifactService,
  executionId: string
): void {
  fs.mkdirSync(service.stagingDir(executionId), { recursive: true });
  fs.writeFileSync(
    path.join(service.stagingDir(executionId), "records.json"),
    JSON.stringify(RECORDS)
  );
}

beforeAll(() => {
  root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "yp-b12-")),
    "store"
  );
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("B12 retention", () => {
  it("expired metadata is rejected on read (preview/export/list)", () => {
    const live = serviceAt(JAN1);
    stageEx(live, "exec-exp-read");
    const { artifacts, errors } = live.promoteCandidates({
      executionId: "exec-exp-read",
      conversationId: "conv-exp-read",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(errors).toEqual([]);
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    const destination = path.join(os.tmpdir(), `yp-b12-export-${artifact.id}`);

    // Same clock: readable and exportable.
    expect(
      live.exportToPath("conv-exp-read", artifact.id, destination)
    ).toMatchObject({ ok: true });

    // Past retention: reads reject the expired metadata even before a sweep.
    const later = serviceAt(
      JAN1 + PLUGIN_ARTIFACT_LIMITS.defaultRetentionMs + 1000
    );
    expect(later.listForConversation("conv-exp-read")).toEqual([]);
    expect(
      later.exportToPath("conv-exp-read", artifact.id, destination)
    ).toEqual({ ok: false, error: "artifact not found" });
    expect(later.preview("conv-exp-read", artifact.id)).toEqual({
      ok: false,
      error: "artifact not found",
    });
    expect(fs.existsSync(destination)).toBe(true);

    // And the sweep physically removes it.
    expect(later.sweepExpired()).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(root, "artifacts", artifact.id))).toBe(
      false
    );
  });

  it("clean promotion releases staging; partial errors retain it for re-promotion", () => {
    const live = serviceAt(JAN1);
    stageEx(live, "exec-clean-rel");
    live.promoteCandidates({
      executionId: "exec-clean-rel",
      conversationId: "conv-clean",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    // Released right after confirmed promotion (journal + no errors).
    expect(live.stagingExists("exec-clean-rel")).toBe(false);

    // Partial error (filename/format mismatch) retains staging.
    stageEx(live, "exec-partial");
    const { artifacts: partialArtifacts, errors: partialErrors } =
      live.promoteCandidates({
        executionId: "exec-partial",
        conversationId: "conv-clean",
        pluginName: "demo-plugin",
        candidates: [{ ...JSON_CANDIDATE, format: "csv" as const }],
      });
    expect(partialErrors.length).toBeGreaterThan(0);
    expect(partialArtifacts).toHaveLength(0);
    expect(live.stagingExists("exec-partial")).toBe(true);

    // Retry with the fixed candidates: registration completes and releases.
    stageEx(live, "exec-partial");
    const retried = live.promoteCandidates({
      executionId: "exec-partial",
      conversationId: "conv-clean",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(retried.errors).toEqual([]);
    expect(retried.artifacts).toHaveLength(1);
    expect(live.stagingExists("exec-partial")).toBe(false);
  });

  it("the sweep ages out quarantine entries by mtime with the passed retention", () => {
    // Separate store so mtime manipulation cannot leak across cases.
    const qRoot = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "yp-b12-q-")),
      "store"
    );
    try {
      const svc = new PluginFileArtifactService({ root: qRoot });
      stageEx(svc, "exec-orph");

      // Crash residue: startup recovery quarantines the orphan staging.
      const recovered = svc.recoverStartupExecutions();
      expect(recovered.interrupted).toEqual(["exec-orph"]);
      const quarantined = path.join(qRoot, "staging-quarantine", "exec-orph");
      expect(fs.existsSync(quarantined)).toBe(true);

      // A second, fresh quarantine entry (not back-dated).
      const freshStaging = svc.provisionStaging("exec-fresh-q");
      fs.writeFileSync(
        path.join(freshStaging, "records.json"),
        JSON.stringify(RECORDS)
      );
      svc.recoverStartupExecutions();

      // Back-date only the first entry 2 hours; retention 1 hour.
      const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(quarantined, past, past);

      const removed = svc.sweepExpired(60 * 60 * 1000);
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(quarantined)).toBe(false);
      expect(
        fs.existsSync(path.join(qRoot, "staging-quarantine", "exec-fresh-q"))
      ).toBe(true);
    } finally {
      fs.rmSync(qRoot, { recursive: true, force: true });
    }
  });

  it("orphaned journals (staging + quarantine gone) age out with retention", () => {
    const jRoot = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "yp-b12-j-")),
      "store"
    );
    try {
      const janService = new PluginFileArtifactService(
        { root: jRoot },
        () => JAN1
      );
      stageEx(janService, "exec-journaled");
      janService.promoteCandidates({
        executionId: "exec-journaled",
        conversationId: "conv-j",
        pluginName: "demo-plugin",
        candidates: [JSON_CANDIDATE],
      });
      // Journal written at JAN1; staging already released.
      expect(
        fs.existsSync(path.join(jRoot, "journal", "exec-journaled.json"))
      ).toBe(true);

      const later = new PluginFileArtifactService({ root: jRoot }, () =>
        Date.parse("2026-02-02T00:00:00Z")
      );
      // No staging/quarantine residue: the aged journal is pure residue.
      expect(later.sweepExpired()).toBeGreaterThanOrEqual(1);
      expect(
        fs.existsSync(path.join(jRoot, "journal", "exec-journaled.json"))
      ).toBe(false);
    } finally {
      fs.rmSync(jRoot, { recursive: true, force: true });
    }
  });

  it("journals with surviving quarantine data are NOT aged out", () => {
    const jRoot = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "yp-b12-jk-")),
      "store"
    );
    try {
      const svc = new PluginFileArtifactService({ root: jRoot });
      stageEx(svc, "exec-keep");
      svc.recoverStartupExecutions(); // interrupted -> quarantine + journal
      const quarantine = path.join(jRoot, "staging-quarantine", "exec-keep");
      expect(fs.existsSync(quarantine)).toBe(true);

      // Custom tiny retention: the sweep would age the journal, but its
      // quarantine data still exists, so it stays.
      svc.sweepExpired(1000);
      expect(
        fs.existsSync(path.join(jRoot, "journal", "exec-keep.json"))
      ).toBe(true);
    } finally {
      fs.rmSync(jRoot, { recursive: true, force: true });
    }
  });

  it("removeForConversation deletes only that conversation's artifacts", () => {
    const live = serviceAt(JAN1);
    stageEx(live, "exec-c-a");
    const a = live.promoteCandidates({
      executionId: "exec-c-a",
      conversationId: "conv-a",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    stageEx(live, "exec-c-b");
    const b = live.promoteCandidates({
      executionId: "exec-c-b",
      conversationId: "conv-b",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);

    const removed = live.removeForConversation("conv-a");
    expect(removed).toBe(1);
    expect(fs.existsSync(path.join(root, "artifacts", a.artifacts[0].id))).toBe(
      false
    );
    expect(live.listForConversation("conv-b")).toHaveLength(1);
    expect(live.removeForConversation("conv-a")).toBe(0);
  });

  it("the Module cascade conversation-deletes artifacts", () => {
    const live = serviceAt(JAN1);
    stageEx(live, "exec-mod");
    const promoted = live.promoteCandidates({
      executionId: "exec-mod",
      conversationId: "conv-mod",
      pluginName: "demo-plugin",
      candidates: [JSON_CANDIDATE],
    });
    expect(promoted.errors).toEqual([]);

    const module = new PluginFileArtifactModule(
      new PluginFileArtifactService({ root })
    );
    return module.removeForConversation("conv-mod").then((removed) => {
      expect(removed).toBe(1);
      expect(live.listForConversation("conv-mod")).toEqual([]);
    });
  });
});
